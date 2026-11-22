begin;

-- supabase/work-workload.sql
-- Space workload, phase 1: task estimates (written only through
-- set_work_task_estimate, with a history row), weekly hours per work-space
-- membership (set_space_weekly_minutes) and personal time off (user_time_off);
-- the space load and hours functions; and Break down and balance's reads
-- (can_estimate_work_task, general_breakdown_context) and its one write
-- (apply_work_breakdown).
-- Work projects and work spaces only. Stored in minutes.
-- Runs after section-students.sql and before anon-lockdown.sql. Idempotent.
-- Redefines nothing another file owns. Suite: supabase/tests/work-workload.test.sql.

------------------------------------------------------------ estimates

alter table public.general_tasks
  add column if not exists estimated_minutes integer;

-- The first version checked estimated_minutes > 0 under the default name.
alter table public.general_tasks drop constraint if exists general_tasks_estimated_minutes_check;
alter table public.general_tasks drop constraint if exists general_tasks_estimated_minutes_range;
alter table public.general_tasks
  add constraint general_tasks_estimated_minutes_range
  check (estimated_minutes between 1 and 60000);

-- A person changes an estimate only through set_work_task_estimate, which sets
-- collabify.estimate_write around its one update. Service writes (no auth.uid())
-- pass, except that a class board task never carries an estimate.
create or replace function public.guard_work_task_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimated_minutes is not distinct from old.estimated_minutes then return new; end if;
  elsif new.estimated_minutes is null then
    return new;
  end if;

  if new.estimated_minutes is not null and exists (
    select 1 from public.general_projects p
     where p.id = new.project_id and p.class_board_id is not null
  ) then
    raise exception 'Estimates are for work projects only.' using errcode = 'check_violation';
  end if;

  if auth.uid() is not null
     and coalesce(current_setting('collabify.estimate_write', true), 'off') <> 'on' then
    raise exception 'Use the estimate field to change the estimate.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_work_estimate on public.general_tasks;
create trigger general_tasks_work_estimate
before insert or update of estimated_minutes on public.general_tasks
for each row execute function public.guard_work_task_estimate();

revoke all on function public.guard_work_task_estimate() from public, anon, authenticated;

