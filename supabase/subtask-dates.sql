-- Parent tasks follow their subtasks' dates (work projects).
--
-- A work task with live subtasks (not archived or trashed; done ones count)
-- starts at the earliest subtask start and is due at the latest subtask due. A
-- subtask with no date leaves that end as it was, and a start that would land
-- after the due becomes the due. The first time its subtasks move its due date,
-- the old one is kept in planned_due_at so the app can say the work runs past
-- what was planned. Each move is the parent's ordinary `updated` history row,
-- tagged by: 'subtasks' and credited to whoever changed the subtask. Nobody sets
-- such a task's dates, or anyone's planned date, by hand.
--
-- The parent is written with claims cleared under collabify.subtask_dates (as the
-- other sanctioned writers do), so whoever may re-date a subtask is never refused
-- on the parent. It redefines nothing another file owns.
--
-- Runs after work-leave.sql and before anon-lockdown.sql. Idempotent.
-- Suite: supabase/tests/subtask-dates.test.sql

alter table public.general_tasks add column if not exists planned_due_at timestamptz;

------------------------------------------------------------ follow

-- Brings one parent in line with its live subtasks (internal). p_quiet skips
-- the history row (the one-time pass).
create or replace function public.follow_subtask_dates(p_parent uuid, p_quiet boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  par        public.general_tasks%rowtype;
  v_start    timestamptz;
  v_due      timestamptz;
  v_n        int;
  new_start  timestamptz;
  new_due    timestamptz;
  prior_flag text := current_setting('collabify.subtask_dates', true);
  prior_q    text := current_setting('collabify.subtask_dates_quiet', true);
  prior_who  text := current_setting('collabify.subtask_dates_actor', true);
  prior_task text := current_setting('collabify.subtask_dates_task', true);
  prior_jwt  text := current_setting('request.jwt.claims', true);
begin
  select * into par from public.general_tasks where id = p_parent;
  if par.id is null
     or exists (select 1 from public.general_projects g where g.id = par.project_id and g.class_board_id is not null) then
    return;
  end if;

  select min(s.starts_at), max(s.due_at), count(*) into v_start, v_due, v_n
    from public.general_tasks s
   where s.parent_id = par.id and s.archived_at is null and s.trashed_at is null;
  if v_n = 0 then
    return;
  end if;

  new_due := coalesce(v_due, par.due_at);
  new_start := coalesce(v_start, par.starts_at);
  if new_start is not null and new_due is not null and new_start > new_due then
    new_start := new_due;
  end if;
  if new_start is not distinct from par.starts_at and new_due is not distinct from par.due_at then
    return;
  end if;

  perform set_config('collabify.subtask_dates', 'on', true);
  perform set_config('collabify.subtask_dates_quiet', case when p_quiet then 'on' else 'off' end, true);
  perform set_config('collabify.subtask_dates_actor', coalesce(auth.uid()::text, ''), true);
  perform set_config('collabify.subtask_dates_task', par.id::text, true);
  perform set_config('request.jwt.claims', '', true);

  update public.general_tasks
     set starts_at = new_start,
         due_at = new_due,
         planned_due_at = case
           when planned_due_at is null and par.due_at is not null and new_due is distinct from par.due_at
             then par.due_at
           else planned_due_at
         end
   where id = par.id;

  perform set_config('request.jwt.claims', coalesce(prior_jwt, ''), true);
  perform set_config('collabify.subtask_dates', coalesce(nullif(prior_flag, ''), 'off'), true);
  perform set_config('collabify.subtask_dates_quiet', coalesce(nullif(prior_q, ''), 'off'), true);
  perform set_config('collabify.subtask_dates_actor', coalesce(prior_who, ''), true);
  perform set_config('collabify.subtask_dates_task', coalesce(prior_task, ''), true);
end;
$$;

revoke all on function public.follow_subtask_dates(uuid, boolean) from public, anon, authenticated;

-- After a subtask is added, deleted, re-dated, archived, trashed, restored or
-- moved to another parent: its parents follow. A write the rollup itself makes
-- is not rolled up again.
create or replace function public.general_tasks_follow_subtasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('collabify.subtask_dates', true), 'off') = 'on' then
    return null;
  end if;
  -- The parent it had (deleted, re-dated, archived, trashed, restored or moved away)…
  if tg_op <> 'INSERT' and old.parent_id is not null then
    perform public.follow_subtask_dates(old.parent_id);
  end if;
  -- …and the one it joins.
  if tg_op <> 'DELETE' and new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    perform public.follow_subtask_dates(new.parent_id);
  end if;
  return null;
