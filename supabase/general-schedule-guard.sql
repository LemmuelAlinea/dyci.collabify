-- Freezes a task's start date against the team-clearing exemption.
--
--   node scripts/db.mjs supabase/general-schedule-guard.sql
--
-- guard_general_task() (supabase/general-tasks.sql) lets somebody who holds
-- `manage_structure` but not `manage_tasks` through when a team delete
-- cascades into clearing a task's team_id, as long as nothing else on the row
-- changed. The frozen-column list was written before `starts_at` existed and
-- never grew to include it, so that same exemption also accepts a start-date
-- move riding along on a team-clearing update. Redefined here, verbatim,
-- with `starts_at` added to the list.
--
-- Requires supabase/general-tasks.sql and supabase/general-schedule.sql.
--
-- Idempotent. Safe to re-run.

begin;

create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if not public.is_general_member(v_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if public.general_is_archived(old.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if not public.general_can(old.project_id, 'manage_tasks') then
    if not (
      public.is_general_task_assignee(old.id)
      or (old.created_by = auth.uid() and not public.general_task_held(old.id))
      or (
        -- A team delete cascades into an UPDATE (team_id set null) that runs
        -- under the deleting caller's own auth.uid(), even though referential
        -- actions bypass RLS — BEFORE triggers still fire. Someone who
        -- manages structure but not tasks still needs that cascade to reach
        -- this row, as long as nothing besides team_id actually changed.
        new.team_id is null
        and new.title is not distinct from old.title
        and new.description is not distinct from old.description
        and new.status is not distinct from old.status
        and new.due_at is not distinct from old.due_at
        and new.starts_at is not distinct from old.starts_at
        and new.weight is not distinct from old.weight
        and public.general_can(old.project_id, 'manage_structure')
      )
    ) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

commit;
