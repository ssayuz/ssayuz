-- ssayuz 스키마 3/4 · 관리자, 읽기용 뷰  (1→2→3→4 순서대로 실행하세요)

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

