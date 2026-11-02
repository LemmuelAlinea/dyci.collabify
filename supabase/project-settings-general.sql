-- supabase/project-settings-general.sql
--
-- A work project's look, who in its space can open it, and asking to join.
--
-- Four general_projects columns, written through the existing update policy
-- (general_has edit_project, so the project manager): color and icon (both
-- optional, from fixed sets; null keeps today's look), default_view (the tab a
-- project opens on) and visibility. A class board's Files project stays private.
--
-- Visibility is Private (members and the space's Owners, as before) or
-- Workspace (also every member of the space, read-only). It is enforced in
-- can_read_general_project, which every reader already goes through; the
-- redefinition below is the live body from project-visibility.sql plus the
-- Workspace branch for work projects. A Workspace viewer holds no project role,
-- so writes (general_can_write, general_has) stay refused, and private planning
-- tasks stay hidden by general_task_readable, as they are from a space Owner.
--
-- general_join_requests: a space member who is not on a Workspace project asks
-- to join it (request_join_general_project); they can withdraw it
-- (withdraw_join_request). The project manager or a coordinator answers it
-- (answer_join_request). Approving adds the member with the chosen role, under
-- the invite rules: the project manager gives coordinator, member, qa or
-- stakeholder; a coordinator gives member, qa or stakeholder. A person who
-- joins another way (an invitation, a join code) has their open request closed
-- as approved by general_members_close_join_request. An approval is refused once
-- the project is no longer Workspace or the requester has left its space, and
-- their open requests close as withdrawn then: general_projects_close_join_requests
-- when the project turns Private, general_space_members_close_join_requests when
-- the requester leaves the space. The requester reads their
-- own requests, the project manager and coordinators read all of the project's;
-- nobody writes the table directly. join_requested goes to the project manager
-- and active coordinators; join_answered goes to the requester.
--
-- Redefines can_read_general_project (last written by project-visibility.sql).
-- Run after work-task-handoff.sql, then anon-lockdown.sql. Re-running
-- project-visibility.sql, general-spaces.sql or general-project-archive-rbac.sql
-- (each writes can_read_general_project) or work-task-handoff.sql means
-- re-running this file afterwards, then anon-lockdown.sql; otherwise Workspace
-- reads are silently lost.
--
-- Idempotent. Safe to re-run.

-- A new enum value must be committed before anything can use it.
begin;
do $$
begin
  alter type public.notification_type add value if not exists 'join_requested';
end $$;
commit;

begin;
do $$
begin
  alter type public.notification_type add value if not exists 'join_answered';
end $$;
commit;

begin;

-- ---------------------------------------------------------------- look and access

alter table public.general_projects
  add column if not exists color text
    check (color in ('navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate')),
  add column if not exists icon text
    check (icon in ('monitor', 'board', 'kanban', 'folder', 'book', 'calendar', 'clock',
                    'chart', 'shield', 'palette', 'spark', 'target', 'file', 'message',
                    'users', 'video', 'bell', 'mail', 'pin', 'crown')),
  add column if not exists default_view text not null default 'overview'
    check (default_view in ('overview', 'plan', 'tasks')),
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'workspace'));

-- A color is one of the named swatches or the project manager's own #rrggbb.
alter table public.general_projects drop constraint if exists general_projects_color_check;
alter table public.general_projects add constraint general_projects_color_check
  check (color in ('navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate')
         or color ~ '^#[0-9a-f]{6}$');

-- Workspace visibility is for work projects; a class board's Files project keeps its own access.
do $$ begin
  alter table public.general_projects add constraint general_projects_visibility_work
    check (visibility = 'private' or class_board_id is null);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- reading

/**
 * Who reads a project. Archived: general_sees_archived. A class board's Files
 * project: its members and its space's members. A work project: its members,
 * its space's Owners, and, when it is Workspace, every member of its space.
 */
create or replace function public.can_read_general_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.archived_at is not null then public.general_sees_archived(p.id, p.archived_by)
    when p.class_board_id is not null then
      public.is_general_member(p.id) or public.is_general_space_member(p.space_id)
    else public.is_general_member(p.id) or public.is_general_space_owner(p.space_id)
      or (p.visibility = 'workspace' and public.is_general_space_member(p.space_id))
  end
    from public.general_projects p
   where p.id = p_project;
$$;

-- ---------------------------------------------------------------- join requests

