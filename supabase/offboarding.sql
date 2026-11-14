-- Collabify — offboarding: the admin deactivates a member and hands over everything they run
-- in one step.
--
--   node scripts/db.mjs supabase/offboarding.sql supabase/anon-lockdown.sql
--
-- Owns admin_offboarding_preview (what the person holds, for the dialog),
-- admin_offboard_member (the handover and the deactivation, in one transaction),
-- admin_assign_space_pm (a PM for a space whose PM no longer works), the oversight reads
-- admin_spaces_without_pm and admin_project_offices, the internal helpers
-- offboarding_require_successor and offboarding_space_to, and the audit values 'offboarded'
-- and 'space_pm_assigned'. Runs after offices.sql (it uses office_admin_reads()) and before
-- anon-lockdown.sql.
--
-- Work spaces and work projects only, live (not trashed); archived ones are handed over too,
-- because they still need an owner if restored. Open tasks are those not done, not trashed,
-- not archived, in a work project that is not archived, planning tasks included.
--
-- Nothing an earlier file owns is redefined. The handover reproduces the end state of
-- hand_over_general_space and assign_general_project_pm rather than calling them: the first
-- refuses the admin and archived spaces, the second refuses while the PM is still active.
-- The existing guards pass on their own existing switches, each set only around the
-- statement that needs it and turned off straight after:
--   collabify.team_leader_clear   guard_general_structure lets a leader seat clear on an
--                                 archived project (project-team-leads.sql).
--   collabify.space_role_cascade  guard_general_task_child lets the caller, who is not on the
--                                 project, delete an assignee row (space-roles.sql).
-- Moving a review seat writes general_tasks.reviewer_id, which guard_general_task refuses to
-- anyone not on the project before it reads any switch. That one statement runs with the
-- request's claims cleared (auth.uid() null, the system path), the way
-- project-workflow-rules.sql runs its rules, and the admin's claims come straight back.
-- That path also moves reviews on archived tasks and in archived projects, which the
-- guard's archived refusals would stop for a person: by design, because archived projects
-- are handed over too. This file depends on guard_general_task keeping its
-- `auth.uid() is null` early return; a future change to that guard must keep the system
-- path, or the review step here breaks.
--
-- The function writes no task history: record_general_assignee_event writes 'unassigned' for
-- each assignee row removed, and log_profile_change writes the status row.
--
-- Idempotent. Safe to re-run.

-- A new enum value cannot be used in the transaction that adds it, so they commit first.
begin;

do $$
begin
  alter type public.audit_action add value if not exists 'offboarded';
  alter type public.audit_action add value if not exists 'space_pm_assigned';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- internal helpers

/**
 * Refuses anyone who cannot take over a space or project: an active member account with
 * Project manager on. Locks their profile so they stay eligible until the caller commits.
 */
create or replace function public.offboarding_require_successor(p_user uuid)
returns void language plpgsql set search_path = public as $$
declare
  v_succ public.profiles%rowtype;
begin
  select * into v_succ from public.profiles where id = p_user for share;
  if v_succ.id is null or v_succ.role is distinct from 'member' or v_succ.status is distinct from 'active' then
    raise exception 'Only an active member can take over.' using errcode = 'check_violation';
  end if;
  if not v_succ.can_manage_projects then
    raise exception '% needs Project manager turned on first. Turn it on in Accounts.',
      public.audit_label(p_user) using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * Makes p_to the space's PM as hand_over_general_space leaves it: they join as a member if
 * absent, p_from (the PM the caller found and locked; null for none) steps aside to
 * Coordinator first (one pm row per space), then p_to becomes PM. Only p_from is ever
 * demoted: if p_from no longer holds pm it refuses, and if someone else took the pm row in
 * the meantime general_space_members_one_pm refuses the promotion, so a PM the caller did
 * not see is never demoted. The caller has already locked the space.
 */
drop function if exists public.offboarding_space_to(uuid, uuid);
create or replace function public.offboarding_space_to(p_space uuid, p_to uuid, p_from uuid)
returns void language plpgsql set search_path = public as $$
declare
  n int;
begin
  insert into public.general_space_members (space_id, user_id, role)
  values (p_space, p_to, 'member')
  on conflict do nothing;
  perform 1 from public.general_space_members
   where space_id = p_space and user_id = p_to for update;
  if p_from is not null then
    update public.general_space_members set role = 'coordinator'
     where space_id = p_space and user_id = p_from and role = 'pm';
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'This space already has a project manager.' using errcode = 'check_violation';
    end if;
  end if;
  update public.general_space_members set role = 'pm'
   where space_id = p_space and user_id = p_to;
