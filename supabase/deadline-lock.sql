-- Collabify — a deadline records lateness; the professor's lock stops work.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/deadline-lock.sql

begin;

/**
 * Two questions were tangled in one date.
 *
 *   due_at    — when the work was due. A fact, used to judge it.
 *   locked_at — whether this project still takes work. A decision, the
 *               professor's to make.
 *
 * Keeping them apart means an extension never rewrites when something was due,
 * and a passed deadline neither locks a student out nor passes in silence.
 * Null locked_at is open, the same way null archived_at is not archived.
 */
alter table public.projects
  add column if not exists locked_at timestamptz;

/**
 * Stamped once, when the task is finished, and only meaningful while it is.
 * done_at already says when; this says whether that was in time. Storing it
 * rather than comparing on read means moving the deadline afterwards cannot
 * quietly excuse work that was handed in late.
 */
alter table public.project_tasks
  add column if not exists late boolean not null default false;

-- ---------------------------------------------------------------- helpers

/** Whether this board's project has been closed to further work. */
create or replace function public.board_project_locked(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board and p.locked_at is not null
  );
$$;

/** The deadline a board's tasks are judged against. Null means none was set. */
create or replace function public.board_project_due(p_board uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select p.due_at
    from public.project_boards b
    join public.projects p on p.id = b.project_id
   where b.id = p_board;
$$;

-- ---------------------------------------------------------------- tasks

/**
 * As before, plus the lock. A closed project refuses every student write with
 * one message rather than failing later and less clearly; the professor stays
 * exempt, because reopening the work is the whole point of being able to close
 * it. `late` is pinned in both branches — nobody hand-edits it, it is stamped.
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
    new.late       := old.late;
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
  return new;
end;
$$;

drop trigger if exists project_tasks_guard_edit on public.project_tasks;
create trigger project_tasks_guard_edit before update on public.project_tasks
  for each row execute function public.guard_task_edit();

/**
 * The timestamps, and now the verdict. It runs after guard_task_edit, so it has
 * the last word on `late` — and only on a status change, since the guard clause
 * above returns early otherwise.
 *
 * Moving out of done clears the flag: a task that is not finished cannot have
 * been finished late, and reopening one for a second attempt should re-judge it
 * on the attempt that counts.
 */
create or replace function public.stamp_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  deadline timestamptz;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  new.started_at := case
    when new.status = 'todo' then null
    when new.started_at is null then now()
    else new.started_at
  end;
  new.done_at := case when new.status = 'done' then now() else null end;

  if new.status = 'done' then
    deadline := public.board_project_due(new.board_id);
    new.late := deadline is not null and now() > deadline;
  else
    new.late := false;
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_stamp_status on public.project_tasks;
create trigger project_tasks_stamp_status before insert or update on public.project_tasks
  for each row execute function public.stamp_task_status();

-- ---------------------------------------------------------------- claiming

/**
 * As before, with the lock ahead of the rest: on a closed project there is no
 * point telling somebody their share is full when nothing may change anyway.
 * The professor is exempt so that adding work to a closed project — which the
 * solo auto-claim does on their behalf — still lands.
 */
create or replace function public.guard_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board uuid := public.task_board(new.task_id);
  solo  uuid;
  cap   numeric;
  held  numeric;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.restoring', true), '') = 'on' then
    return new; -- service role, or a removed student being put back
  end if;

  if public.board_project_locked(board) and not public.is_board_professor(board) then
    raise exception
      'This project is closed, so its tasks can no longer be claimed. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  select b.student_id into solo from public.project_boards b where b.id = board;
  if solo is not null then
    if new.student_id <> solo then
      raise exception 'This is an individual project — only its owner works on it';
    end if;
    new.claimed_by := coalesce(new.claimed_by, solo);
    return new;
  end if;

  if public.is_board_professor(board) and not public.is_board_member(board) then
    raise exception 'A professor does not assign tasks — the group claims them';
  end if;

  if not public.is_board_member(board) then
    raise exception 'Only this board can claim its tasks';
  end if;

  if not exists (
    select 1 from public.project_boards b
     where b.id = board
       and exists (
         select 1 from public.group_members m
          where m.group_id = b.group_id and m.student_id = new.student_id
       )
  ) then
    raise exception 'That student is not on this board';
  end if;

  cap := public.board_member_cap(board);
  if cap > 0 then
    held := public.board_member_held(board, new.student_id);
    if held >= cap then
      raise exception
        'That is already a full share of this project — % of the % each member carries. Hand something back first, or leave this one for a groupmate.',
        round(held, 1), round(cap, 1)
        using errcode = 'check_violation';
    end if;
  end if;

  new.claimed_by := coalesce(new.claimed_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists task_assignees_guard on public.task_assignees;
create trigger task_assignees_guard before insert on public.task_assignees
  for each row execute function public.guard_task_assignee();

/** Handing back is a change like any other, so the lock refuses it too. */
create or replace function public.guard_task_unclaim()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
  solo  uuid;
  board uuid;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.releasing', true), '') = 'on' then
    return old; -- service role, or a member being removed from the group
  end if;

  board := public.task_board(old.task_id);
  if board is not null
     and public.board_project_locked(board)
     and not public.is_board_professor(board) then
    raise exception
      'This project is closed, so its tasks stay where they are. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  select b.student_id into solo
    from public.project_boards b
    join public.project_tasks t on t.board_id = b.id
   where t.id = old.task_id;
  if solo is not null then
    raise exception 'An individual task stays with the student it belongs to'
      using errcode = 'check_violation';
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

-- ---------------------------------------------------------------- policies

-- A student adds nothing to a closed board; the professor still can.
drop policy if exists project_tasks_insert on public.project_tasks;
create policy project_tasks_insert on public.project_tasks
  for insert with check (
    public.is_board_professor(board_id)
    or (
      public.is_board_member(board_id)
      and status = 'todo'
      and not public.board_project_locked(board_id)
    )
  );

-- The deliverable is frozen with the rest of the work.
drop policy if exists task_files_insert on public.task_files;
create policy task_files_insert on public.task_files
  for insert with check (
    public.is_board_member(public.task_board(task_id))
    and not public.board_project_locked(public.task_board(task_id))
  );

drop policy if exists task_files_delete on public.task_files;
create policy task_files_delete on public.task_files
  for delete using (
    (
      public.is_board_member(public.task_board(task_id))
      and not public.board_project_locked(public.task_board(task_id))
    )
    or public.is_board_professor(public.task_board(task_id))
  );

-- Time logged after the project closed is time logged against nothing.
drop policy if exists task_worklog_write on public.task_worklog;
create policy task_worklog_write on public.task_worklog
  for all using (student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and not public.board_project_locked(public.task_board(task_id))
  );

-- Comments are deliberately left alone. A closed project is exactly when a
-- professor leaves feedback and a student answers it.

-- ---------------------------------------------------------------- views

/**
 * project_overview is `select p.*`, but Postgres expands the star when the view
 * is created and then freezes it. Adding locked_at to the table above does not
 * reach a view that already exists, so every page reading this view sees the
 * column as missing — the enforcement works while the UI cannot tell that a
 * project is closed. It has to be dropped and rebuilt, not replaced.
 */
drop view if exists public.project_overview;

create view public.project_overview
with (security_invoker = true) as
select p.*,
       c.name    as class_name,
       c.initial as class_initial,
       s.name    as group_set_name,
       (select count(*) from public.project_criteria x where x.project_id = p.id)::int
         as criteria_count,
       (select coalesce(sum(x.max_points), 0) from public.project_criteria x
         where x.project_id = p.id)::int as criteria_points,
       (select count(*) from public.project_attachments a where a.project_id = p.id)::int
         as attachment_count,
       (p.release_at is not null and p.release_at > now()) as scheduled,
       (select w.title from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id and w.week_no = p.start_week) as start_week_title,
       (select string_agg(w.assessments, ' · ' order by w.week_no)
          from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id
           and w.week_no between p.start_week and p.end_week
           and w.assessments <> '') as week_assessments
  from public.projects p
  join public.classes c on c.id = p.class_id
  left join public.group_sets s on s.id = p.group_set_id;

grant select on public.project_overview to authenticated;

drop view if exists public.task_board_overview;

create view public.task_board_overview
with (security_invoker = true) as
select b.id,
       b.project_id,
       b.group_id,
       b.student_id,
       p.class_id,
       p.title      as project_title,
       p.due_at     as project_due_at,
       p.locked_at  as project_locked_at,
       p.total_points,
       g.name       as group_name,
       g.set_id     as group_set_id,
       t.task_count,
       t.done_count,
       t.doing_count,
       t.unclaimed_count,
       t.late_count,
       (select count(*) from public.group_members m where m.group_id = b.group_id)::int
         as member_count,
       t.total_weight,
       -- The board's 100, split by how far the work has got.
       case when t.total_weight = 0 then 0
            else round(t.done_weight / t.total_weight * 100, 1) end as done_pct,
       case when t.total_weight = 0 then 0
            else round(t.doing_weight / t.total_weight * 100, 1) end as doing_pct,
       case when t.total_weight = 0 then 0
            else round(t.unclaimed_weight / t.total_weight * 100, 1) end as unclaimed_pct
  from public.project_boards b
  join public.projects p on p.id = b.project_id
  left join public.groups g on g.id = b.group_id
  cross join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           count(*) filter (where x.status = 'in_progress')::int as doing_count,
           count(*) filter (
             where not exists (select 1 from public.task_assignees a where a.task_id = x.id)
           )::int as unclaimed_count,
           count(*) filter (where x.status = 'done' and x.late)::int as late_count,
           coalesce(sum(x.weight), 0)::numeric as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0)::numeric as done_weight,
           coalesce(sum(x.weight) filter (where x.status = 'in_progress'), 0)::numeric
             as doing_weight,
           coalesce(sum(x.weight) filter (
             where not exists (select 1 from public.task_assignees a where a.task_id = x.id)
           ), 0)::numeric as unclaimed_weight
      from public.project_tasks x
     where x.board_id = b.id
  ) t;

