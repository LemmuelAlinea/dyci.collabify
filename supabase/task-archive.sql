-- Collabify — students archive the tasks they added themselves.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/task-archive.sql
--
-- Runs after tasks.sql, deadline-lock.sql, submissions.sql, task-status-owner.sql,
-- notifications.sql, automation.sql, task-claim-limit.sql, groups.sql,
-- admin-program.sql and general-archive-rbac.sql: it redefines, as supersets,
-- functions those files last defined. Each is copied from the live database
-- (2026-10-01) with only the archive lines added.

/**
 * A class task now has an archive, the way a work task already did. A student
 * archives what is theirs — a task they added or are on — and any task nobody
 * has taken yet, professor-set ones included. A task a groupmate holds is
 * not theirs to archive.
 *
 * An archived class task is out of the board the way a deleted one is: it
 * stops counting toward progress, analytics, reports, reminders and claim
 * limits. That costs almost nothing here because the select policy hides it,
 * and every view over class tasks runs with the reader's own policies
 * (`security_invoker`). Only the functions that read the table with the
 * owner's rights need saying so, and they are the ones redefined below.
 *
 *   archive   a student on the board, for a task they added, a task they are
 *             on, or a task nobody holds — while the board is open
 *   restore   whoever archived it, or the class's faculty
 *   delete    the same two — the archive is the only way back, so deleting
 *             from it is permanent
 *
 * Work tasks: a task's creator may now archive it at any point, not only
 * before anybody took it. Everything else about the work archive is as
 * general-archive-rbac.sql left it.
 */

begin;

-- ---------------------------------------------------------------- columns

alter table public.project_tasks add column if not exists archived_at timestamptz;
alter table public.project_tasks add column if not exists archived_by uuid
  references public.profiles (id) on delete set null;

create index if not exists project_tasks_archived_by_idx
  on public.project_tasks (archived_by) where archived_at is not null;

-- ---------------------------------------------------------------- reading

drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks
  for select using (public.can_see_board(board_id) and archived_at is null);

-- ---------------------------------------------------------------- the edit guard

/**
 * As live, plus: the archive columns move only inside the archive functions
 * (`collabify.task_archive_op`), and a student cannot edit an archived task.
 * archived_by gets the same set-null exception created_by has, for the same
 * reason — deleting an account must be able to clear it.
 */
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

    -- `created_by` is immutable too, with one exception that took a delete to
    -- find. The column is `on delete set null`, so removing an account nulls it
    -- wherever that person authored a task — but this trigger fires on that
    -- update and pinned the old value straight back, leaving a row pointing at
    -- a profile the same statement was deleting. The delete then failed with a
    -- foreign key error naming project_tasks, and no professor who had ever set
    -- a task could be removed at all, however carefully their classes were
    -- handed over.
    --
    -- The referential action is the only thing that nulls this column while the
    -- author no longer exists, which is exactly how to tell it apart from a
    -- client trying to rewrite authorship.
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
  new.late        := old.late;
  if not archiving then
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- archive, restore, delete