end;
$$;

-- ---------------------------------------------------------------- preview

/**
 * One row per thing the person holds: spaces and projects they run, teams they lead, one
 * line per project with reviews waiting on them (task_count), and one open_tasks line
 * (item_id null) with how many open tasks they hold. Zero rows when they hold nothing.
 * Names and counts only.
 */
create or replace function public.admin_offboarding_preview(p_user uuid)
returns table (kind text, item_id uuid, item_name text, project_name text, space_name text,
               office_name text, archived boolean, task_count int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can offboard someone.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with office as (
    select os.space_id, o.name
      from public.office_spaces os
      join public.offices o on o.id = os.office_id and o.archived_at is null
  ),
  lines as (
    select 1 as ord, 'space_pm'::text as k, s.id as iid, s.name as iname, null::text as pname,
           s.name as sname, coalesce(oo.name, '') as oname, s.archived_at is not null as arch,
           null::int as n
      from public.general_space_members m
      join public.general_spaces s on s.id = m.space_id
      left join office oo on oo.space_id = s.id
     where m.user_id = p_user and m.role = 'pm'
       and s.kind = 'work' and s.trashed_at is null
    union all
    select 2, 'project_pm', p.id, p.name, p.name, s.name, coalesce(oo.name, ''),
           p.archived_at is not null, null::int
      from public.general_members m
      join public.general_projects p on p.id = m.project_id
      join public.general_spaces s on s.id = p.space_id
      left join office oo on oo.space_id = s.id
     where m.user_id = p_user and m.role = 'pm'
       and p.class_board_id is null and p.trashed_at is null
    union all
    select 3, 'team_lead', g.id, g.name, p.name, s.name, coalesce(oo.name, ''),
           p.archived_at is not null, null::int
      from public.general_teams g
      join public.general_projects p on p.id = g.project_id
      join public.general_spaces s on s.id = p.space_id
      left join office oo on oo.space_id = s.id
     where g.leader_id = p_user
       and p.class_board_id is null and p.trashed_at is null
    union all
    select 4, 'reviewer', p.id, p.name, p.name, s.name, coalesce(oo.name, ''),
           p.archived_at is not null, count(*)::int
      from public.general_tasks t
      join public.general_projects p on p.id = t.project_id
      join public.general_spaces s on s.id = p.space_id
      left join office oo on oo.space_id = s.id
     where t.reviewer_id = p_user and t.routing_state = 'coordinator_review'
       and t.trashed_at is null
       and p.class_board_id is null and p.trashed_at is null
     group by p.id, p.name, s.name, oo.name, p.archived_at
    union all
    select 5, 'open_tasks', null::uuid, '', null::text, null::text, null::text, false, x.n
      from (select count(*)::int as n
              from public.general_task_assignees a
              join public.general_tasks t on t.id = a.task_id
              join public.general_projects p on p.id = t.project_id
             where a.user_id = p_user
               and t.status <> 'done' and t.trashed_at is null and t.archived_at is null
               and p.class_board_id is null and p.archived_at is null) x
     where x.n > 0
  )
  select l.k, l.iid, l.iname, l.pname, l.sname, l.oname, l.arch, l.n
    from lines l
   order by l.ord, lower(l.iname), l.iid;
end;
$$;

-- ---------------------------------------------------------------- the offboard

/**
 * Hands everything the person runs to p_successor (or, per space or project id, to the
 * person p_overrides names), empties the team-lead seats they hold, moves the reviews
 * waiting on them to each project's new PM, takes them off their open tasks, deactivates
 * them and writes one 'offboarded' audit row. One transaction: a refusal anywhere changes
 * nothing. It works from the database as it is at the call, so a line the preview showed
 * that no longer applies is skipped, not refused. p_successor may be null only when they run
 * no space and no project (no overrides then), and each project they review in already has
 * a working PM; the audit row's after_value is then ''.
 */
create or replace function public.admin_offboard_member(p_user uuid, p_successor uuid,
                                                        p_overrides jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_admin   uuid := auth.uid();
  v_target  public.profiles%rowtype;
  v_ids     uuid[];
  v_id      uuid;
  v_to      uuid;
  v_spaces  int := 0;
  v_proj    int := 0;
  v_teams   int := 0;
  v_tasks   int := 0;
  v_parts   text[] := '{}';
  v_claims  text;
  v_sub     text;
  rec       record;
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can offboard someone.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_target from public.profiles where id = p_user for update;
  if v_target.id is null or v_target.role is distinct from 'member'
     or v_target.status is distinct from 'active' or v_target.id = v_admin then
    raise exception 'Only an active member can be offboarded here.' using errcode = 'check_violation';
  end if;

  -- Every successor: the main one and any override, each locked so they stay eligible.
  if jsonb_typeof(coalesce(p_overrides, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Choose someone else to take over.' using errcode = 'invalid_parameter_value';
  end if;
  if p_successor is null then
    -- No successor: allowed only when they run no space and no project now. Their teams,
    -- tasks and reviews need nobody new (reviews go to each project's PM, checked below).
    if coalesce(p_overrides, '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'Choose someone to take over their spaces and projects.' using errcode = 'check_violation';
    end if;
    perform 1 from public.general_space_members m
      join public.general_spaces s on s.id = m.space_id
     where m.user_id = p_user and m.role = 'pm' and s.kind = 'work' and s.trashed_at is null
       for update of m;
    if found then
      raise exception 'Choose someone to take over their spaces and projects.' using errcode = 'check_violation';
    end if;
    perform 1 from public.general_members m
      join public.general_projects p on p.id = m.project_id
     where m.user_id = p_user and m.role = 'pm' and p.class_board_id is null and p.trashed_at is null
       for update of m;
    if found then
      raise exception 'Choose someone to take over their spaces and projects.' using errcode = 'check_violation';
    end if;
  else
    v_ids := array(select distinct x from (
               select p_successor as x
               union all
               select (e.value #>> '{}')::uuid from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
             ) s order by x);
    foreach v_id in array v_ids loop
      if v_id is null or v_id = p_user then
        raise exception 'Choose someone else to take over.' using errcode = 'check_violation';
      end if;
    end loop;
    foreach v_id in array v_ids loop
      perform public.offboarding_require_successor(v_id);
    end loop;
  end if;

  -- Spaces they run: the successor joins if absent, the target steps aside to Coordinator
  -- first (one pm row per space), then the successor becomes PM (offboarding_space_to).
  for rec in
    select s.id from public.general_spaces s
      join public.general_space_members m on m.space_id = s.id
     where m.user_id = p_user and m.role = 'pm' and s.kind = 'work' and s.trashed_at is null
     order by s.id
       for update of s, m
  loop
    v_to := coalesce((p_overrides ->> rec.id::text)::uuid, p_successor);
    if v_to is null then  -- a seat that arrived after the no-successor check
      raise exception 'Choose someone to take over their spaces and projects.' using errcode = 'check_violation';
    end if;
    perform public.offboarding_space_to(rec.id, v_to, p_user);
    v_spaces := v_spaces + 1;
  end loop;

  -- Projects they run: as assign_general_project_pm leaves it. The successor's existing row
  -- is promoted, never duplicated, and their grants and open access requests there go.
  for rec in
    select p.id from public.general_projects p
      join public.general_members m on m.project_id = p.id
     where m.user_id = p_user and m.role = 'pm'
       and p.class_board_id is null and p.trashed_at is null
     order by p.id
       for update of p, m
  loop
    v_to := coalesce((p_overrides ->> rec.id::text)::uuid, p_successor);
    if v_to is null then  -- a seat that arrived after the no-successor check
      raise exception 'Choose someone to take over their spaces and projects.' using errcode = 'check_violation';
    end if;
    insert into public.general_members (project_id, user_id, role)
    values (rec.id, v_to, 'member')
    on conflict do nothing;
    perform 1 from public.general_members
     where project_id = rec.id and user_id = v_to for update;
    update public.general_members set role = 'coordinator'
     where project_id = rec.id and user_id = p_user;
    update public.general_members set role = 'pm'
     where project_id = rec.id and user_id = v_to;
    delete from public.general_grants where project_id = rec.id and user_id = v_to;
    update public.general_access_requests
       set status = 'withdrawn', answered_at = now()
     where project_id = rec.id and user_id = v_to and status = 'open';
    v_proj := v_proj + 1;
  end loop;

  -- Teams they lead: the seat is emptied and the project's PM picks a new lead.
  perform 1 from public.general_teams g
    join public.general_projects p on p.id = g.project_id
   where g.leader_id = p_user and p.class_board_id is null and p.trashed_at is null
     for update of g;
  perform set_config('collabify.team_leader_clear', 'on', true);
  update public.general_teams g set leader_id = null
    from public.general_projects p
   where p.id = g.project_id and g.leader_id = p_user
     and p.class_board_id is null and p.trashed_at is null;
  get diagnostics v_teams = row_count;
  perform set_config('collabify.team_leader_clear', 'off', true);

  -- Reviews waiting on them go to each project's PM as it stands now. A project with no PM
  -- row keeps its review seats.
  perform 1 from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
   where t.reviewer_id = p_user and t.routing_state = 'coordinator_review'
     and t.trashed_at is null and p.class_board_id is null and p.trashed_at is null
     for update of t;
  -- With no successor, no PM changes here, so each project they review in must already have
  -- a working PM (active, Project manager on) to take the reviews, or nothing happens.
  if p_successor is null then
    perform 1 from public.general_tasks t
      join public.general_projects p on p.id = t.project_id
     where t.reviewer_id = p_user and t.routing_state = 'coordinator_review'
       and t.trashed_at is null and p.class_board_id is null and p.trashed_at is null
       and not exists (
             select 1 from public.general_members m
               join public.profiles pr on pr.id = m.user_id
              where m.project_id = p.id and m.role = 'pm'
                and pr.status = 'active' and pr.can_manage_projects);
    if found then
      raise exception 'A project they review in has no working project manager. Assign one first.'
        using errcode = 'check_violation';
    end if;
  end if;
  -- guard_general_task checks project membership for auth.uid() before it reads any switch,
  -- and the admin is never a member, so this one statement runs on the system path
  -- (auth.uid() null), as project-workflow-rules.sql runs its rules. The admin's claims come
  -- back straight after it, and on an error before it re-raises.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  begin
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    update public.general_tasks t set reviewer_id = m.user_id
      from public.general_projects p, public.general_members m
     where p.id = t.project_id and m.project_id = t.project_id and m.role = 'pm'
       and t.reviewer_id = p_user and t.routing_state = 'coordinator_review'
       and t.trashed_at is null and p.class_board_id is null and p.trashed_at is null;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    raise;
  end;

  -- Open tasks they hold: only their own assignee row goes; co-assignees stay. Done,
  -- archived and trashed tasks, and tasks in an archived project, keep their name.
  perform 1 from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
    join public.general_task_assignees a on a.task_id = t.id and a.user_id = p_user
   where t.status <> 'done' and t.trashed_at is null and t.archived_at is null
     and p.class_board_id is null and p.archived_at is null
     for update of t;
  perform set_config('collabify.space_role_cascade', 'on', true);
  delete from public.general_task_assignees a
   using public.general_tasks t, public.general_projects p
   where a.task_id = t.id and t.project_id = p.id and a.user_id = p_user
     and t.status <> 'done' and t.trashed_at is null and t.archived_at is null
     and p.class_board_id is null and p.archived_at is null;
  get diagnostics v_tasks = row_count;
  perform set_config('collabify.space_role_cascade', 'off', true);

  -- Deactivated, as set_account_active does it.
  update public.profiles
     set status = 'rejected', decided_by = v_admin, decided_at = now()
   where id = p_user;

  if v_spaces > 0 then
    v_parts := v_parts || (v_spaces || case when v_spaces = 1 then ' space' else ' spaces' end);
  end if;
  if v_proj > 0 then
    v_parts := v_parts || (v_proj || case when v_proj = 1 then ' project' else ' projects' end);
  end if;
  if v_teams > 0 then
    v_parts := v_parts || (v_teams || case when v_teams = 1 then ' team' else ' teams' end);
  end if;
  if v_tasks > 0 then
    v_parts := v_parts || (v_tasks || case when v_tasks = 1 then ' task' else ' tasks' end);
  end if;

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('offboarded', v_admin, p_user, public.audit_label(p_user),
          array_to_string(v_parts, ', '),
          case when p_successor is null then '' else public.audit_label(p_successor) end);
end;
$$;

-- ---------------------------------------------------------------- a stuck space

/**
 * Gives a work space a PM when its own no longer works: no pm row, or the PM's account is
 * not active, or their Project manager switch is off. Same successor rules and end state as
 * the offboard's space step; the old PM, if any, stays on as Coordinator. Writes one
 * 'space_pm_assigned' audit row (before: the old PM's name, or ''). Archived spaces too;
 * trashed ones are gone.
 *
 * Lock order: profiles first (the successor's, then the PM's as first read), then the space
 * row and its pm row, as admin_offboard_member locks its target's profile before any space,
 * so the two cannot deadlock on each other. The PM is read again in its own statement after
 * the pm row lock (a fresh snapshot after any wait, so a hand-over that commits meanwhile is
 * seen) and their profile is locked whatever it says, so a switch turned on concurrently
 * waits for this call or is seen by it.
 */
create or replace function public.admin_assign_space_pm(p_space uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name   text;
  v_pm     uuid;
  v_first  uuid;
  v_status public.account_status;
  v_switch boolean;
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can give a space a project manager.'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.offboarding_require_successor(p_user);

  select m.user_id into v_first from public.general_space_members m
   where m.space_id = p_space and m.role = 'pm';
  if v_first is not null then
    perform 1 from public.profiles where id = v_first for share;
  end if;

  select s.name into v_name from public.general_spaces s
   where s.id = p_space and s.kind = 'work' and s.trashed_at is null
     for update;
  if not found then
    raise exception 'That space no longer exists. Refresh the page.' using errcode = 'no_data_found';
  end if;

  perform 1 from public.general_space_members
   where space_id = p_space and role = 'pm' for update;
  select m.user_id into v_pm from public.general_space_members m
   where m.space_id = p_space and m.role = 'pm';
  if v_pm is not null then
    select p.status, p.can_manage_projects into v_status, v_switch
      from public.profiles p where p.id = v_pm for share;
    if v_status = 'active' and v_switch then
      raise exception 'This space already has a project manager.' using errcode = 'check_violation';
    end if;
  end if;

  perform public.offboarding_space_to(p_space, p_user, v_pm);

  insert into public.audit_events
    (action, actor_id, subject_id, subject_label, before_value, after_value)
  values ('space_pm_assigned', auth.uid(), p_space, v_name,
          case when v_pm is null then '' else public.audit_label(v_pm) end,
          public.audit_label(p_user));
end;
$$;

-- ---------------------------------------------------------------- oversight reads

/**
 * Live (not archived, not trashed) work spaces with no working PM, by the rule above, with
 * their office's name: '' when unfiled or the office is archived. Filed spaces first, by
 * office, then unfiled. Zero rows for anyone but an active admin.
 */
create or replace function public.admin_spaces_without_pm()
returns table (space_id uuid, space_name text, office_name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, coalesce(o.name, '')
    from public.general_spaces s
    left join public.office_spaces os on os.space_id = s.id
    left join public.offices o on o.id = os.office_id and o.archived_at is null
   where public.office_admin_reads()
     and s.kind = 'work' and s.archived_at is null and s.trashed_at is null
     and not exists (select 1
                       from public.general_space_members m
                       join public.profiles p on p.id = m.user_id
                      where m.space_id = s.id and m.role = 'pm'
                        and p.status = 'active' and p.can_manage_projects)
   order by o.name is null, lower(o.name), lower(s.name), s.id;
$$;

/**
 * Every work project not in the trash, with its space's live office: office_id null and
 * office_name '' when the space is unfiled or its office is archived. Zero rows for anyone
 * but an active admin.
 */
create or replace function public.admin_project_offices()
returns table (project_id uuid, office_id uuid, office_name text)
language sql stable security definer set search_path = public as $$
  select p.id, o.id, coalesce(o.name, '')
    from public.general_projects p
    left join public.office_spaces os on os.space_id = p.space_id
    left join public.offices o on o.id = os.office_id and o.archived_at is null
   where public.office_admin_reads()
     and p.class_board_id is null and p.trashed_at is null;
$$;

-- ---------------------------------------------------------------- grants

-- Internal helpers: nobody calls them directly.
revoke all on function public.offboarding_require_successor(uuid) from public, anon, authenticated;
revoke all on function public.offboarding_space_to(uuid, uuid, uuid) from public, anon, authenticated;

-- Anyone signed in may call them; only an active admin gets past the first line.
revoke all on function public.admin_offboarding_preview(uuid) from public, anon;
revoke all on function public.admin_offboard_member(uuid, uuid, jsonb) from public, anon;
revoke all on function public.admin_assign_space_pm(uuid, uuid) from public, anon;
revoke all on function public.admin_spaces_without_pm() from public, anon;
revoke all on function public.admin_project_offices() from public, anon;
grant execute on function public.admin_offboarding_preview(uuid) to authenticated;
grant execute on function public.admin_offboard_member(uuid, uuid, jsonb) to authenticated;
grant execute on function public.admin_assign_space_pm(uuid, uuid) to authenticated;
grant execute on function public.admin_spaces_without_pm() to authenticated;
grant execute on function public.admin_project_offices() to authenticated;

commit;
