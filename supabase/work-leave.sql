-- supabase/work-leave.sql
-- Leave and cover (work spaces). Runs after work-workload.sql and before the
-- final anon-lockdown.sql.
--
-- Away days stay one user_time_off row per day (work-workload.sql owns the
-- table). This file adds who recorded a row, lets a space planner record or
-- remove away days for someone in their space, and reads a leave as a run of
-- consecutive away weekdays (a weekend between them does not split it). It
-- never stores or reads a reason. It redefines nothing another file owns.
--
-- Idempotent. Safe to re-run.

-- A new enum value must be committed before anything can use it.
begin;
do $$
begin
  alter type public.notification_type add value if not exists 'leave_impact';
  alter type public.notification_type add value if not exists 'leave_ending';
  alter type public.notification_type add value if not exists 'cover_hand_back';
end $$;
commit;

begin;

alter table public.notification_prefs
  add column if not exists leave_and_cover boolean not null default true;

------------------------------------------------------------ who recorded a day

alter table public.user_time_off
  add column if not exists added_by uuid references public.profiles (id) on delete set null;

-- Null when the person recorded the day themselves, else whoever did. A day the
-- person recorded stays theirs when a planner changes it.
create or replace function public.user_time_off_set_added_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.added_by is null and auth.uid() is distinct from new.user_id then
    new.added_by := null;
    return new;
  end if;
  new.added_by := case when auth.uid() is distinct from new.user_id then auth.uid() end;
  return new;
end;
$$;

revoke all on function public.user_time_off_set_added_by() from public, anon, authenticated;

drop trigger if exists user_time_off_added_by on public.user_time_off;
create trigger user_time_off_added_by before insert or update on public.user_time_off
  for each row execute function public.user_time_off_set_added_by();

------------------------------------------------------------ recording leave