create table if not exists public.general_join_requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'open',
  role        public.general_role,
  created_at  timestamptz not null default now(),
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  constraint general_join_requests_status
    check (status in ('open', 'approved', 'declined', 'withdrawn')),
  constraint general_join_requests_role
    check ((status = 'approved') = (role is not null))
);

create unique index if not exists general_join_requests_open
  on public.general_join_requests (project_id, user_id) where status = 'open';
create index if not exists general_join_requests_user
  on public.general_join_requests (user_id);

alter table public.general_join_requests enable row level security;

drop policy if exists general_join_requests_select on public.general_join_requests;
create policy general_join_requests_select on public.general_join_requests
  for select to authenticated
  using ((user_id = auth.uid() and public.general_viewer_active())
         or coalesce(public.general_role_of(project_id)::text, '') in ('pm', 'coordinator'));

-- Reads only. Every write goes through the functions below.
revoke all on public.general_join_requests from public, anon, authenticated;
grant select on public.general_join_requests to authenticated;

/** Tells the project manager and active coordinators that someone asked to join. */
create or replace function public.notify_join_requested(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select m.user_id, 'join_requested'::public.notification_type, p.id,
         public.display_name(p_user) || ' asked to join ' || p.name,
         'Answer it in Settings → Members & permissions.'
    from public.general_members m
    join public.profiles pr on pr.id = m.user_id
    join public.general_projects p on p.id = m.project_id
   where m.project_id = p_project and m.role in ('pm', 'coordinator')
     and pr.status = 'active' and m.user_id <> p_user;
end;
$$;

revoke all on function public.notify_join_requested(uuid, uuid) from public, anon, authenticated;

/**
 * Ask to join a Workspace work project. The caller is an active member of its
 * space and not on the project, and the project is not archived. Asking again
 * while a request is open returns that request.
 */
create or replace function public.request_join_general_project(p_project uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p  public.general_projects;
  v_id uuid;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to ask to join a project.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into p from public.general_projects where id = p_project;
  if p.id is null or p.trashed_at is not null or p.class_board_id is not null
     or p.visibility <> 'workspace' or not public.is_general_space_member(p.space_id) then
    raise exception 'That project does not take join requests. Ask its project manager for an invitation.'
      using errcode = 'insufficient_privilege';
  end if;
  if p.archived_at is not null or public.general_space_is_archived(p.space_id) then
    raise exception 'That project is archived, so it cannot take new members.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_members
              where project_id = p_project and user_id = auth.uid()) then
    raise exception 'You are already on this project.' using errcode = 'unique_violation';
  end if;

  select id into v_id from public.general_join_requests
   where project_id = p_project and user_id = auth.uid() and status = 'open';
  if v_id is not null then
    return v_id;
  end if;

  perform public.rate_limit('general_join_request', 20, interval '1 hour',
    'You have asked to join a lot of projects in the last hour. Try again later.');

  insert into public.general_join_requests (project_id, user_id)
  values (p_project, auth.uid())
  returning id into v_id;

  perform public.notify_join_requested(p_project, auth.uid());
  return v_id;
end;
$$;

revoke all on function public.request_join_general_project(uuid) from public, anon;
grant execute on function public.request_join_general_project(uuid) to authenticated;

/** The requester takes back their own open request. */
create or replace function public.withdraw_join_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.general_join_requests;
begin
  select * into r from public.general_join_requests where id = p_request for update;
  if r.id is null or r.user_id is distinct from auth.uid() then
    raise exception 'That request is not yours to withdraw.'
      using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'open' then
    raise exception 'That request was already answered or withdrawn. Reload the page.'
      using errcode = 'check_violation';
  end if;

  update public.general_join_requests
     set status = 'withdrawn', answered_by = auth.uid(), answered_at = now()
   where id = p_request;
end;
$$;

revoke all on function public.withdraw_join_request(uuid) from public, anon;
grant execute on function public.withdraw_join_request(uuid) to authenticated;

/**
 * The project manager or a coordinator approves or declines an open request.
 * Approving adds the requester with p_role, under the invite rules (no pm; only
 * the project manager gives coordinator), and only while the project is still
 * Workspace and the requester is still in its space. Declining is always open.
 * Either answer notifies the requester.
 */
create or replace function public.answer_join_request(p_request uuid, p_approve boolean,
                                                      p_role public.general_role default 'member')
returns void language plpgsql security definer set search_path = public as $$
declare
  r       public.general_join_requests;
  v_name  text;
  my_role public.general_role;
begin
  select * into r from public.general_join_requests where id = p_request for update;
  if r.id is null then
    raise exception 'That request is not there any more. Reload the page.'
      using errcode = 'no_data_found';
  end if;

  my_role := public.general_role_of(r.project_id, auth.uid());
  if my_role is null or my_role not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator can answer a join request.'
      using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'open' then
    raise exception 'That request was already answered or withdrawn. Reload the page.'
      using errcode = 'check_violation';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception '%', public.general_archived_message(r.project_id)
      using errcode = 'check_violation';
  end if;

  select name into v_name from public.general_projects where id = r.project_id;

  if not coalesce(p_approve, false) then
    update public.general_join_requests
       set status = 'declined', answered_by = auth.uid(), answered_at = now()
     where id = p_request;
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    values (r.user_id, 'join_answered'::public.notification_type, r.project_id,
            'Your request to join ' || v_name || ' was declined', null);
    return;
  end if;

  -- A request outlives what made it valid: the project can turn Private, or the
  -- requester leave the space. general_space_members is read for the requester,
  -- not the caller, so is_general_space_member (auth.uid()) does not fit here.
  if not exists (select 1 from public.general_projects p
                  where p.id = r.project_id and p.visibility = 'workspace'
                    and exists (select 1 from public.general_space_members s
                                 where s.space_id = p.space_id and s.user_id = r.user_id)) then
    raise exception 'That request can''t be approved any more. The project is private or they left the space.'
      using errcode = 'check_violation';
  end if;

  if p_role is null then
    raise exception 'Pick a role for them to join with.' using errcode = 'check_violation';
  end if;
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'coordinator' and my_role <> 'pm' then
    raise exception 'Only the project manager can add a coordinator.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = r.user_id and status <> 'rejected') then
    raise exception 'That account cannot join this project.' using errcode = 'check_violation';
  end if;

  -- general_members_close_join_request closes the request as it inserts; the
  -- update below records this answer's role either way.
  insert into public.general_members (project_id, user_id, role)
  values (r.project_id, r.user_id, p_role)
  on conflict do nothing;

  update public.general_join_requests
     set status = 'approved', role = p_role, answered_by = auth.uid(), answered_at = now()
   where id = p_request;

  insert into public.notifications (user_id, type, general_project_id, title, preview)
  values (r.user_id, 'join_answered'::public.notification_type, r.project_id,
          'You joined ' || v_name, null);
end;
$$;

revoke all on function public.answer_join_request(uuid, boolean, public.general_role) from public, anon;
grant execute on function public.answer_join_request(uuid, boolean, public.general_role) to authenticated;

/** Someone who joins a project by any path no longer has an open request on it. */
create or replace function public.close_general_join_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.general_join_requests
     set status = 'approved', role = new.role, answered_by = auth.uid(), answered_at = now()
   where project_id = new.project_id and user_id = new.user_id and status = 'open';
  return null;
end;
$$;

revoke all on function public.close_general_join_request() from public, anon, authenticated;

drop trigger if exists general_members_close_join_request on public.general_members;
create trigger general_members_close_join_request
  after insert on public.general_members
  for each row execute function public.close_general_join_request();

/** A project that turns Private takes no more requests: its open ones close as withdrawn. */
create or replace function public.close_general_join_requests_private()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.general_join_requests
     set status = 'withdrawn', answered_by = auth.uid(), answered_at = now()
   where project_id = new.id and status = 'open';
  return null;
end;
$$;

revoke all on function public.close_general_join_requests_private() from public, anon, authenticated;

drop trigger if exists general_projects_close_join_requests on public.general_projects;
create trigger general_projects_close_join_requests
  after update of visibility on public.general_projects
  for each row
  when (new.visibility = 'private' and old.visibility is distinct from 'private')
  execute function public.close_general_join_requests_private();

/** Somebody who leaves a space has their open requests on its projects closed as withdrawn. */
create or replace function public.close_general_join_requests_left_space()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.general_join_requests j
     set status = 'withdrawn', answered_by = auth.uid(), answered_at = now()
    from public.general_projects p
   where p.id = j.project_id and p.space_id = old.space_id
     and j.user_id = old.user_id and j.status = 'open';
  return null;
end;
$$;

revoke all on function public.close_general_join_requests_left_space() from public, anon, authenticated;

drop trigger if exists general_space_members_close_join_requests on public.general_space_members;
create trigger general_space_members_close_join_requests
  after delete on public.general_space_members
  for each row execute function public.close_general_join_requests_left_space();

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.general_join_requests;
exception when duplicate_object then null; end $$;

commit;
