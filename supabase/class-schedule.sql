-- Collabify — a class task's planned start, for the Work tab's Timeline.
--
--   node scripts/db.mjs supabase/class-schedule.sql
--
-- `started_at` (tasks.sql) is when somebody actually pressed Start. This is
-- when the task is meant to begin, the class twin of general_tasks.starts_at
-- (general-schedule.sql). With both dates a task draws a bar on the timeline.
--
-- Redefines two things other files own, and must run after them:
--   * task_detail_overview (deadline-lock.sql): it is `select t.*`, and a
--     view's star is frozen when the view is created, so it is recreated to
--     pick the new column up. Same body.
--   * guard_task_edit (task-archive.sql, the live copy): verbatim, with
--     starts_at added to the columns a started task can no longer change.
-- Re-running either owner file afterwards drops starts_at from the freeze, so
-- re-run this file after them (docs/07-backup.md lists it last).
--
-- Idempotent. Safe to re-run.

begin;

alter table public.project_tasks
  add column if not exists starts_at timestamptz;

comment on column public.project_tasks.starts_at is
  'When the task is planned to begin. Not when it was started (started_at).';

do $$ begin
  alter table public.project_tasks
    add constraint project_tasks_start_before_due
    check (starts_at is null or due_at is null or starts_at <= due_at);
exception when duplicate_object then null; end $$;

drop view if exists public.task_detail_overview;

create view public.task_detail_overview
with (security_invoker = true) as
select t.*,
       b.project_id,
       b.group_id,
       (select count(*) from public.task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.task_files f where f.task_id = t.id)::int
         as file_count,
       (select coalesce(sum(w.minutes), 0) from public.task_worklog w where w.task_id = t.id)::int
         as logged_minutes,
       p.first_name || ' ' || p.last_name as creator_name
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
  left join public.profiles p on p.id = t.created_by;

grant select on public.task_detail_overview to authenticated;

create or replace function public.guard_task_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable boolean;
  -- coalesce: an unset setting reads as NULL, and `not NULL` would skip the pin.
  archiving boolean := coalesce(current_setting('collabify.task_archive_op', true), '') = 'on';
begin
  if auth.uid() is null or public.is_board_professor(old.board_id) then
    -- Service role, or the professor: only the immutable columns are pinned.
    new.board_id   := old.board_id;
    new.created_at := old.created_at;
    new.late       := old.late;

    -- created_by is immutable except when its author is being deleted
    -- (on delete set null); see task-archive.sql for the full story.
    if new.created_by is not null
       or old.created_by is null
       or exists (select 1 from public.profiles p where p.id = old.created_by) then
      new.created_by := old.created_by;
    end if;

    if not archiving then
      new.archived_at := old.archived_at;
      if new.archived_by is not null
         or old.archived_by is null
         or exists (select 1 from public.profiles p where p.id = old.archived_by) then
        new.archived_by := old.archived_by;
      end if;
    end if;

    return new;
  end if;

  if not public.is_board_member(old.board_id) then
    raise exception 'Only this board can change its tasks';
  end if;

  if public.board_project_locked(old.board_id) then
    raise exception
      'This project is closed, so its tasks can no longer change. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  if public.board_submitted(old.board_id) then
    raise exception
      'This project has been handed in, so its tasks can no longer change. Take the submission back first if something still needs doing.'
      using errcode = 'check_violation';
  end if;

  if old.archived_at is not null and not archiving then
    raise exception 'This task is archived. Restore it from Archived tasks on My tasks first.'
      using errcode = 'check_violation';
  end if;

  if new.status is distinct from old.status
     and not public.is_task_assignee(old.id) then
    raise exception
      'Only the people on this task can move it. Claim it first.'
      using errcode = 'check_violation';
  end if;

  editable := old.status = 'todo';

  if not editable and (
       new.title     is distinct from old.title
    or new.details   is distinct from old.details
    or new.weight    is distinct from old.weight
    or new.due_at    is distinct from old.due_at
    or new.starts_at is distinct from old.starts_at
    or new.position  is distinct from old.position
  ) then
    raise exception 'This task has already been started, so it can no longer be edited';
  end if;

  new.board_id    := old.board_id;
  new.origin_id   := old.origin_id;
  new.created_by  := old.created_by;
  new.author_role := old.author_role;
  new.created_at  := old.created_at;
  new.late        := old.late;
  if not archiving then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

commit;
