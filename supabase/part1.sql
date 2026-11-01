-- ssayuz 스키마 1/4 · 프로필, Snippet  (1→2→3→4 순서대로 실행하세요)

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