-- Sets or clears (null) a task's estimate. The project manager and coordinators
-- estimate any task; a holder estimates a task they hold. Writes one 'updated'
-- history row: fields ["estimated_minutes"], estimate_from, estimate_to.
create or replace function public.set_work_task_estimate(p_task uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.general_tasks%rowtype;
  proj   public.general_projects%rowtype;
  prior  text := coalesce(current_setting('collabify.estimate_write', true), 'off');
begin
  if auth.uid() is null then
    raise exception 'Sign in to change the estimate.' using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found. Refresh the page and try again.' using errcode = 'no_data_found';
  end if;
  select * into proj from public.general_projects where id = t.project_id;

  if proj.class_board_id is not null then
    raise exception 'Estimates are for work projects only.' using errcode = 'check_violation';
  end if;

  if not (
    public.general_can_write(t.project_id)
    and (
      coalesce(public.general_role_of(t.project_id, auth.uid())::text, '') in ('pm', 'coordinator')
      or exists (select 1 from public.general_task_assignees a
                  where a.task_id = t.id and a.user_id = auth.uid())
    )
  ) then
    raise exception 'Only the project manager, coordinators or the task''s holder can change the estimate.'
      using errcode = 'insufficient_privilege';
  end if;

  if proj.archived_at is not null or proj.trashed_at is not null then
    raise exception 'This project is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if t.archived_at is not null or t.trashed_at is not null then
    raise exception 'This task is archived. Restore it to change the estimate.'
      using errcode = 'check_violation';
  end if;

  if p_minutes is not null and (p_minutes < 1 or p_minutes > 60000) then
    raise exception 'Estimates run between 1 minute and 1000 hours. Enter a value in that range.'
      using errcode = 'check_violation';
  end if;

  if t.estimated_minutes is not distinct from p_minutes then
    return;
  end if;

  perform set_config('collabify.estimate_write', 'on', true);
  update public.general_tasks set estimated_minutes = p_minutes where id = t.id;
  perform set_config('collabify.estimate_write', prior, true);

  insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
  values (t.id, t.project_id, auth.uid(), 'updated',
          jsonb_build_object(
            'status', t.status,
            'fields', jsonb_build_array('estimated_minutes'),
            'estimate_from', t.estimated_minutes,
            'estimate_to', p_minutes));
end;
$$;

revoke all on function public.set_work_task_estimate(uuid, int) from public, anon;
grant execute on function public.set_work_task_estimate(uuid, int) to authenticated;

------------------------------------------------------------ weekly hours

-- One row per work-space membership. Null weekly_minutes means not set; it is
-- never read as zero or as a default. Read only through definer functions:
-- RLS is on and there are no policies.
create table if not exists public.general_space_capacity (
  space_id       uuid not null,
  user_id        uuid not null,
  weekly_minutes int check (weekly_minutes between 0 and 10080),
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (space_id, user_id),
  foreign key (space_id, user_id)
    references public.general_space_members (space_id, user_id) on delete cascade
);

alter table public.general_space_capacity enable row level security;

-- Sets or clears (null) someone's weekly hours in a work space. A person sets
-- their own; the space's project manager and coordinators set anyone's.
create or replace function public.set_space_weekly_minutes(p_space uuid, p_user uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.general_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change weekly hours.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.general_spaces s where s.id = p_space and s.kind = 'work')
     or exists (select 1 from public.classes c where c.space_id = p_space) then
    raise exception 'Weekly hours apply to work spaces only.' using errcode = 'check_violation';
  end if;

  select m.role into me from public.general_space_members m
   where m.space_id = p_space and m.user_id = auth.uid();
  if p_user is distinct from auth.uid()
     and coalesce(me::text, '') not in ('pm', 'coordinator') then
    raise exception 'Only the space''s project manager or coordinators can set someone else''s weekly hours.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.general_space_members m
                  where m.space_id = p_space and m.user_id = p_user) then
    raise exception 'They are not in this space. Add them to the space first.' using errcode = 'no_data_found';
  end if;

  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if p_minutes is not null and (p_minutes < 0 or p_minutes > 10080) then
    raise exception 'Weekly hours run between 0 and 168 hours. Enter a value in that range.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_space_capacity (space_id, user_id, weekly_minutes, updated_by, updated_at)
  values (p_space, p_user, p_minutes, auth.uid(), now())
  on conflict (space_id, user_id) do update
     set weekly_minutes = excluded.weekly_minutes,
         updated_by     = excluded.updated_by,
         updated_at     = excluded.updated_at;
end;
$$;

revoke all on function public.set_space_weekly_minutes(uuid, uuid, int) from public, anon;
grant execute on function public.set_space_weekly_minutes(uuid, uuid, int) to authenticated;

------------------------------------------------------------ time off

