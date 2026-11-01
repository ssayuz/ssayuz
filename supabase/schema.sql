-- =====================================================================
-- ssayuz · Supabase 스키마
-- Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 Run
-- (처음 한 번만. 다시 실행해도 되도록 대부분 IF NOT EXISTS / OR REPLACE)
--
-- 보안은 전부 여기(DB)에서 지켜요. 브라우저 코드는 누구나 볼 수 있으니까요.
--   · 글/좋아요/팔로우/DM은 로그인한 본인 이름으로만, 차단된 계정은 아무것도 못 씀
--   · 글 삭제는 본인만, 숨기기·차단은 관리자만 (전용 함수로만 가능)
--   · 답글 허용 범위, 500자 제한, 도배 방지도 DB가 직접 검사
-- =====================================================================

-- ---------------------------------------------------------------------
-- 프로필
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),  -- 소문자만
  display_name text not null check (char_length(display_name) between 1 and 20),
  bio          text not null default '' check (char_length(bio) <= 150),
  link         text not null default '' check (link = '' or (link ~* '^https?://[^\s]+$' and char_length(link) <= 200)),
  role         text not null default 'user' check (role in ('user', 'admin')),
  banned_at    timestamptz,
  ban_reason   text not null default '',
  created_at   timestamptz not null default now()
);

-- 차단되지 않은 계정인지 / 관리자인지
create or replace function public.is_active(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = uid and banned_at is null)
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = uid and role = 'admin' and banned_at is null)
$$;

-- 가입하면 프로필 자동 생성 (아이디/이름은 가입할 때 넘긴 값)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uname text := new.raw_user_meta_data ->> 'username';
  dname text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), uname);
begin
  insert into profiles (id, username, display_name) values (new.id, lower(uname), left(dname, 20));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Snippet (글)
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id    bigint references public.posts(id) on delete set null,
  root_id      bigint references public.posts(id) on delete set null,
  quote_id     bigint references public.posts(id) on delete set null,
  body         text not null check (char_length(body) <= 500),
  reply_policy text not null default 'all' check (reply_policy in ('all', 'following', 'mentioned')),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  hidden_at    timestamptz
);
create index if not exists posts_user_idx on public.posts (user_id, id desc);
create index if not exists posts_parent_idx on public.posts (parent_id, id);
create index if not exists posts_created_idx on public.posts (created_at desc);

