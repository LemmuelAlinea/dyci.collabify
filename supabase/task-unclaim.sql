-- Collabify — handing a task back. Only before anyone has started it.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/task-unclaim.sql

begin;

/**
 * A task can be handed back to the group while it is still To do. Once it is
 * started it stays with whoever is on it — walking away from work in progress
 * would quietly rewrite who carried the project.
 *
 * Leaving the group is the one exception: that path releases the tasks for you,
 * and flags itself here so this guard does not block it.
 */
create or replace function public.guard_task_unclaim()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.releasing', true), '') = 'on' then
    return old; -- service role, or a member being removed from the group
  end if;

  select status into state from public.project_tasks where id = old.task_id;
  if state is null then
    return old; -- the task itself is going
  end if;

  if state <> 'todo' then
    raise exception
      'This task has already been started, so it stays with whoever is on it. Reopen it first if it really has to change hands.'
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists task_assignees_guard_unclaim on public.task_assignees;
create trigger task_assignees_guard_unclaim before delete on public.task_assignees
  for each row execute function public.guard_task_unclaim();

-- Leaving a group hands the work back rather than taking it with you, and that
-- has to work whatever state the task is in.
create or replace function public.release_tasks_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('collabify.releasing', 'on', true);

  delete from public.task_assignees a
   using public.project_tasks t, public.project_boards b
   where a.task_id = t.id
     and t.board_id = b.id
     and b.group_id = old.group_id
     and a.student_id = old.student_id;

  perform set_config('collabify.releasing', '', true);
  return old;
end;
$$;

drop trigger if exists group_members_release_tasks on public.group_members;
create trigger group_members_release_tasks after delete on public.group_members
  for each row execute function public.release_tasks_on_leave();

commit;
