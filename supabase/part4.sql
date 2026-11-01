-- ssayuz 스키마 4/4 · 보안 규칙, 회원 탈퇴  (1→2→3→4 순서대로 실행하세요)

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