create table if not exists public.post_likes (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.reposts (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists reposts_user_idx on public.reposts (user_id, created_at desc);

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

-- 답글을 달 수 있는지 (작성자가 정한 범위)
create or replace function public.can_reply(p_post bigint, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from posts p
    where p.id = p_post and p.deleted_at is null and p.hidden_at is null and is_active(uid)
      and (
        p.user_id = uid
        or p.reply_policy = 'all'
        or (p.reply_policy = 'following'
            and exists (select 1 from follows f where f.follower_id = p.user_id and f.followee_id = uid))
        or (p.reply_policy = 'mentioned'
            and exists (select 1 from profiles pr where pr.id = uid
                        and p.body ~* ('(^|\s)@' || regexp_replace(pr.username, '\.', '\\.', 'g') || '([^A-Za-z0-9_.]|$)')))
      )
  )
$$;

-- 글 올리기 전 검사: 답글 허용 범위, 인용 대상, 도배 방지
create or replace function public.posts_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent posts;
begin
  new.created_at := clock_timestamp();
  new.deleted_at := null;
  new.hidden_at := null;
  new.body := btrim(new.body);
  if char_length(new.body) = 0 then raise exception '내용을 입력해 주세요.' using errcode = 'P0001'; end if;

  if new.parent_id is not null then
    select * into parent from posts where id = new.parent_id;
    if not found or parent.deleted_at is not null or parent.hidden_at is not null then
      raise exception '답글을 달 글을 찾을 수 없어요.' using errcode = 'P0001';
    end if;
    if not can_reply(parent.id, new.user_id) then
      raise exception '작성자가 답글을 달 수 있는 사람을 제한했어요.' using errcode = 'P0001';
    end if;
    new.root_id := coalesce(parent.root_id, parent.id);
  else
    new.root_id := null;
  end if;

  if new.quote_id is not null and not exists (
    select 1 from posts where id = new.quote_id and deleted_at is null and hidden_at is null
  ) then
    raise exception '인용할 글을 찾을 수 없어요.' using errcode = 'P0001';
  end if;

  if (select count(*) from posts where user_id = new.user_id and created_at > now() - interval '1 minute') >= 15 then
    raise exception '조금만 천천히! 잠시 뒤에 다시 올려 주세요.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert before insert on public.posts
  for each row execute function public.posts_before_insert();

-- 내 글 삭제 (답글이 달려 있으면 자리만 남김)
create or replace function public.delete_post(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare p posts;
begin
  select * into p from posts where id = p_id;
  if not found or p.user_id <> auth.uid() then
    raise exception '내 Snippet만 삭제할 수 있어요.' using errcode = 'P0001';
  end if;
  delete from notifications where post_id = p_id;
  if exists (select 1 from posts where parent_id = p_id) then
    update posts set deleted_at = now(), body = '' where id = p_id;
  else
    delete from posts where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 활동(알림)
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  actor_id   uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in ('like', 'reply', 'repost', 'quote', 'follow', 'mention')),
  post_id    bigint references public.posts(id) on delete cascade,
  snippet    text not null default '',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, id desc);

create or replace function public.add_notification(p_user uuid, p_actor uuid, p_type text, p_post bigint, p_snippet text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then return; end if;
  if p_type in ('like', 'repost', 'follow') then
    delete from notifications where user_id = p_user and actor_id = p_actor and type = p_type
      and post_id is not distinct from p_post;
  end if;
  insert into notifications (user_id, actor_id, type, post_id, snippet)
    values (p_user, p_actor, p_type, p_post, left(coalesce(p_snippet, ''), 80));
end $$;

create or replace function public.on_post_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent_owner uuid;
  quote_owner uuid;
  m text;
  target uuid;
begin
  if new.parent_id is not null then
    select user_id into parent_owner from posts where id = new.parent_id;
    perform add_notification(parent_owner, new.user_id, 'reply', new.id, new.body);
  end if;
  if new.quote_id is not null then
    select user_id into quote_owner from posts where id = new.quote_id;
    perform add_notification(quote_owner, new.user_id, 'quote', new.id, new.body);
  end if;
  for m in select distinct lower((regexp_matches(new.body, '(?:^|\s)@([A-Za-z0-9_.]{3,20})', 'g'))[1]) limit 10 loop
    select id into target from profiles where username = m;
    if target is not null and target is distinct from parent_owner and target is distinct from quote_owner then
      perform add_notification(target, new.user_id, 'mention', new.id, new.body);
    end if;
    target := null;
  end loop;
  return new;
end $$;

drop trigger if exists posts_after_insert on public.posts;
create trigger posts_after_insert after insert on public.posts
  for each row execute function public.on_post_created();

create or replace function public.on_reaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind text := case tg_table_name when 'post_likes' then 'like' else 'repost' end;
  r record;
  owner uuid;
  body text;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  select user_id, posts.body into owner, body from posts where id = r.post_id;
  if tg_op = 'INSERT' then
    perform add_notification(owner, r.user_id, kind, r.post_id, body);
  else
    delete from notifications where user_id = owner and actor_id = r.user_id and type = kind and post_id = r.post_id;
  end if;
  return null;
end $$;

drop trigger if exists likes_notify on public.post_likes;
create trigger likes_notify after insert or delete on public.post_likes
  for each row execute function public.on_reaction();
drop trigger if exists reposts_notify on public.reposts;
create trigger reposts_notify after insert or delete on public.reposts
  for each row execute function public.on_reaction();

create or replace function public.on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform add_notification(new.followee_id, new.follower_id, 'follow', null, '');
  else
    delete from notifications where user_id = old.followee_id and actor_id = old.follower_id and type = 'follow';
  end if;
  return null;
end $$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert or delete on public.follows
  for each row execute function public.on_follow();

-- ---------------------------------------------------------------------
-- DM
-- ---------------------------------------------------------------------
create table if not exists public.dm_messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 1000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);
create index if not exists dm_sender_idx on public.dm_messages (sender_id, id desc);
create index if not exists dm_recipient_idx on public.dm_messages (recipient_id, id desc);

create or replace function public.dm_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.created_at := now();
  new.read_at := null;
  if (select count(*) from dm_messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 30 then
    raise exception '너무 빨라요. 잠깐만요.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists dm_before_insert on public.dm_messages;
create trigger dm_before_insert before insert on public.dm_messages
  for each row execute function public.dm_before_insert();

-- 상대가 보낸 메시지를 읽음으로
create or replace function public.mark_dm_read(p_other uuid)
returns void language sql security definer set search_path = public as $$
  update dm_messages set read_at = now()
  where recipient_id = auth.uid() and sender_id = p_other and read_at is null
$$;

-- ---------------------------------------------------------------------
-- 관리자
-- ---------------------------------------------------------------------
create table if not exists public.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  target     text not null,
  note       text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.admin_set_hidden(p_id bigint, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '관리자만 할 수 있어요.' using errcode = 'P0001'; end if;
  update posts set hidden_at = case when p_hidden then now() else null end where id = p_id;
  insert into admin_log (admin_id, action, target) values (auth.uid(), case when p_hidden then '숨김' else '복구' end, 'Snippet #' || p_id);
end $$;

create or replace function public.admin_ban(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_admin() then raise exception '관리자만 할 수 있어요.' using errcode = 'P0001'; end if;
  select * into u from profiles where id = p_user;
  if not found or u.role = 'admin' or u.id = auth.uid() then
    raise exception '이 계정은 차단할 수 없어요.' using errcode = 'P0001';
  end if;
  update profiles set banned_at = now(), ban_reason = left(coalesce(p_reason, ''), 100) where id = p_user;
  insert into admin_log (admin_id, action, target, note) values (auth.uid(), '계정 차단', '@' || u.username, left(coalesce(p_reason, ''), 100));
end $$;

create or replace function public.admin_unban(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_admin() then raise exception '관리자만 할 수 있어요.' using errcode = 'P0001'; end if;
  update profiles set banned_at = null, ban_reason = '' where id = p_user returning * into u;
  if found then insert into admin_log (admin_id, action, target) values (auth.uid(), '차단 해제', '@' || u.username); end if;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_admin() then raise exception '관리자만 할 수 있어요.' using errcode = 'P0001'; end if;
  if p_role not in ('user', 'admin') or p_user = auth.uid() then raise exception '바꿀 수 없어요.' using errcode = 'P0001'; end if;
  update profiles set role = p_role where id = p_user and banned_at is null returning * into u;
  if found then
    insert into admin_log (admin_id, action, target) values (auth.uid(), case when p_role = 'admin' then '관리자 지정' else '관리자 해제' end, '@' || u.username);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 읽기용 뷰: 글 + 작성자 + 좋아요/답글/리포스트 수 + 내가 눌렀는지
-- security_invoker 라서 posts 의 보안 규칙(숨김 등)이 그대로 적용돼요
-- ---------------------------------------------------------------------
create or replace view public.post_view with (security_invoker = true) as
select
  p.*,
  pr.username,
  pr.display_name,
  (select count(*) from post_likes l where l.post_id = p.id)::int as likes,
  (select count(*) from posts r where r.parent_id = p.id and r.deleted_at is null and r.hidden_at is null)::int as replies,
  (select count(*) from reposts rp where rp.post_id = p.id)::int as reposts,
  exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = auth.uid()) as liked,
  exists (select 1 from reposts rp where rp.post_id = p.id and rp.user_id = auth.uid()) as reposted,
  (select x.username from posts pp join profiles x on x.id = pp.user_id where pp.id = p.parent_id) as parent_username
from posts p
join profiles pr on pr.id = p.user_id;

-- 프로필 + 팔로워/팔로잉 수
create or replace view public.profile_view with (security_invoker = true) as
select
  pr.id, pr.username, pr.display_name, pr.bio, pr.link, pr.role, pr.banned_at, pr.ban_reason, pr.created_at,
  (select count(*) from follows f where f.followee_id = pr.id)::int as followers,
  (select count(*) from follows f where f.follower_id = pr.id)::int as following
from profiles pr;

-- ---------------------------------------------------------------------
-- 보안 규칙 (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.post_likes    enable row level security;
alter table public.reposts       enable row level security;
alter table public.follows       enable row level security;
alter table public.notifications enable row level security;
alter table public.dm_messages   enable row level security;
alter table public.admin_log     enable row level security;

-- 기본 권한을 모두 거두고 필요한 것만 다시 줌
revoke all on public.profiles, public.posts, public.post_likes, public.reposts, public.follows,
  public.notifications, public.dm_messages, public.admin_log from anon, authenticated;
revoke all on public.post_view, public.profile_view from anon, authenticated;

grant select on public.profiles, public.posts, public.post_likes, public.reposts, public.follows to anon, authenticated;
grant select on public.post_view, public.profile_view to anon, authenticated;
grant update (display_name, bio, link) on public.profiles to authenticated;
grant insert (parent_id, quote_id, body, reply_policy) on public.posts to authenticated;
grant insert (post_id) , delete on public.post_likes to authenticated;
grant insert (post_id), delete on public.reposts to authenticated;
grant insert (followee_id), delete on public.follows to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.dm_messages to authenticated;
grant insert (recipient_id, body) on public.dm_messages to authenticated;
grant select on public.admin_log to authenticated;

-- 함수 실행 권한
revoke execute on function public.is_active(uuid), public.is_admin(uuid), public.can_reply(bigint, uuid),
  public.handle_new_user(), public.posts_before_insert(), public.delete_post(bigint),
  public.add_notification(uuid, uuid, text, bigint, text), public.on_post_created(), public.on_reaction(),
  public.on_follow(), public.dm_before_insert(), public.mark_dm_read(uuid), public.admin_set_hidden(bigint, boolean),
  public.admin_ban(uuid, text), public.admin_unban(uuid), public.admin_set_role(uuid, text)
  from public, anon, authenticated;
grant execute on function public.is_active(uuid), public.is_admin(uuid), public.can_reply(bigint, uuid) to anon, authenticated;
grant execute on function public.delete_post(bigint), public.mark_dm_read(uuid),
  public.admin_set_hidden(bigint, boolean), public.admin_ban(uuid, text), public.admin_unban(uuid),
  public.admin_set_role(uuid, text) to authenticated;

-- profiles
drop policy if exists "profiles: 누구나 보기" on public.profiles;
create policy "profiles: 누구나 보기" on public.profiles for select using (true);
drop policy if exists "profiles: 내 프로필 수정" on public.profiles;
create policy "profiles: 내 프로필 수정" on public.profiles for update to authenticated
  using (id = auth.uid() and banned_at is null) with check (id = auth.uid());

-- posts: 숨긴 글·차단된 사람의 글은 관리자만
drop policy if exists "posts: 보기" on public.posts;
create policy "posts: 보기" on public.posts for select
  using ((hidden_at is null and is_active(user_id)) or is_admin());
drop policy if exists "posts: 내 이름으로 쓰기" on public.posts;
create policy "posts: 내 이름으로 쓰기" on public.posts for insert to authenticated
  with check (user_id = auth.uid() and is_active());

-- 좋아요 / 리포스트
drop policy if exists "likes: 보기" on public.post_likes;
create policy "likes: 보기" on public.post_likes for select using (true);
drop policy if exists "likes: 누르기" on public.post_likes;
create policy "likes: 누르기" on public.post_likes for insert to authenticated
  with check (user_id = auth.uid() and is_active()
    and exists (select 1 from posts where id = post_id and deleted_at is null));
drop policy if exists "likes: 취소" on public.post_likes;
create policy "likes: 취소" on public.post_likes for delete to authenticated using (user_id = auth.uid());

drop policy if exists "reposts: 보기" on public.reposts;
create policy "reposts: 보기" on public.reposts for select using (true);
drop policy if exists "reposts: 하기" on public.reposts;
create policy "reposts: 하기" on public.reposts for insert to authenticated
  with check (user_id = auth.uid() and is_active()
    and exists (select 1 from posts where id = post_id and deleted_at is null));
drop policy if exists "reposts: 취소" on public.reposts;
create policy "reposts: 취소" on public.reposts for delete to authenticated using (user_id = auth.uid());

-- 팔로우
drop policy if exists "follows: 보기" on public.follows;
create policy "follows: 보기" on public.follows for select using (true);
drop policy if exists "follows: 하기" on public.follows;
create policy "follows: 하기" on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and is_active());
drop policy if exists "follows: 취소" on public.follows;
create policy "follows: 취소" on public.follows for delete to authenticated using (follower_id = auth.uid());

-- 알림: 내 것만
drop policy if exists "notifications: 내 것" on public.notifications;
create policy "notifications: 내 것" on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DM: 내가 보냈거나 받은 것만, 보낼 때는 내 이름으로
drop policy if exists "dm: 보기" on public.dm_messages;
create policy "dm: 보기" on public.dm_messages for select to authenticated
  using (auth.uid() in (sender_id, recipient_id));
drop policy if exists "dm: 보내기" on public.dm_messages;
create policy "dm: 보내기" on public.dm_messages for insert to authenticated
  with check (sender_id = auth.uid() and is_active() and is_active(recipient_id));

-- 관리 기록: 관리자만
drop policy if exists "admin_log: 관리자" on public.admin_log;
create policy "admin_log: 관리자" on public.admin_log for select to authenticated using (is_admin());

-- ---------------------------------------------------------------------
-- 회원 탈퇴: 내 계정과 내가 쓴 글·좋아요·팔로우·DM·알림을 모두 지움
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요.' using errcode = 'P0001'; end if;
  -- 내 글에 달린 남의 답글은 남기고, 내 글은 자리만 남기지 않고 지움 (답글은 원글 없음으로 표시)
  delete from auth.users where id = me;  -- profiles → posts, likes, follows, dm, notifications 모두 cascade
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- 관리자 지정: 가입한 뒤 아래 줄의 아이디를 바꿔서 SQL Editor에서 실행
--   update public.profiles set role = 'admin' where username = '내아이디';
-- =====================================================================
