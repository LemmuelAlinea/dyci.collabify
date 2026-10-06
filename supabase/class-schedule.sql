-- Collabify — a class task's planned start, for the Work tab's Timeline.
--
--   node scripts/db.mjs supabase/class-schedule.sql
--
-- `started_at` (tasks.sql) is when somebody actually pressed Start. This is
-- when the task is meant to begin, the class twin of general_tasks.starts_at
-- (general-schedule.sql). With both dates a task draws a bar on the timeline.
--
-- Redefines four things other files own, and must run after them:
--   * task_detail_overview (deadline-lock.sql): it is `select t.*`, and a
--     view's star is frozen when the view is created, so it is recreated to
--     pick the new column up. Same body.
--   * guard_task_edit (task-archive.sql, the live copy): verbatim, with
--     starts_at added to the columns a started task can no longer change.
--   * update_professor_task (tasks.sql): verbatim, except the planned start of
--     a copy is cleared when the new due date falls before it, so one student's
--     later start cannot trip project_tasks_start_before_due and roll back the
--     edit for every group.
--   * apply_shift_to_deadlines (term-shifts.sql): verbatim, except starts_at
--     moves by the same days as due_at, so a negative shift cannot break the
--     check and a positive one does not leave the start behind.
-- Re-running deadline-lock.sql recreates the view with `t.*`, which still
-- includes starts_at, so that one is safe. Re-running task-archive.sql (the
-- guard), tasks.sql (update_professor_task) or term-shifts.sql
-- (apply_shift_to_deadlines) drops the change, so re-run this file after any
-- of them (docs/07-backup.md lists it last).
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

create or replace function public.update_professor_task(
  p_origin  uuid,
  p_title   text,
  p_details text default '',
  p_weight  int default 1,
  p_due_at  timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cls     uuid;
  changed int;
  frozen  int;
begin
  select public.board_class(t.board_id) into cls
    from public.project_tasks t where t.origin_id = p_origin limit 1;
  if cls is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_class_professor(cls) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.project_tasks
     set title = btrim(p_title),
         details = coalesce(p_details, ''),
         weight = greatest(1, least(100, coalesce(p_weight, 1))),
         due_at = p_due_at,
         -- A student's planned start that the new due date has passed is cleared.
         starts_at = case
                       when p_due_at is not null and starts_at > p_due_at then null
                       else starts_at
                     end
   where origin_id = p_origin and status = 'todo';
  get diagnostics changed = row_count;

  select count(*) into frozen
    from public.project_tasks where origin_id = p_origin and status <> 'todo';

  return jsonb_build_object('result', 'updated', 'changed', changed, 'frozen', frozen);
end;
$$;

create or replace function public.apply_shift_to_deadlines(
  p_shift    uuid,
  p_projects uuid[] default '{}',
  p_tasks    uuid[] default '{}'
) returns int
language plpgsql security definer set search_path = public as $$
declare
  sh      public.class_week_shifts;
  cls     public.classes;
  moved   int := 0;
  n       int;
  note    text;
begin
  select * into sh from public.class_week_shifts where id = p_shift;
  if sh.id is null then
    raise exception 'That shift does not exist.' using errcode = 'P0001';
  end if;

  if auth.uid() is not null and not public.is_class_professor(sh.class_id) then
    raise exception 'Only the professor of this class can move its deadlines.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into cls from public.classes where id = sh.class_id;
  note := case when sh.reason = '' then '' else ' · ' || sh.reason end;

  -- ------------------------------------------------------------- projects
  update public.projects p
     set due_at     = p.due_at + make_interval(days => sh.days),
         release_at = case
                        when p.release_at is null then null
                        else p.release_at + make_interval(days => sh.days)
                      end
   where p.id = any(coalesce(p_projects, '{}'))
     and p.class_id = sh.class_id
     and p.archived_at is null
     and p.due_at is not null;

  get diagnostics n = row_count;
  moved := moved + n;

  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id,
         'term_shifted',
         sh.class_id,
         p.id,
         p.title || ' moved',
         'Now due ' || to_char(p.due_at, 'DD Mon') || ' in ' || cls.name || note
    from public.projects p
    join public.class_members m on m.class_id = sh.class_id and m.status = 'active'
   where p.id = any(coalesce(p_projects, '{}'))
     and p.class_id = sh.class_id
     and p.archived_at is null;

  -- ---------------------------------------------------------------- tasks
  update public.project_tasks t
     set due_at    = t.due_at + make_interval(days => sh.days),
         -- The planned start moves with the due date; unset stays unset.
         starts_at = case
                       when t.starts_at is null then null
                       else t.starts_at + make_interval(days => sh.days)
                     end
    from public.project_boards b
    join public.projects p on p.id = b.project_id
   where t.board_id = b.id
     and t.id = any(coalesce(p_tasks, '{}'))
     and p.class_id = sh.class_id
     and t.due_at is not null;

  get diagnostics n = row_count;
  moved := moved + n;

  insert into public.notifications (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'term_shifted',
         sh.class_id,
         p.id,
         t.id,
         t.title || ' moved',
         'Now due ' || to_char(t.due_at, 'DD Mon') || ' in ' || p.title || note
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p       on p.id = b.project_id
   where t.id = any(coalesce(p_tasks, '{}'))
     and p.class_id = sh.class_id
     -- The project's own notification already said the deadline moved.
     and not (p.id = any(coalesce(p_projects, '{}')));

  return moved;
end;
$$;

commit;