end;
$$;

revoke all on function public.general_tasks_follow_subtasks() from public, anon, authenticated;

drop trigger if exists general_tasks_zy_follow_subtasks on public.general_tasks;
create trigger general_tasks_zy_follow_subtasks
  after insert or delete or update of parent_id, starts_at, due_at, archived_at, trashed_at
  on public.general_tasks
  for each row execute function public.general_tasks_follow_subtasks();

------------------------------------------------------------ guard

-- A person never sets the dates of a work task that has live subtasks, nor
-- anyone's planned due date.
create or replace function public.guard_general_task_parent_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.planned_due_at := null;
    end if;
    return new;
  end if;
  if auth.uid() is null or coalesce(current_setting('collabify.subtask_dates', true), 'off') = 'on' then
    return new;
  end if;
  if new.planned_due_at is distinct from old.planned_due_at then
    raise exception 'The planned due date is kept by Collabify.' using errcode = 'check_violation';
  end if;
  if (new.starts_at is distinct from old.starts_at or new.due_at is distinct from old.due_at)
     and exists (select 1 from public.general_tasks s
                  where s.parent_id = new.id and s.archived_at is null and s.trashed_at is null)
     and exists (select 1 from public.general_projects g where g.id = new.project_id and g.class_board_id is null) then
    raise exception 'This task''s dates follow its subtasks. Change a subtask''s dates instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_task_parent_dates() from public, anon, authenticated;

drop trigger if exists general_tasks_parent_dates_guard on public.general_tasks;
create trigger general_tasks_parent_dates_guard
  before insert or update of starts_at, due_at, planned_due_at
  on public.general_tasks
  for each row execute function public.guard_general_task_parent_dates();

------------------------------------------------------------ history

-- The parent's move is the ordinary `updated` row (record_general_task_event,
-- not redefined here), written with claims cleared: credit whoever changed the
-- subtask, tag it by: 'subtasks', and drop it during the quiet one-time pass.
create or replace function public.tag_subtask_dates_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('collabify.subtask_dates', true), 'off') <> 'on'
     or new.kind <> 'updated'
     or new.task_id::text is distinct from nullif(current_setting('collabify.subtask_dates_task', true), '') then
    return new;
  end if;
  if coalesce(current_setting('collabify.subtask_dates_quiet', true), 'off') = 'on' then
    return null;
  end if;
  new.actor_id := coalesce(new.actor_id, nullif(current_setting('collabify.subtask_dates_actor', true), '')::uuid);
  new.detail := coalesce(new.detail, '{}'::jsonb) || jsonb_build_object('by', 'subtasks');
  return new;
end;
$$;

revoke all on function public.tag_subtask_dates_event() from public, anon, authenticated;

drop trigger if exists general_task_events_subtask_dates on public.general_task_events;
create trigger general_task_events_subtask_dates
  before insert on public.general_task_events
  for each row execute function public.tag_subtask_dates_event();

------------------------------------------------------------ one-time pass

-- Every work parent with live subtasks, brought in line quietly. Safe to repeat:
-- a parent already in line is left alone.
create or replace function public.follow_all_subtask_dates()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select distinct s.parent_id as id
      from public.general_tasks s
      join public.general_projects g on g.id = s.project_id
     where s.parent_id is not null and s.archived_at is null and s.trashed_at is null
       and g.class_board_id is null
  loop
    perform public.follow_subtask_dates(r.id, true);
  end loop;
end;
$$;

revoke all on function public.follow_all_subtask_dates() from public, anon, authenticated;

select public.follow_all_subtask_dates();