grant select on public.task_board_overview to authenticated;

drop view if exists public.task_member_progress;

create view public.task_member_progress
with (security_invoker = true) as
with board_members as (
  select b.id as board_id, b.project_id, m.student_id
    from public.project_boards b
    join public.group_members m on m.group_id = b.group_id
  union
  select b.id, b.project_id, b.student_id
    from public.project_boards b
   where b.student_id is not null
),
board_total as (
  select board_id, coalesce(sum(weight), 0)::numeric as total
    from public.project_tasks
   group by board_id
),
held as (
  select t.board_id,
         a.student_id,
         t.status,
         t.late,
         t.weight::numeric / greatest(1, (
           select count(*) from public.task_assignees x where x.task_id = t.id
         )) as share
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
)
select bm.board_id,
       bm.project_id,
       bm.student_id,
       coalesce(count(h.share) filter (where h.share is not null), 0)::int as task_count,
       coalesce(count(h.share) filter (where h.status = 'done'), 0)::int   as done_count,
       coalesce(count(h.share) filter (where h.status = 'done' and h.late), 0)::int
         as late_count,
       coalesce(sum(h.share), 0)                                          as held_weight,
       coalesce(sum(h.share) filter (where h.status = 'done'), 0)          as done_weight,
       -- Null, not zero: a student holding nothing has no personal score yet.
       case when coalesce(sum(h.share), 0) = 0 then null
            else round(coalesce(sum(h.share) filter (where h.status = 'done'), 0)
                       / sum(h.share) * 100, 1) end as personal_pct,
       case when bt.total = 0 then 0
            else round(coalesce(sum(h.share) filter (where h.status = 'done'), 0)
                       / bt.total * 100, 1) end as group_pct,
       case when bt.total = 0 then 0
            else round(coalesce(sum(h.share), 0) / bt.total * 100, 1) end as held_pct
  from board_members bm
  join board_total bt on bt.board_id = bm.board_id
  left join held h on h.board_id = bm.board_id and h.student_id = bm.student_id
 group by bm.board_id, bm.project_id, bm.student_id, bt.total;

grant select on public.task_member_progress to authenticated;

-- Work already finished after its deadline predates the stamp. Judge it now,
-- once, so the flag is not blank for everything that came before.
--
-- Both before-update triggers have to stand down for it: guard_task_edit pins
-- `late` to its old value by design, which would make this a silent no-op, and
-- touch_updated_at would date every backfilled task to today as though somebody
-- had just edited it.
alter table public.project_tasks disable trigger project_tasks_guard_edit;
alter table public.project_tasks disable trigger project_tasks_touch;

update public.project_tasks t
   set late = true
  from public.project_boards b
  join public.projects p on p.id = b.project_id
 where t.board_id = b.id
   and t.status = 'done'
   and t.done_at is not null
   and p.due_at is not null
   and t.done_at > p.due_at
   and not t.late;

alter table public.project_tasks enable trigger project_tasks_guard_edit;
alter table public.project_tasks enable trigger project_tasks_touch;

commit;
