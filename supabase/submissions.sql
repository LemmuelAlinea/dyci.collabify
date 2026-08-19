-- Collabify — a group hands in the whole project, not just its tasks.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/submissions.sql
--
-- This file now owns task_board_overview. It used to be redefined in
-- deadline-lock.sql as well, and two definitions of one view is how a column
-- goes missing: whichever file ran last silently wins. There is one copy, here.

begin;

/**
 * Finishing every task and finishing the project are different claims. The
 * board can be at 100% while the group is still tidying up, and a group can be
 * ready to hand in with something unfinished — the members who did their part
 * should not be held open by one who did not.
 *
 * So the group says when they are done, and that freezes their board.
 *
 * Two levels, and they are not the same thing:
 *
 *   submitted_at  — the group's own word, and theirs to take back while the
 *                   project is still open.
 *   locked_at     — the professor's, on the project. Once that is set nothing
 *                   moves for anybody, submission included.
 *
 * Comments stay open through both, for the same reason: handing in is when
 * feedback starts, not when it stops.
 */
alter table public.project_boards
  add column if not exists submitted_at timestamptz;

-- Who pressed it. Any member may, so the group can see who did rather than
-- arguing about it — and it is reversible, which is what makes that safe.
alter table public.project_boards
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------- helper

/** Whether this board has been handed in. */
create or replace function public.board_submitted(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
     where b.id = p_board and b.submitted_at is not null
  );
$$;

/**
 * Handing in, and taking it back. A member's own board only, and never while
 * the professor has the project closed — their word outranks the group's.
 *
 * The professor may also unsubmit one board without reopening the whole
 * project, which is how a single group gets to fix something.
 */
create or replace function public.set_board_submitted(
  p_board uuid,
  p_submitted boolean
) returns public.project_boards
language plpgsql security definer set search_path = public as $$
declare
  b public.project_boards%rowtype;
  is_prof boolean;
begin
  select * into b from public.project_boards where id = p_board for update;
  if b.id is null then
    raise exception 'That board no longer exists';
  end if;

  is_prof := public.is_board_professor(p_board);

  if auth.uid() is not null and not is_prof and not public.is_board_member(p_board) then
    raise exception 'Only this board can hand in its own work'
      using errcode = 'insufficient_privilege';
  end if;

  if auth.uid() is not null and not is_prof and public.board_project_locked(p_board) then
    raise exception
      'This project is closed, so nothing on it can change. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  if p_submitted and b.submitted_at is not null then
    return b; -- already in, and pressing again is not an error
  end if;

  update public.project_boards
     set submitted_at = case when p_submitted then now() else null end,
         submitted_by = case when p_submitted then auth.uid() else null end
   where id = p_board
  returning * into b;
  return b;
end;
$$;

