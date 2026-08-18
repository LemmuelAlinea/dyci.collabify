-- Collabify — on a solo board the owner already owns the work.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/solo-auto-claim.sql

begin;

/**
 * An individual project gives each student a board of their own, so there is
 * nobody else who could take a task on it. Claiming would be a step that only
 * ever has one answer, so the owner is put on every task the moment it appears
 * — whether the professor set it, the student wrote it, or AI drafted it.
 */
create or replace function public.claim_solo_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select b.student_id into owner
    from public.project_boards b where b.id = new.board_id;

  if owner is not null then
    insert into public.task_assignees (task_id, student_id, claimed_by)
    values (new.id, owner, owner)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_claim_solo on public.project_tasks;
create trigger project_tasks_claim_solo after insert on public.project_tasks
  for each row execute function public.claim_solo_task();

-- The board's own student is not a professor assigning work to somebody else,
-- and a board of one has no share to run out of.
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

-- Handing back is meaningless when there is nobody to hand it to.
create or replace function public.guard_task_unclaim()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  state public.task_status;
  solo  uuid;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.releasing', true), '') = 'on' then
    return old; -- service role, or a member being removed from the group
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

-- Solo boards that predate this: put their owner on what is already there.
insert into public.task_assignees (task_id, student_id, claimed_by)
select t.id, b.student_id, b.student_id
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
 where b.student_id is not null
   and not exists (
     select 1 from public.task_assignees a where a.task_id = t.id
   )
on conflict do nothing;

commit;