-- Per person, not per space. Null minutes means a full day. Only the person
-- reads and writes their own rows; planners see time off only as hours through
-- the workload functions.
create table if not exists public.user_time_off (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  off_on     date not null,
  minutes    int check (minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  unique (user_id, off_on)
);

alter table public.user_time_off enable row level security;

drop policy if exists user_time_off_select on public.user_time_off;
create policy user_time_off_select on public.user_time_off
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_time_off_insert on public.user_time_off;
create policy user_time_off_insert on public.user_time_off
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_time_off_update on public.user_time_off;
create policy user_time_off_update on public.user_time_off
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_time_off_delete on public.user_time_off;
create policy user_time_off_delete on public.user_time_off
  for delete to authenticated using (user_id = auth.uid());

------------------------------------------------------------ load and hours

-- Monday to Friday days from p_from to p_to, both included; 0 when p_to is
-- before p_from. Internal: not granted to clients.
create or replace function public.work_weekdays(p_from date, p_to date)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_from is null or p_to is null or p_to < p_from then 0
    else ((p_to - p_from + 1) / 7) * 5
       + (select count(*)::int
            from generate_series(0, (p_to - p_from + 1) % 7 - 1) i
           where (extract(isodow from p_from)::int - 1 + i) % 7 < 5)
  end;
$$;

revoke all on function public.work_weekdays(date, date) from public, anon, authenticated;

-- Refuses a signed-out caller, a class or missing space and a bad window.
create or replace function public.work_workload_check(p_space uuid, p_from date, p_to date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.general_viewer_active() then
    raise exception 'Sign in with an active account to see workload.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.general_spaces s where s.id = p_space and s.kind = 'work')
     or exists (select 1 from public.classes c where c.space_id = p_space) then
    raise exception 'Workload applies to work spaces only.' using errcode = 'check_violation';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date.' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a window of a year or less.' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function public.work_workload_check(uuid, date, date) from public, anon, authenticated;

-- The space members the caller sees in workload: the space's project manager
-- and coordinators see everyone; a project manager or coordinator of a live work
-- project in the space sees that project's members; everyone sees themselves.
create or replace function public.work_workload_people(p_space uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
    from public.general_space_members m
   where m.space_id = p_space
     and (
       m.user_id = auth.uid()
       or exists (select 1 from public.general_space_members me
                   where me.space_id = p_space and me.user_id = auth.uid()
                     and me.role in ('pm', 'coordinator'))
       or exists (select 1
                    from public.general_members pl
                    join public.general_projects q on q.id = pl.project_id
                    join public.general_members gm on gm.project_id = q.id and gm.user_id = m.user_id
                   where pl.user_id = auth.uid() and pl.role in ('pm', 'coordinator')
                     and q.space_id = p_space and q.class_board_id is null
                     and q.archived_at is null and q.trashed_at is null)
     );
$$;

revoke all on function public.work_workload_people(uuid) from public, anon, authenticated;

-- Whether the caller sees project p named on u's load (else it folds into
-- "other work in this space"): their own load, the space's project manager,
-- a project they plan, or, for a space coordinator, a project they can read.
create or replace function public.work_workload_names(p_space uuid, p_project uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user = auth.uid()
      or exists (select 1 from public.general_space_members me
                  where me.space_id = p_space and me.user_id = auth.uid() and me.role = 'pm')
      or exists (select 1 from public.general_members pl
                  where pl.project_id = p_project and pl.user_id = auth.uid()
                    and pl.role in ('pm', 'coordinator'))
      or (exists (select 1 from public.general_space_members me
                   where me.space_id = p_space and me.user_id = auth.uid() and me.role = 'coordinator')
          and coalesce(public.can_read_general_project(p_project), false));
$$;

revoke all on function public.work_workload_names(uuid, uuid, uuid) from public, anon, authenticated;

-- Each visible person's weekly minutes and available minutes in the window:
-- weekly / 5 a weekday, less that day's time off (a full day removes all of it,
-- hours never more than the day's share), floored at zero, rounded at the end.
-- Null weekly minutes means not set: available and time off stay null.
create or replace function public.general_space_people_hours(
  p_space uuid, p_from date, p_to date, p_users uuid[] default null)
returns table(user_id uuid, weekly_minutes int, available_minutes int, time_off_minutes int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.work_workload_check(p_space, p_from, p_to);

  return query
  with vis as (
    select v.v as uid
      from public.work_workload_people(p_space) v
     where p_users is null or v.v = any(p_users)
  ),
  cap as (
    select vis.uid, c.weekly_minutes as wk, c.weekly_minutes / 5.0 as share
      from vis
      left join public.general_space_capacity c on c.space_id = p_space and c.user_id = vis.uid
  ),
  days as (
    select d::date as day
      from generate_series(p_from, p_to, interval '1 day') d
     where extract(isodow from d) < 6
  )
  select cap.uid, cap.wk,
         case when cap.wk is not null then round(x.avail)::int end,
         case when cap.wk is not null then round(x.off)::int end
    from cap
    cross join lateral (
      select coalesce(sum(greatest(cap.share - r.removed, 0)), 0) as avail,
             coalesce(sum(r.removed), 0) as off
        from days
        left join public.user_time_off o on o.user_id = cap.uid and o.off_on = days.day
        cross join lateral (
          select case when o.id is null then 0
                      when o.minutes is null then cap.share
                      else least(o.minutes, cap.share) end as removed
        ) r
    ) x;
end;
$$;

revoke all on function public.general_space_people_hours(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.general_space_people_hours(uuid, date, date, uuid[]) to authenticated;

-- Each visible person's load in the window, one row per (person, project) with
-- work; project_id null is "other work in this space" the caller may not name.
-- Counts open, live, released tasks they hold in the space's live work projects
-- (a parent with live subtasks stops counting). A task's estimate splits evenly
-- among its holders and spreads over the weekdays from its start (or release,
-- or creation; today if later) to its due date; overdue or undated work falls
-- on today. Today means the next weekday on or after today (a weekend reads as
-- Monday). A span with no weekdays puts the whole share on its first day.
-- Tasks with no estimate are counted in unestimated, never as minutes.
-- p_skip_task leaves one task out: Break down and balance passes the parent,
-- which stops counting once its subtasks exist, so the review and
-- apply_work_breakdown's recheck never count it beside the new rows.
-- The first version had no p_skip_task; drop it so one overload remains.
drop function if exists public.general_space_people_load(uuid, date, date, uuid[]);
create or replace function public.general_space_people_load(
  p_space uuid, p_from date, p_to date, p_users uuid[] default null, p_skip_task uuid default null)
returns table(user_id uuid, project_id uuid, load_minutes int, unestimated int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  -- Today in Manila, moved to Monday on a weekend so overdue and undated work
  -- lands on a working day.
  v_today date := (now() at time zone 'Asia/Manila')::date
    + case extract(isodow from (now() at time zone 'Asia/Manila')::date)::int
        when 6 then 2 when 7 then 1 else 0 end;
begin
  perform public.work_workload_check(p_space, p_from, p_to);

  return query
  with vis as (
    select v.v as uid
      from public.work_workload_people(p_space) v
     where p_users is null or v.v = any(p_users)
  ),
  tasks as (
    select t.id, t.project_id as pid, t.estimated_minutes as est, sp.a, greatest(sp.e, sp.a) as e,
           (select count(*) from public.general_task_assignees h where h.task_id = t.id) as holders
      from public.general_tasks t
      join public.general_projects pr on pr.id = t.project_id
      cross join lateral (
        select (t.due_at at time zone 'Asia/Manila')::date as due,
               (coalesce(t.starts_at, t.sent_at, t.created_at) at time zone 'Asia/Manila')::date as st
      ) dt
      cross join lateral (
        select case when dt.due is null or dt.due < v_today then v_today else greatest(dt.st, v_today) end as a,
               case when dt.due is null or dt.due < v_today then v_today else dt.due end as e
      ) sp
     where pr.space_id = p_space and pr.class_board_id is null
       and pr.archived_at is null and pr.trashed_at is null
       and t.routing_state = 'released' and t.status <> 'done'
       and t.archived_at is null and t.trashed_at is null
       and (p_skip_task is null or t.id <> p_skip_task)
       and not exists (select 1 from public.general_tasks st
                        where st.parent_id = t.id and st.archived_at is null and st.trashed_at is null)
  ),
  portions as (
    select h.user_id as uid, tk.pid,
           case
             when tk.est is null then 0
             when public.work_weekdays(tk.a, tk.e) = 0 then
               case when tk.a between p_from and p_to then tk.est::numeric / tk.holders else 0 end
             else tk.est::numeric / tk.holders
                  * public.work_weekdays(greatest(tk.a, p_from), least(tk.e, p_to))
                  / public.work_weekdays(tk.a, tk.e)
           end as mins,
           (tk.est is null and tk.a <= p_to and tk.e >= p_from) as unest
      from tasks tk
      join public.general_task_assignees h on h.task_id = tk.id
      join vis on vis.uid = h.user_id
  ),
  per_project as (
    select po.uid, po.pid, sum(po.mins) as mins, count(*) filter (where po.unest) as unest
      from portions po
     group by po.uid, po.pid
    having sum(po.mins) > 0 or count(*) filter (where po.unest) > 0
  )
  select pp.uid,
         case when public.work_workload_names(p_space, pp.pid, pp.uid) then pp.pid end as npid,
         round(sum(pp.mins))::int,
         sum(pp.unest)::int
    from per_project pp
   group by pp.uid, npid;
end;
$$;

revoke all on function public.general_space_people_load(uuid, date, date, uuid[], uuid) from public, anon;
grant execute on function public.general_space_people_load(uuid, date, date, uuid[], uuid) to authenticated;

------------------------------------------------------------ break down and balance

-- Whether the caller may change this task's estimate: the same rule as
-- set_work_task_estimate (planners, or a holder, who can write; a live task in
-- a live work project). work-ai's Suggest estimate asks before the model runs.
create or replace function public.can_estimate_work_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.general_can_write(t.project_id)
       and (coalesce(public.general_role_of(t.project_id, auth.uid())::text, '') in ('pm', 'coordinator')
            or exists (select 1 from public.general_task_assignees a
                        where a.task_id = t.id and a.user_id = auth.uid()))
      from public.general_tasks t
      join public.general_projects p on p.id = t.project_id
     where t.id = p_task
       and auth.uid() is not null
       and p.class_board_id is null
       and p.archived_at is null and p.trashed_at is null
       and t.archived_at is null and t.trashed_at is null
  ), false);
$$;

revoke all on function public.can_estimate_work_task(uuid) from public, anon;
grant execute on function public.can_estimate_work_task(uuid) to authenticated;

-- What work-ai's breakdown and the review need about a parent task. Only the
-- project manager and coordinators who can write get it. `blocked` is the
-- reason the parent cannot be broken down, or null. Candidates are active
-- project members who can hold tasks (never QA or stakeholders) and are in the
-- project's space: in Planned, only the receiving team's members (as
-- general_handoff_assign_context(p, true) picks them); in Open, everyone on
-- the project who can hold tasks. Names are for the review; work-ai never
-- sends them to the model. Writes nothing.
create or replace function public.general_breakdown_context(p_parent uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t         public.general_tasks%rowtype;
  gp        public.general_projects%rowtype;
  v_blocked text;
  v_subs    boolean;
  v_lead    boolean;
  v_parent  jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to break down tasks.' using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.general_tasks where id = p_parent;
  if not found or not public.is_general_member(t.project_id) then
    raise exception 'Task not found. Refresh the page and try again.' using errcode = 'no_data_found';
  end if;
  select * into gp from public.general_projects where id = t.project_id;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date.' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Choose a window of a year or less.' using errcode = 'invalid_parameter_value';
  end if;

  v_subs := exists (select 1 from public.general_tasks st
                     where st.parent_id = t.id and st.archived_at is null and st.trashed_at is null);
  v_parent := jsonb_build_object(
    'id', t.id, 'project_id', t.project_id, 'title', t.title,
    'description', coalesce(t.description, ''), 'task_flow', gp.task_flow, 'team_id', t.team_id,
    'routing_state', t.routing_state, 'starts_at', t.starts_at, 'due_at', t.due_at,
    'has_subtasks', v_subs, 'allow_subtasks', gp.allow_subtasks,
    'allow_dependencies', gp.allow_dependencies,
    'holder_ids', coalesce((select jsonb_agg(a.user_id order by a.user_id)
                              from public.general_task_assignees a where a.task_id = t.id), '[]'::jsonb));

  if gp.class_board_id is not null then
    return jsonb_build_object('parent', v_parent,
      'blocked', 'Break down and balance is for work projects only.',
      'positions', '[]'::jsonb, 'tags', '[]'::jsonb, 'candidates', '[]'::jsonb);
  end if;

  if not (public.general_can_write(gp.id)
          and coalesce(public.general_role_of(gp.id, auth.uid())::text, '') in ('pm', 'coordinator')) then
    raise exception 'Only the project manager or coordinators break down tasks.'
      using errcode = 'insufficient_privilege';
  end if;

  -- An active lead: a member of the team, active, not a stakeholder (the rule
  -- send_work_tasks_to_teams applies).
  v_lead := t.team_id is not null and exists (
    select 1 from public.general_teams g
      join public.general_team_members tm on tm.team_id = g.id and tm.user_id = g.leader_id and tm.project_id = gp.id
      join public.general_members m on m.project_id = gp.id and m.user_id = g.leader_id
      join public.profiles pr on pr.id = m.user_id
     where g.id = t.team_id and g.project_id = gp.id and g.archived_at is null
       and pr.status = 'active' and m.role <> 'stakeholder');

  v_blocked := case
    when gp.archived_at is not null or gp.trashed_at is not null then
      'This project is archived. The project manager can restore it to make changes.'
    when t.archived_at is not null or t.trashed_at is not null then
      'This task is archived. Restore it to break it down.'
    when t.parent_id is not null then
      'This is a subtask. Break down its parent task instead.'
    when t.status = 'done' then
      'This task is done. Reopen it to break it down.'
    when not gp.allow_subtasks then
      'Subtasks are off in this project. The project manager can turn them on in Settings, Tasks.'
    when t.routing_state <> 'released' then
      'This task is still in planning. Send it from Plan & route, then break it down.'
    when gp.task_flow = 'planned' and t.team_id is null then
      'This task has no receiving team. Send it to a team in Plan & route first.'
    when gp.task_flow = 'planned' and not v_lead then
      'Its receiving team has no active lead. Give the team a lead, or reroute the task in Plan & route.'
    when v_subs then
      'This task already has subtasks. A task is broken down only once.'
  end;

  return jsonb_build_object(
    'parent', v_parent,
    'blocked', v_blocked,
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.sort, p.name, p.id)
        from public.general_positions p
        left join public.general_teams g on g.id = p.team_id
       where p.project_id = gp.id and (p.team_id is null or g.archived_at is null)), '[]'::jsonb),
    'tags', coalesce((
      select jsonb_agg(x.tag order by lower(x.tag))
        from (select min(s.tag collate "C") as tag from public.general_member_skills s
               where s.project_id = gp.id group by lower(s.tag)) x), '[]'::jsonb),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', c.user_id,
               'name', c.name,
               'tags', coalesce((select jsonb_agg(s.tag order by lower(s.tag))
                                   from public.general_member_skills s
                                  where s.project_id = gp.id and s.user_id = c.user_id), '[]'::jsonb),
               'position_ids', coalesce((select jsonb_agg(h.position_id order by h.position_id)
                                           from public.general_position_holders h
                                           join public.general_positions p on p.id = h.position_id
                                           left join public.general_teams g on g.id = p.team_id
                                          where h.project_id = gp.id and h.user_id = c.user_id
                                            and (p.team_id is null or g.archived_at is null)), '[]'::jsonb)
             ) order by c.name, c.user_id)
        from (
          select m.user_id, btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) as name
            from public.general_members m
            join public.profiles pr on pr.id = m.user_id
           where m.project_id = gp.id
             and m.role in ('pm', 'coordinator', 'member')
             and pr.status = 'active'
             and exists (select 1 from public.general_space_members sm
                          where sm.space_id = gp.space_id and sm.user_id = m.user_id)
             and (gp.task_flow = 'open'
                  or exists (select 1 from public.general_team_members tm
                               join public.general_teams g on g.id = tm.team_id
                              where tm.team_id = t.team_id and tm.project_id = gp.id
                                and tm.user_id = m.user_id and g.archived_at is null))
        ) c), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.general_breakdown_context(uuid, date, date) from public, anon;