grant execute on function public.set_board_submitted(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- guards

/**
 * As before, with the board's own submission alongside the project's lock. Two
 * separate sentences, because they are undone by different people and a student
 * told the wrong one goes to the wrong place for help.
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

  if public.board_submitted(old.board_id) then
    raise exception
      'This project has been handed in, so its tasks can no longer change. Take the submission back first if something still needs doing.'
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

/** Claiming, with the submission added to the same early refusals. */
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
    return new; -- service role, a restore, or a professor's reassignment
  end if;

  if not public.is_board_professor(board) then
    if public.board_project_locked(board) then
      raise exception
        'This project is closed, so its tasks can no longer be claimed. Ask your professor to reopen it.'
        using errcode = 'check_violation';
    end if;
    if public.board_submitted(board) then
      raise exception
        'This project has been handed in, so its tasks can no longer be claimed. Take the submission back first.'
        using errcode = 'check_violation';
    end if;
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

/** Handing work back is a change like any other. */
create or replace function public.guard_task_unclaim()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
  solo  uuid;
  board uuid;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.releasing', true), '') = 'on' then
    return old; -- service role, a member leaving, or a professor's reassignment
  end if;

  board := public.task_board(old.task_id);
  if board is not null and not public.is_board_professor(board) then
    if public.board_project_locked(board) then
      raise exception
        'This project is closed, so its tasks stay where they are. Ask your professor to reopen it.'
        using errcode = 'check_violation';
    end if;
    if public.board_submitted(board) then
      raise exception
        'This project has been handed in, so its tasks stay where they are. Take the submission back first.'
        using errcode = 'check_violation';
    end if;
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

-- Asking for work to change hands is a change to the work.
create or replace function public.guard_reassignment_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board  uuid;
  state  public.task_status;
  holder uuid;
  held   int;
begin
  board := public.task_board(new.task_id);
  if board is null then
    raise exception 'That task no longer exists';
  end if;

  new.status        := 'pending';
  new.to_student    := null;
  new.decided_by    := null;
  new.decided_at    := null;
  new.decision_note := '';

  if auth.uid() is null then
    return new; -- service role, and the test fixtures
  end if;

  new.requested_by := auth.uid();

  if not public.is_board_member(board) then
    raise exception 'Only this board can ask for its work to change hands'
      using errcode = 'check_violation';
  end if;

  if public.board_project_locked(board) then
    raise exception
      'This project is closed, so its work can no longer change hands. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  if public.board_submitted(board) then
    raise exception
      'This project has been handed in, so its work can no longer change hands. Take the submission back first.'
      using errcode = 'check_violation';
  end if;

  select status into state from public.project_tasks where id = new.task_id;
  if state = 'done' then
    raise exception 'That task is finished, so there is nothing to hand over'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.project_boards b
              where b.id = board and b.student_id is not null) then
    raise exception 'This is an individual project, so its work cannot change hands'
      using errcode = 'check_violation';
  end if;

  select count(*) into held from public.task_assignees a where a.task_id = new.task_id;
  if held = 1 then
    select a.student_id into holder
      from public.task_assignees a where a.task_id = new.task_id;
  end if;
  new.from_student := case when held = 1 then holder else null end;

  if held = 0 and new.wants = 'release' then
    raise exception 'Nobody holds that task, so there is nothing to release'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists task_reassignments_guard on public.task_reassignments;
create trigger task_reassignments_guard before insert on public.task_reassignments
  for each row execute function public.guard_reassignment_request();

-- ---------------------------------------------------------------- policies

-- A submitted board takes no new tasks.
drop policy if exists project_tasks_insert on public.project_tasks;
create policy project_tasks_insert on public.project_tasks
  for insert with check (
    public.is_board_professor(board_id)
    or (
      public.is_board_member(board_id)
      and status = 'todo'
      and not public.board_project_locked(board_id)
      and not public.board_submitted(board_id)
    )
  );

-- The deliverable is what was handed in, so it is fixed with everything else.
drop policy if exists task_files_insert on public.task_files;
create policy task_files_insert on public.task_files
  for insert with check (
    public.is_board_member(public.task_board(task_id))
    and not public.board_project_locked(public.task_board(task_id))
    and not public.board_submitted(public.task_board(task_id))
  );

drop policy if exists task_files_delete on public.task_files;
create policy task_files_delete on public.task_files
  for delete using (
    (
      public.is_board_member(public.task_board(task_id))
      and not public.board_project_locked(public.task_board(task_id))
      and not public.board_submitted(public.task_board(task_id))
    )
    or public.is_board_professor(public.task_board(task_id))
  );

drop policy if exists task_worklog_write on public.task_worklog;
create policy task_worklog_write on public.task_worklog
  for all using (student_id = auth.uid())
  with check (
    student_id = auth.uid()
    and not public.board_project_locked(public.task_board(task_id))
    and not public.board_submitted(public.task_board(task_id))
  );

-- task_comments is deliberately untouched, again. Handing in is when feedback
-- starts, and freezing the conversation at that exact moment would be perverse.

-- ---------------------------------------------------------------- view

-- task_board_overview moved on again, to results.sql, because it now has to
-- carry the standing verdict and board_results is created there. One file owns
-- it at a time: two definitions is how a column silently goes missing.


commit;
