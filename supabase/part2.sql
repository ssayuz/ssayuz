-- ssayuz 스키마 2/4 · 활동(알림), DM  (1→2→3→4 순서대로 실행하세요)

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

