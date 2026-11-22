begin;

-- supabase/work-workload.sql
-- Space workload, phase 1: task estimates (written only through
-- set_work_task_estimate, with a history row), weekly hours per work-space
-- membership (set_space_weekly_minutes) and personal time off (user_time_off).
-- Work projects and work spaces only. Stored in minutes.
-- Runs after project-open-tasks.sql and before anon-lockdown.sql. Idempotent.
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
-- on today. A span with no weekdays puts the whole share on its first day.
-- Tasks with no estimate are counted in unestimated, never as minutes.
create or replace function public.general_space_people_load(
  p_space uuid, p_from date, p_to date, p_users uuid[] default null)
returns table(user_id uuid, project_id uuid, load_minutes int, unestimated int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
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

revoke all on function public.general_space_people_load(uuid, date, date, uuid[]) from public, anon;
grant execute on function public.general_space_people_load(uuid, date, date, uuid[]) to authenticated;

commit;