grant execute on function public.general_breakdown_context(uuid, date, date) to authenticated;

-- Saves an approved breakdown in one transaction and returns the new subtask
-- ids in row order. Each row: { key, title, description, minutes, owner (uuid
-- or null), depends_on [key], starts_on, due_on, shown_load_minutes }.
-- Locks the parent, then rechecks the caller and parent through
-- general_breakdown_context (so the review and the save never disagree), the
-- rows as validateBreakdown (workloadPlan.ts) checks them, every owner against
-- the current candidates, and every owner's load in the window (without the
-- parent, as the review reads it) against the load the review showed (the
-- smallest shown for them; missing reads as 0).
-- Then it creates each subtask through create_general_subtask (Manila start
-- and end of day), sets its estimate through set_work_task_estimate, adds the
-- owner under collabify.work_task_handoff and adds the links through
-- add_general_task_dependency. Anything refused raises, so nothing is saved.
-- The parent's holders, team and routing are untouched.
create or replace function public.apply_work_breakdown(
  p_parent uuid, p_from date, p_to date, p_rows jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  ctx       jsonb;
  v_space   uuid;
  v_rows    jsonb := '[]'::jsonb;
  x         jsonb;
  n         int;
  v_title   text;
  v_key     text;
  v_minutes int;
  v_owner   uuid;
  v_start   date;
  v_due     date;
  v_shown   int;
  v_deps    jsonb;
  v_bad     text;
  v_bad2    text;
  v_name    text;
  v_load    int;
  o         record;
  v_id      uuid;
  v_ids     uuid[] := '{}';
  v_keys    text[] := '{}';
  prior_ho  text := coalesce(current_setting('collabify.work_task_handoff', true), 'off');
begin
  if auth.uid() is null then
    raise exception 'Sign in to break down tasks.' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.general_tasks where id = p_parent for update;
  ctx := public.general_breakdown_context(p_parent, p_from, p_to);
  if ctx ->> 'blocked' is not null then
    if (ctx -> 'parent' ->> 'has_subtasks')::boolean then
      raise exception 'This task already has subtasks. Reload it to see them.' using errcode = 'check_violation';
    end if;
    raise exception 'The task changed since you reviewed it. Review again.'
      using errcode = 'check_violation', detail = ctx ->> 'blocked';
  end if;
  select gp.space_id into v_space from public.general_projects gp
   where gp.id = (ctx -> 'parent' ->> 'project_id')::uuid;

  -- The rows, read as validateBreakdown reads them.
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The plan is unreadable. Review again.' using errcode = 'invalid_parameter_value';
  end if;
  n := jsonb_array_length(p_rows);
  if n < 2 or n > 12 then
    raise exception 'A breakdown needs 2 to 12 subtasks; this one has %.', n
      using errcode = 'invalid_parameter_value';
  end if;

  for i in 0 .. n - 1 loop
    x := p_rows -> i;
    if jsonb_typeof(x) <> 'object' then
      raise exception 'Row % is unreadable. Review again.', i + 1 using errcode = 'invalid_parameter_value';
    end if;
    v_title := left(btrim(case when jsonb_typeof(x -> 'title') = 'string' then x ->> 'title' else '' end), 200);
    if v_title = '' then
      raise exception 'Row % has no title.', i + 1 using errcode = 'invalid_parameter_value';
    end if;
    v_key := left(btrim(case when jsonb_typeof(x -> 'key') = 'string' then x ->> 'key' else '' end), 40);
    if v_key = '' then
      raise exception '"%" has no key.', v_title using errcode = 'invalid_parameter_value';
    end if;
    begin
      v_minutes := round((x ->> 'minutes')::numeric);
      v_owner := nullif(x ->> 'owner', '')::uuid;
      v_start := nullif(x ->> 'starts_on', '')::date;
      v_due := nullif(x ->> 'due_on', '')::date;
      v_shown := round(nullif(x ->> 'shown_load_minutes', '')::numeric);
    exception when others then
      raise exception '"%" is unreadable. Review again.', v_title using errcode = 'invalid_parameter_value';
    end;
    if v_minutes is null or v_minutes < 15 or v_minutes > 4800 then
      raise exception '"%" needs an estimate from 15 minutes to 80 hours.', v_title
        using errcode = 'invalid_parameter_value';
    end if;
    if v_start is not null and v_due is not null and v_start > v_due then
      raise exception '"%" starts after its due date. Change one of the dates.', v_title
        using errcode = 'invalid_parameter_value';
    end if;
    v_deps := coalesce(x -> 'depends_on', '[]'::jsonb);
    if jsonb_typeof(v_deps) <> 'array'
       or exists (select 1 from jsonb_array_elements(v_deps) d where jsonb_typeof(d) <> 'string') then
      raise exception '"%" has unreadable links.', v_title using errcode = 'invalid_parameter_value';
    end if;
    select coalesce(jsonb_agg(d.k order by d.first), '[]'::jsonb) into v_deps
      from (select btrim(e.value) as k, min(e.ord) as first
              from jsonb_array_elements_text(v_deps) with ordinality e(value, ord)
             where btrim(e.value) <> ''
             group by btrim(e.value)) d;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'key', v_key, 'title', v_title,
      'description', left(btrim(case when jsonb_typeof(x -> 'description') = 'string'
                                      then x ->> 'description' else '' end), 2000),
      'minutes', v_minutes, 'owner', v_owner, 'depends_on', v_deps,
      'starts_on', v_start, 'due_on', v_due, 'shown', coalesce(v_shown, 0)));
  end loop;

  select w.x ->> 'title', w.x ->> 'key' into v_bad, v_bad2
    from jsonb_array_elements(v_rows) with ordinality w(x, i)
   where exists (select 1 from jsonb_array_elements(v_rows) with ordinality e(y, j)
                  where e.j < w.i and e.y ->> 'key' = w.x ->> 'key')
   order by w.i limit 1;
  if v_bad is not null then
    raise exception '"%" reuses the key "%".', v_bad, v_bad2 using errcode = 'invalid_parameter_value';
  end if;

  for i in 0 .. n - 1 loop
    x := v_rows -> i;
    if (x -> 'depends_on') ? (x ->> 'key') then
      raise exception '"%" depends on itself.', x ->> 'title' using errcode = 'invalid_parameter_value';
    end if;
    select d.k into v_bad
      from jsonb_array_elements_text(x -> 'depends_on') with ordinality d(k, ord)
     where not exists (select 1 from jsonb_array_elements(v_rows) y where y ->> 'key' = d.k)
     order by d.ord limit 1;
    if v_bad is not null then
      raise exception '"%" depends on "%", which isn''t in the plan.', x ->> 'title', v_bad
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  with recursive e as (
    select y ->> 'key' as k, d.dep
      from jsonb_array_elements(v_rows) y
      cross join jsonb_array_elements_text(y -> 'depends_on') d(dep)
  ), reach(src, dst) as (
    select e.k, e.dep from e
    union
    select reach.src, e.dep from reach join e on e.k = reach.dst
  )
  select w.x ->> 'title' into v_bad
    from jsonb_array_elements(v_rows) with ordinality w(x, i)
   where exists (select 1 from reach where reach.src = w.x ->> 'key' and reach.dst = w.x ->> 'key')
   order by w.i limit 1;
  if v_bad is not null then
    raise exception '"%" is part of a circular dependency.', v_bad using errcode = 'invalid_parameter_value';
  end if;

  -- Each owner is still a candidate, and their load has not risen since the review.
  for o in
    select (y ->> 'owner')::uuid as uid, min((y ->> 'shown')::int) as shown,
           min(w.i) as first
      from jsonb_array_elements(v_rows) with ordinality w(y, i)
     where y ->> 'owner' is not null
     group by 1
     order by 3
  loop
    select coalesce(nullif(btrim(pr.first_name), ''), 'This person') into v_name
      from public.profiles pr where pr.id = o.uid;
    v_name := coalesce(v_name, 'This person');
    if not exists (select 1 from jsonb_array_elements(ctx -> 'candidates') c
                    where (c ->> 'user_id')::uuid = o.uid) then
      if ctx -> 'parent' ->> 'task_flow' = 'open' then
        raise exception '% can no longer take tasks in this project. Review again.', v_name
          using errcode = 'check_violation';
      end if;
      raise exception '% can no longer take tasks from this team. Review again.', v_name
        using errcode = 'check_violation';
    end if;
    select coalesce(sum(l.load_minutes), 0) into v_load
      from public.general_space_people_load(v_space, p_from, p_to, array[o.uid], p_parent) l;
    if v_load > o.shown then
      raise exception '%''s work changed since you reviewed it. Review again.', v_name
        using errcode = 'check_violation';
    end if;
  end loop;

  -- Write: subtasks with dates, estimate and owner, then the links.
  for i in 0 .. n - 1 loop
    x := v_rows -> i;
    v_id := public.create_general_subtask(
      p_parent, x ->> 'title', x ->> 'description',
      case when x ->> 'due_on' is not null
           then ((x ->> 'due_on')::date + time '23:59') at time zone 'Asia/Manila' end);
    if x ->> 'starts_on' is not null then
      update public.general_tasks
         set starts_at = ((x ->> 'starts_on')::date + time '00:00') at time zone 'Asia/Manila'
       where id = v_id;
    end if;
    perform public.set_work_task_estimate(v_id, (x ->> 'minutes')::int);
    if x ->> 'owner' is not null then
      perform set_config('collabify.work_task_handoff', 'on', true);
      insert into public.general_task_assignees (task_id, project_id, user_id)
      select v_id, g.project_id, (x ->> 'owner')::uuid from public.general_tasks g where g.id = v_id;
      perform set_config('collabify.work_task_handoff', prior_ho, true);
    end if;
    v_ids := v_ids || v_id;
    v_keys := v_keys || (x ->> 'key');
  end loop;

  for i in 0 .. n - 1 loop
    x := v_rows -> i;
    for v_bad in select d.k from jsonb_array_elements_text(x -> 'depends_on') d(k) loop
      perform public.add_general_task_dependency(v_ids[i + 1], v_ids[array_position(v_keys, v_bad)]);
    end loop;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.apply_work_breakdown(uuid, date, date, jsonb) from public, anon;
grant execute on function public.apply_work_breakdown(uuid, date, date, jsonb) to authenticated;

commit;
