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

begin;

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

commit;