create or replace function public.archive_class_task(p_task uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.project_tasks%rowtype;
begin
  select * into t from public.project_tasks where id = p_task for update;
  if not found or not (public.is_board_member(t.board_id) or public.is_board_professor(t.board_id)) then
    raise exception 'That task is gone, or you are no longer on its board.' using errcode = 'no_data_found';
  end if;

  if p_archived then
    if t.archived_at is not null then return; end if;
    -- Theirs (added it, or on it) or nobody's yet — professor-set tasks included.
    if not public.is_board_member(t.board_id)
       or not (
         t.created_by = auth.uid()
         or public.is_task_assignee(t.id)
         or not exists (select 1 from public.task_assignees a where a.task_id = t.id)
       ) then
      raise exception 'You can archive a task you added, a task you are on, or one nobody has taken yet.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    if t.archived_at is null then return; end if;
    if t.archived_by is distinct from auth.uid() and not public.is_board_professor(t.board_id) then
      raise exception 'Only whoever archived this task, or the professor, can restore it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform set_config('collabify.task_archive_op', 'on', true);
  update public.project_tasks
     set archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end
   where id = p_task;
  perform set_config('collabify.task_archive_op', 'off', true);
end;
$$;

create or replace function public.delete_archived_class_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.project_tasks%rowtype;
begin
  select * into t from public.project_tasks where id = p_task and archived_at is not null;
  if not found then return; end if;
  if t.archived_by is distinct from auth.uid() and not public.is_board_professor(t.board_id) then
    raise exception 'Only whoever archived this task, or the professor, can delete it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.is_board_professor(t.board_id)
     and (public.board_project_locked(t.board_id) or public.board_submitted(t.board_id)) then
    raise exception 'This project is closed or handed in, so its tasks can no longer change.'
      using errcode = 'check_violation';
  end if;
  delete from public.project_tasks where id = p_task and archived_at is not null;
end;
$$;

/** The class tasks this person archived, newest first, with where each one lived. */
create or replace function public.list_my_archived_class_tasks()
returns table (
  id uuid, title text, status public.task_status, archived_at timestamptz,
  project_id uuid, project_title text, class_initial text, class_name text, group_name text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.status, t.archived_at, p.id, p.title, c.initial, c.name, g.name
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.classes c on c.id = p.class_id
    left join public.groups g on g.id = b.group_id
   where t.archived_at is not null
     and t.archived_by = auth.uid()
     and public.is_board_member(t.board_id)
     and p.archived_at is null
   order by t.archived_at desc;
$$;

revoke all on function public.archive_class_task(uuid, boolean) from public, anon;
revoke all on function public.delete_archived_class_task(uuid) from public, anon;
revoke all on function public.list_my_archived_class_tasks() from public, anon;
grant execute on function public.archive_class_task(uuid, boolean) to authenticated;
grant execute on function public.delete_archived_class_task(uuid) to authenticated;
grant execute on function public.list_my_archived_class_tasks() to authenticated;

-- ---------------------------------------------------------------- what reads past the policy

create or replace function public.send_deadline_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'deadline_soon'::public.notification_type,
         p.class_id, p.id, t.id,
         t.title,
         'Due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.notification_prefs np on np.user_id = a.student_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.archived_at is null
     and t.due_at > now()
     and t.due_at <= now() + interval '24 hours'
     and b.submitted_at is null
     and p.locked_at is null
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.student_id
          and n.task_id = t.id
          and n.type = 'deadline_soon'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

create or replace function public.send_overdue_notices()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'task_overdue'::public.notification_type,
         p.class_id, p.id, t.id,
         t.title,
         'Was due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
           || '. Finish it or ask to hand it over.'
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.notification_prefs np on np.user_id = a.student_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.archived_at is null
     and t.due_at <= now()
     and t.due_at > now() - interval '3 days'
     and b.submitted_at is null
     and p.locked_at is null
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.student_id
          and n.task_id = t.id
          and n.type = 'task_overdue'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

create or replace function public.send_weekly_digest()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  with mine as (
    select a.student_id,
           count(*) filter (
             where t.done_at >= now() - interval '7 days'
           )::int as finished,
           count(*) filter (
             where t.status <> 'done'
               and t.due_at is not null
               and t.due_at <= now() + interval '7 days'
           )::int as due_next,
           count(*) filter (
             where t.status <> 'done' and t.due_at is not null and t.due_at < now()
           )::int as overdue
      from public.task_assignees a
      join public.project_tasks t on t.id = a.task_id
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where p.archived_at is null
       and t.archived_at is null
     group by a.student_id
  )
  insert into public.notifications (user_id, type, title, preview)
  select m.student_id,
         'weekly_digest'::public.notification_type,
         'Your week: ' || m.finished || ' finished, ' || m.due_next || ' coming up',
         case
           when m.overdue > 0
             then m.overdue || ' past its date. ' || m.due_next || ' due in the next seven days.'
           when m.due_next = 0
             then 'Nothing due in the next seven days.'
           else m.due_next || ' due in the next seven days.'
         end
    from mine m
    join public.notification_prefs np on np.user_id = m.student_id
   where np.progress_digest
     and (m.finished > 0 or m.due_next > 0 or m.overdue > 0);
  get diagnostics sent = row_count;
  return sent;
end;
$$;

create or replace function public.board_member_cap(p_board uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when coalesce(m.count, 0) <= 1 then 0
    else coalesce(t.total, 0) / m.count
  end
  from (
    select count(*)::numeric as count
      from public.group_members g
      join public.project_boards b on b.group_id = g.group_id
     where b.id = p_board
  ) m
  cross join (
    select coalesce(sum(weight), 0)::numeric as total
      from public.project_tasks where board_id = p_board and archived_at is null
  ) t;
$$;

create or replace function public.board_member_held(p_board uuid, p_student uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    t.weight::numeric / greatest(1, (
      select count(*) from public.task_assignees x where x.task_id = t.id
    ))
  ), 0)
  from public.project_tasks t
  join public.task_assignees a on a.task_id = t.id
 where t.board_id = p_board and a.student_id = p_student and t.archived_at is null;
$$;

create or replace function public.group_work_summary(p_group uuid)
returns text language sql stable security definer set search_path = public as $$
  with counted as (
    select
      (select count(*)
         from public.project_tasks t
         join public.project_boards b on b.id = t.board_id
        where b.group_id = p_group and t.archived_at is null)::int as tasks,
      (select count(*)
         from public.messages m
         join public.conversations c on c.id = m.conversation_id
        where c.group_id = p_group and m.deleted_at is null)::int as msgs
  )
  select case
    when tasks = 0 and msgs = 0 then null
    when msgs = 0 then tasks || ' task' || case when tasks = 1 then '' else 's' end
    when tasks = 0 then msgs || ' message' || case when msgs = 1 then '' else 's' end
    else tasks || ' task' || case when tasks = 1 then '' else 's' end
         || ' and ' || msgs || ' message' || case when msgs = 1 then '' else 's' end
  end
  from counted;
$$;

-- The admin overview reads with the owner's rights (no security_invoker), so it
-- leaves archived tasks out itself. Same columns, same order.
create or replace view public.admin_class_overview as
 SELECT c.id AS class_id,
    c.initial AS class_initial,
    c.name AS class_name,
    c.code,
    c.section,
    c.year_level,
    c.semester,
    c.school_year,
    c.professor_id,
    btrim((p.first_name || ' '::text) || p.last_name) AS professor_name,
    c.term_start,
    c.term_end,
    c.archived_at,
    w.weeks_total > 0 AS has_syllabus,
    w.weeks_total,
    w.weeks_covered,
        CASE
            WHEN c.term_start IS NULL THEN NULL::integer
            ELSE GREATEST(1, (CURRENT_DATE - c.term_start) / 7)
        END AS weeks_elapsed,
        CASE
            WHEN c.term_start IS NULL OR c.term_end IS NULL THEN NULL::integer
            ELSE GREATEST(1, ceil((c.term_end - c.term_start)::numeric / 7.0)::integer)
        END AS weeks_in_term,
    m.students,
    pr.projects,
    pr.projects_released,
    b.boards,
    b.tasks,
    b.tasks_done,
    b.tasks_late,
    b.last_activity
   FROM classes c
     JOIN profiles p ON p.id = c.professor_id
     CROSS JOIN LATERAL ( SELECT count(*) FILTER (WHERE cm.status = 'active'::member_status)::integer AS students
           FROM class_members cm
          WHERE cm.class_id = c.id) m
     CROSS JOIN LATERAL ( SELECT count(*)::integer AS projects,
            count(*) FILTER (WHERE x.release_at IS NULL OR x.release_at <= now())::integer AS projects_released
           FROM projects x
          WHERE x.class_id = c.id AND x.archived_at IS NULL) pr
     CROSS JOIN LATERAL ( SELECT count(DISTINCT bd.id)::integer AS boards,
            count(t.id)::integer AS tasks,
            count(t.id) FILTER (WHERE t.status = 'done'::task_status)::integer AS tasks_done,
            count(t.id) FILTER (WHERE t.status = 'done'::task_status AND t.late)::integer AS tasks_late,
            max(t.updated_at) AS last_activity
           FROM project_boards bd
             JOIN projects x ON x.id = bd.project_id
             LEFT JOIN project_tasks t ON t.board_id = bd.id AND t.archived_at IS NULL
          WHERE x.class_id = c.id) b
     CROSS JOIN LATERAL ( SELECT (( SELECT count(*) AS count
                   FROM syllabus_weeks sw
                  WHERE sw.resource_id = c.syllabus_id))::integer AS weeks_total,
            (( SELECT count(DISTINCT g.week_no) AS count
                   FROM projects x
                     CROSS JOIN LATERAL generate_series(x.start_week, x.end_week) g(week_no)
                  WHERE x.class_id = c.id AND x.archived_at IS NULL))::integer AS weeks_covered) w
  WHERE is_admin();

-- ---------------------------------------------------------------- work tasks

/** As live (general-schedule-guard.sql), plus the archive-flag exemption marked below. */
create or replace function public.guard_general_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    raise exception 'Archive and restore through the archive buttons.'
      using errcode = 'insufficient_privilege';
  end if;

  if public.general_is_archived(old.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- A team delete still cascades team_id to null on an archived task.
  if old.archived_at is not null
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on'
     and not (
       new.team_id is null
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.status is not distinct from old.status
       and new.due_at is not distinct from old.due_at
       and new.starts_at is not distinct from old.starts_at
       and new.weight is not distinct from old.weight
     ) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
  end if;

  -- archive_general_task decides who may archive; while it holds the flag, the
  -- holder rule below would wrongly stop a creator archiving a task somebody took.
  if not public.general_can(old.project_id, 'manage_tasks')
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
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
$function$
;

/** As live, but a task's creator may archive it whether or not somebody holds it. */
create or replace function public.archive_general_task(p_task uuid, p_archived boolean)
returns public.general_tasks language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(t.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and t.archived_at is not null
     and not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or t.created_by = auth.uid()
    or (not p_archived and t.archived_by = auth.uid())
  ) then
    raise exception '%', case when p_archived
        then 'Only whoever added this task, or someone who manages tasks, can archive it.'
        else 'Only whoever added this task, or someone who manages tasks, can restore it.' end
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  perform set_config('collabify.general_archive_op', 'off', true);
  return t;
end;
$$;

commit;
