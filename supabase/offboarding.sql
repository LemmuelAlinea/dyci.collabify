-- Collabify — offboarding: the admin deactivates a member and hands over everything they run
-- in one step.
--
--   node scripts/db.mjs supabase/offboarding.sql supabase/anon-lockdown.sql
--
-- Owns admin_offboarding_preview (what the person holds, for the dialog) and
-- admin_offboard_member (the handover and the deactivation, in one transaction), plus the
-- audit values 'offboarded' and 'space_pm_assigned'. Runs after offices.sql (it uses
-- office_admin_reads()) and before anon-lockdown.sql.
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
 * that no longer applies is skipped, not refused.
 */
create or replace function public.admin_offboard_member(p_user uuid, p_successor uuid,
                                                        p_overrides jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_admin   uuid := auth.uid();
  v_target  public.profiles%rowtype;
  v_succ    public.profiles%rowtype;
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
    select * into v_succ from public.profiles where id = v_id for share;
    if v_succ.id is null or v_succ.role is distinct from 'member' or v_succ.status is distinct from 'active' then
      raise exception 'Only an active member can take over.' using errcode = 'check_violation';
    end if;
    if not v_succ.can_manage_projects then
      raise exception '% needs Project manager turned on first. Turn it on in Accounts.',
        public.audit_label(v_id) using errcode = 'check_violation';
    end if;
  end loop;

  -- Spaces they run: the successor joins if absent, the target steps aside to Coordinator
  -- first (one pm row per space), then the successor becomes PM.
  for rec in
    select s.id from public.general_spaces s
      join public.general_space_members m on m.space_id = s.id
     where m.user_id = p_user and m.role = 'pm' and s.kind = 'work' and s.trashed_at is null
     order by s.id
       for update of s, m
  loop
    v_to := coalesce((p_overrides ->> rec.id::text)::uuid, p_successor);
    insert into public.general_space_members (space_id, user_id, role)
    values (rec.id, v_to, 'member')
    on conflict do nothing;
    perform 1 from public.general_space_members
     where space_id = rec.id and user_id = v_to for update;
    update public.general_space_members set role = 'coordinator'
     where space_id = rec.id and user_id = p_user;
    update public.general_space_members set role = 'pm'
     where space_id = rec.id and user_id = v_to;
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
          array_to_string(v_parts, ', '), public.audit_label(p_successor));
end;
$$;

-- ---------------------------------------------------------------- grants

-- Anyone signed in may call them; only an active admin gets past the first line.
revoke all on function public.admin_offboarding_preview(uuid) from public, anon;
revoke all on function public.admin_offboard_member(uuid, uuid, jsonb) from public, anon;
grant execute on function public.admin_offboarding_preview(uuid) to authenticated;
grant execute on function public.admin_offboard_member(uuid, uuid, jsonb) to authenticated;

commit;
