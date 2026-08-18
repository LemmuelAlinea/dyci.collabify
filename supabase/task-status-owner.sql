-- Collabify — only the people on a task move it.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/task-status-owner.sql

begin;

/**
 * A task is open to the group while it is still To do. Starting it freezes the
 * wording, the weight, and the deadline — the professor stays exempt, because
 * the project is theirs.
 *
 * Moving it is narrower still: only the people on the task. An unclaimed task
 * cannot be started by a passer-by, so the record of who did the work stays
 * true — claim it first, which is the point.
 */
create or replace function public.guard_task_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable boolean;
begin
  if auth.uid() is null or public.is_board_professor(old.board_id) then
    -- Service role, or the professor: only the immutable columns are pinned.
    new.board_id   := old.board_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    return new;
  end if;

  if not public.is_board_member(old.board_id) then
    raise exception 'Only this board can change its tasks';
  end if;

  if new.status is distinct from old.status
     and not public.is_task_assignee(old.id) then
    raise exception
      'Only the people on this task can move it. Claim it first.'
      using errcode = 'check_violation';
  end if;

  editable := old.status = 'todo';

  if not editable and (
       new.title    is distinct from old.title
    or new.details  is distinct from old.details
    or new.weight   is distinct from old.weight
    or new.due_at   is distinct from old.due_at
    or new.position is distinct from old.position
  ) then
    raise exception 'This task has already been started, so it can no longer be edited';
  end if;

  new.board_id    := old.board_id;
  new.origin_id   := old.origin_id;
  new.created_by  := old.created_by;
  new.author_role := old.author_role;
  new.created_at  := old.created_at;
  return new;
end;
$$;

drop trigger if exists project_tasks_guard_edit on public.project_tasks;
create trigger project_tasks_guard_edit before update on public.project_tasks
  for each row execute function public.guard_task_edit();

commit;