-- Whether the caller may record away days for p_user: themselves, or a project
-- manager or coordinator of a live work space p_user belongs to.
create or replace function public.work_can_mark_away(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.general_viewer_active() and (
    p_user = auth.uid()
    or exists (
      select 1
        from public.general_space_members me
        join public.general_space_members them on them.space_id = me.space_id and them.user_id = p_user
        join public.general_spaces s on s.id = me.space_id
       where me.user_id = auth.uid() and me.role in ('pm', 'coordinator')
         and s.kind = 'work' and s.archived_at is null
         and not exists (select 1 from public.classes c where c.space_id = s.id)));
$$;

revoke all on function public.work_can_mark_away(uuid) from public, anon, authenticated;

create or replace function public.work_leave_check_range(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a start date on or before the end date.' using errcode = 'invalid_parameter_value';
  end if;
  if public.work_weekdays(p_from, p_to) > 60 then
    raise exception 'Choose 60 days or fewer.' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function public.work_leave_check_range(date, date) from public, anon, authenticated;

-- Records p_user away on every weekday from p_from to p_to: whole days when
-- p_minutes is null, else that many minutes each day. Replaces what was on those
-- days. Returns the days written.
create or replace function public.save_time_off_range(p_user uuid, p_from date, p_to date, p_minutes int default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.work_can_mark_away(p_user) then
    raise exception 'You can''t mark this person away.' using errcode = 'insufficient_privilege';
  end if;
  perform public.work_leave_check_range(p_from, p_to);
  if p_minutes is not null and (p_minutes < 1 or p_minutes > 1440) then
    raise exception 'Choose between 1 minute and 24 hours a day.' using errcode = 'check_violation';
  end if;

  insert into public.user_time_off (user_id, off_on, minutes)
  select p_user, d::date, p_minutes
    from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d) < 6
  on conflict (user_id, off_on) do update set minutes = excluded.minutes;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.save_time_off_range(uuid, date, date, int) from public, anon;
grant execute on function public.save_time_off_range(uuid, date, date, int) to authenticated;

-- Removes p_user's away days from p_from to p_to. The person removes any of
-- theirs; a planner only days a planner recorded. Returns the days removed.
create or replace function public.remove_time_off_range(p_user uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.work_can_mark_away(p_user) then
    raise exception 'You can''t mark this person away.' using errcode = 'insufficient_privilege';
  end if;
  perform public.work_leave_check_range(p_from, p_to);

  delete from public.user_time_off o
   where o.user_id = p_user and o.off_on between p_from and p_to
     and (p_user = auth.uid() or o.added_by is not null);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.remove_time_off_range(uuid, date, date) from public, anon;
grant execute on function public.remove_time_off_range(uuid, date, date) to authenticated;

------------------------------------------------------------ leaves

-- p_user's leaves that end on or after p_from: runs of away days with no
-- away-free weekday between them. part_day is true when any day is part time.
create or replace function public.work_leave_runs(p_user uuid, p_from date)
returns table(first_day date, last_day date, part_day boolean)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select o.off_on, o.minutes,
           lag(o.off_on) over (order by o.off_on) as prev
      from public.user_time_off o
     where o.user_id = p_user
  ), marked as (
    select d.*,
           case when d.prev is null or public.work_weekdays(d.prev + 1, d.off_on - 1) > 0 then 1 else 0 end as starts
      from days d
  ), grouped as (
    select m.*, sum(m.starts) over (order by m.off_on) as run
      from marked m
  )
  select min(g.off_on), max(g.off_on), bool_or(g.minutes is not null)
    from grouped g
   group by g.run
  having max(g.off_on) >= p_from
   order by 1;
$$;

revoke all on function public.work_leave_runs(uuid, date) from public, anon, authenticated;

-- Who is away in a work space: each member's leaves ending today or later, for
-- anyone in that live work space. Dates only; added_by is a planner who recorded
-- days of that leave, if any.
create or replace function public.space_away_ranges(p_space uuid)
returns table(user_id uuid, first_day date, last_day date, part_day boolean, added_by uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, r.first_day, r.last_day, r.part_day,
         (select o.added_by from public.user_time_off o
           where o.user_id = m.user_id and o.off_on between r.first_day and r.last_day
             and o.added_by is not null
           order by o.off_on limit 1)
    from public.general_space_members m
    join public.general_spaces s on s.id = m.space_id
    cross join lateral public.work_leave_runs(m.user_id, (now() at time zone 'Asia/Manila')::date) r
   where m.space_id = p_space
     and s.kind = 'work' and s.archived_at is null
     and public.general_viewer_active()
     and exists (select 1 from public.general_space_members me
                  where me.space_id = p_space and me.user_id = auth.uid())
   order by r.first_day, m.user_id;
$$;

revoke all on function public.space_away_ranges(uuid) from public, anon;
grant execute on function public.space_away_ranges(uuid) to authenticated;

------------------------------------------------------------ impact check

-- What a leave from p_first to p_last does to each open, released, live task
-- p_user holds in a live work project, in this order:
--   blocks      another open task waits for it and it is due by the leave's end (or has no date)
--   due_during  it is due during the leave
--   wont_fit    its remaining share is more than the person's free hours from today to its due day
--   fine        anything else
-- remaining = (estimate - all logged time, at least 0) / holders. A due day
-- already past leaves no free hours. With no weekly hours set, fit is unknown.
create or replace function public.work_leave_task_status(p_user uuid, p_first date, p_last date)
returns table(task_id uuid, project_id uuid, status text, remaining_minutes int, short_minutes int,
              due_on date, no_estimate boolean)
language sql
stable
security definer
set search_path = public
as $$
  with today as (
    select (now() at time zone 'Asia/Manila')::date as d
  ), held as (
    select t.id, t.project_id, q.space_id, t.estimated_minutes as est,
           (t.due_at at time zone 'Asia/Manila')::date as due,
           (select count(*) from public.general_task_assignees h where h.task_id = t.id) as holders,
           coalesce((select sum(l.minutes) from public.general_task_logs l where l.task_id = t.id), 0) as logged
      from public.general_task_assignees a
      join public.general_tasks t on t.id = a.task_id
      join public.general_projects q on q.id = t.project_id
      join public.general_spaces sp on sp.id = q.space_id
     where a.user_id = p_user
       and t.status <> 'done' and t.routing_state = 'released'
       and t.archived_at is null and t.trashed_at is null
       and q.class_board_id is null and q.archived_at is null and q.trashed_at is null
       and sp.kind = 'work'
  ), calc as (
    select h.*,
           greatest(0, coalesce(h.est, 0) - h.logged)::numeric / greatest(h.holders, 1) as rem,
           exists (select 1
                     from public.general_task_dependencies dp
                     join public.general_tasks w on w.id = dp.task_id
                    where dp.depends_on_id = h.id and w.status <> 'done'
                      and w.archived_at is null and w.trashed_at is null) as blocks_other,
           case
             when h.est is null or h.due is null then null
             when h.due < (select d from today) then 0
             else public.work_person_available(h.space_id, p_user, (select d from today), h.due)
                  - coalesce((select sum(pl.load_minutes)
                                from public.work_person_load(h.space_id, p_user, (select d from today), h.due, h.id) pl), 0)
           end as room
      from held h
  ), judged as (
    select c.*,
           case
             when c.blocks_other and (c.due is null or c.due <= p_last) then 'blocks'
             when c.due between p_first and p_last then 'due_during'
             when c.rem > 0 and c.room is not null and c.rem > greatest(c.room, 0) then 'wont_fit'
             else 'fine'
           end as st
      from calc c
  )
  select j.id, j.project_id, j.st, round(j.rem)::int,
         case when j.st = 'wont_fit' then round(j.rem - greatest(j.room, 0))::int else 0 end,
         j.due, j.est is null
    from judged j;
$$;

revoke all on function public.work_leave_task_status(uuid, date, date) from public, anon, authenticated;

-- "26 Nov", "26–28 Nov", "30 Nov – 2 Dec".
create or replace function public.work_leave_label(p_first date, p_last date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_first = p_last then to_char(p_first, 'FMDD Mon')
    when date_trunc('month', p_first) = date_trunc('month', p_last)
      then to_char(p_first, 'FMDD') || '–' || to_char(p_last, 'FMDD Mon')
    else to_char(p_first, 'FMDD Mon') || ' – ' || to_char(p_last, 'FMDD Mon')
  end;
$$;

revoke all on function public.work_leave_label(date, date) from public, anon, authenticated;

------------------------------------------------------------ leave notices

-- One row per person, project and leave: the leave's dates as last seen and the
-- tasks it flagged, so a notice goes out once and again only when that set changes.
create table if not exists public.general_leave_notices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  project_id         uuid not null references public.general_projects (id) on delete cascade,
  first_day          date not null,
  last_day           date not null,
  flagged            uuid[] not null default '{}',
  notified_at        timestamptz,
  ended_reminded_on  date,
  created_at         timestamptz not null default now(),
  unique (user_id, project_id, first_day)
);

create index if not exists general_leave_notices_project_idx on public.general_leave_notices (project_id, last_day);

alter table public.general_leave_notices enable row level security;

drop policy if exists general_leave_notices_select on public.general_leave_notices;
create policy general_leave_notices_select on public.general_leave_notices
  for select using (exists (
    select 1 from public.general_members gm
     where gm.project_id = general_leave_notices.project_id and gm.user_id = auth.uid()
       and gm.role in ('pm', 'coordinator')));

revoke all on public.general_leave_notices from public, anon, authenticated;
grant select on public.general_leave_notices to authenticated;

-- Brings p_user's notice rows in line with their current and coming leaves and
-- tells each affected project's manager and coordinators when a leave's flagged
-- tasks change. Rows of leaves that no longer exist go.
create or replace function public.work_leave_refresh(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_name text;
  r record;
  pr record;
  n public.general_leave_notices;
  v_id uuid;
  v_changed boolean;
  v_count int;
begin
  select btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) into v_name
    from public.profiles p where p.id = p_user;

  for r in select * from public.work_leave_runs(p_user, v_today) loop
    for pr in
      select s.project_id,
             coalesce(array_agg(s.task_id order by s.task_id) filter (where s.status <> 'fine'), '{}') as flagged
        from public.work_leave_task_status(p_user, r.first_day, r.last_day) s
       group by s.project_id
    loop
      select * into n from public.general_leave_notices g
       where g.user_id = p_user and g.project_id = pr.project_id
         and g.first_day <= r.last_day and g.last_day >= r.first_day
       order by g.first_day
       limit 1
       for update;
      if found then
        -- Two leaves that joined into one keep the older row.
        delete from public.general_leave_notices g
         where g.user_id = p_user and g.project_id = pr.project_id and g.id <> n.id
           and g.first_day <= r.last_day and g.last_day >= r.first_day;
        v_changed := pr.flagged is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(n.flagged) x);
        update public.general_leave_notices
           set first_day = r.first_day, last_day = r.last_day, flagged = pr.flagged
         where id = n.id;
        v_id := n.id;
      else
        insert into public.general_leave_notices (user_id, project_id, first_day, last_day, flagged)
        values (p_user, pr.project_id, r.first_day, r.last_day, pr.flagged)
        on conflict (user_id, project_id, first_day) do update
          set last_day = excluded.last_day, flagged = excluded.flagged
        returning id into v_id;
        v_changed := true;
      end if;

      v_count := cardinality(pr.flagged);
      if v_changed and v_count > 0 then
        insert into public.notifications (user_id, type, general_project_id, general_space_id, title, preview)
        select gm.user_id, 'leave_impact'::public.notification_type, q.id, q.space_id,
               v_name || ' is away ' || public.work_leave_label(r.first_day, r.last_day),
               v_count || case when v_count = 1 then ' task in ' else ' tasks in ' end || q.name
                 || case when v_count = 1 then ' needs a look.' else ' need a look.' end
          from public.general_members gm
          join public.general_projects q on q.id = gm.project_id
          join public.profiles pf on pf.id = gm.user_id and pf.status = 'active'
          join public.notification_prefs np on np.user_id = gm.user_id and np.leave_and_cover
         where gm.project_id = pr.project_id and gm.role in ('pm', 'coordinator')
           and gm.user_id <> p_user;
        update public.general_leave_notices set notified_at = now() where id = v_id;
      end if;
    end loop;
  end loop;

  delete from public.general_leave_notices g
   where g.user_id = p_user and g.last_day >= v_today
     and not exists (select 1 from public.work_leave_runs(p_user, v_today) lr
                      where g.first_day <= lr.last_day and g.last_day >= lr.first_day);
end;
$$;

revoke all on function public.work_leave_refresh(uuid) from public, anon, authenticated;

-- Away days changed: refresh each person once per statement.
create or replace function public.user_time_off_refresh_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.work_leave_refresh(x.user_id) from (select distinct user_id from new_rows) x;
  return null;
end;
$$;

create or replace function public.user_time_off_refresh_old()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.work_leave_refresh(x.user_id) from (select distinct user_id from old_rows) x;
  return null;
end;
$$;

revoke all on function public.user_time_off_refresh_new() from public, anon, authenticated;
revoke all on function public.user_time_off_refresh_old() from public, anon, authenticated;

drop trigger if exists user_time_off_leave_refresh_ins on public.user_time_off;
create trigger user_time_off_leave_refresh_ins after insert on public.user_time_off
  referencing new table as new_rows
  for each statement execute function public.user_time_off_refresh_new();
drop trigger if exists user_time_off_leave_refresh_upd on public.user_time_off;
create trigger user_time_off_leave_refresh_upd after update on public.user_time_off
  referencing new table as new_rows
  for each statement execute function public.user_time_off_refresh_new();
drop trigger if exists user_time_off_leave_refresh_del on public.user_time_off;
create trigger user_time_off_leave_refresh_del after delete on public.user_time_off
  referencing old table as old_rows
  for each statement execute function public.user_time_off_refresh_old();

------------------------------------------------------------ leave review

-- A project's current and coming leaves for its project manager and
-- coordinators, each with that project's tasks judged live, flagged first.
create or replace function public.general_project_leaves(p_project uuid)
returns table(notice_id uuid, user_id uuid, first_day date, last_day date, added_by uuid, tasks jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public.general_viewer_active() or not exists (
    select 1 from public.general_members gm
     where gm.project_id = p_project and gm.user_id = auth.uid() and gm.role in ('pm', 'coordinator')) then
    raise exception 'Only the project manager and coordinators can review leave.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select g.id, g.user_id, g.first_day, g.last_day,
         (select o.added_by from public.user_time_off o
           where o.user_id = g.user_id and o.off_on between g.first_day and g.last_day and o.added_by is not null
           order by o.off_on limit 1),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'task_id', s.task_id, 'title', t.title, 'status', s.status,
                    'remaining_minutes', s.remaining_minutes, 'short_minutes', s.short_minutes,
                    'due_on', s.due_on, 'no_estimate', s.no_estimate,
                    'blocks', (select coalesce(jsonb_agg(w.title order by w.title), '[]'::jsonb)
                                 from public.general_task_dependencies dp
                                 join public.general_tasks w on w.id = dp.task_id
                                where dp.depends_on_id = s.task_id and w.status <> 'done'
                                  and w.archived_at is null and w.trashed_at is null))
                  order by array_position(array['blocks', 'due_during', 'wont_fit', 'fine'], s.status),
                           s.due_on nulls last, t.title)
             from public.work_leave_task_status(g.user_id, g.first_day, g.last_day) s
             join public.general_tasks t on t.id = s.task_id
            where s.project_id = p_project), '[]'::jsonb)
    from public.general_leave_notices g
   where g.project_id = p_project
     and g.last_day >= (now() at time zone 'Asia/Manila')::date
   order by g.first_day, g.user_id;
end;
$$;

revoke all on function public.general_project_leaves(uuid) from public, anon;
grant execute on function public.general_project_leaves(uuid) to authenticated;

commit;
