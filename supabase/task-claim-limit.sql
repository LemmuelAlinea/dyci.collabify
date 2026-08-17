-- Collabify — a fair share of the work. Nobody claims past their slice.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/task-claim-limit.sql

begin;

/**
 * A member's ceiling: an equal cut of the board. Four in the group means 25 of
 * the 100, five means 20. Returned as weight, not a percentage, because that is
 * what the guard compares against.
 *
 * Zero means no ceiling — a solo board, or a board with nothing on it.
 */
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
      from public.project_tasks where board_id = p_board
  ) t;
$$;

/** What one student already carries on a board. Shared tasks split evenly. */
create or replace function public.board_member_held(p_board uuid, p_student uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    t.weight::numeric / greatest(1, (
      select count(*) from public.task_assignees x where x.task_id = t.id
    ))
  ), 0)
  from public.project_tasks t
  join public.task_assignees a on a.task_id = t.id
 where t.board_id = p_board and a.student_id = p_student;
$$;

/**
 * Claiming is the group's business, and it stops at a fair share.
 *
 * The test is on what the student already holds, not on what they would hold
 * afterwards: somebody still under their share may take one more task even if
 * it tips them over. That keeps a single heavy task claimable, and it cannot
 * deadlock — if any task is unclaimed then the held weights sum to less than
 * the board, so at least one member is below the cut.
 */
create or replace function public.guard_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board uuid := public.task_board(new.task_id);
  cap   numeric;
  held  numeric;
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;

  if public.is_board_professor(board) and not public.is_board_member(board) then
    raise exception 'A professor does not assign tasks — the group claims them';
  end if;

  if not public.is_board_member(board) then
    raise exception 'Only this board can claim its tasks';
  end if;

  -- You can only put someone on a task who actually works on that board.
  if not exists (
    select 1 from public.project_boards b
     where b.id = board
       and (
         b.student_id = new.student_id
         or exists (
           select 1 from public.group_members m
            where m.group_id = b.group_id and m.student_id = new.student_id
         )
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

-- ---------------------------------------------------------------- view

-- The same numbers the guard uses, so the UI can grey a name out before
-- somebody clicks and gets refused.
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
board_size as (
  select board_id, count(*)::numeric as members
    from board_members group by board_id
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
            else round(coalesce(sum(h.share), 0) / bt.total * 100, 1) end as held_pct,
       -- An equal cut of the board. 0 members-of-one means no ceiling at all.
       case when bs.members <= 1 then 100
            else round(100 / bs.members, 1) end as cap_pct,
       case when bs.members <= 1 or bt.total = 0 then true
            else coalesce(sum(h.share), 0) < bt.total / bs.members end as can_claim
  from board_members bm
  join board_total bt on bt.board_id = bm.board_id
  join board_size  bs on bs.board_id = bm.board_id
  left join held h on h.board_id = bm.board_id and h.student_id = bm.student_id
 group by bm.board_id, bm.project_id, bm.student_id, bt.total, bs.members;

grant select on public.task_member_progress to authenticated;

commit;
