-- Collabify — the professor answers what was handed in.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/results.sql

/**
 * The work ended in silence. A group handed in, the deadline passed, the
 * professor closed it — and nothing recorded what they thought. The student's
 * last signal was "handed in", which is the same signal a group that did
 * nothing gets.
 *
 * So a board gets an answer: accepted, or returned to be fixed.
 *
 * Deliberately no score. A number here would be a second grade record beside
 * whatever the school already keeps, and the one here would not be the one that
 * counts. A verdict and a reason do not compete with a grade book, and they
 * belong where the work is rather than in a spreadsheet away from it.
 *
 * Returning reuses the submission rather than inventing a second state: it
 * un-submits the board, which unfreezes it, which is exactly what "fix this and
 * hand it in again" means. Accepting leaves it submitted, so it stays frozen.
 */

begin;

do $$ begin
  alter type public.notification_type add value if not exists 'result_recorded';
exception when undefined_object then null; end $$;

commit;

begin;

do $$ begin
  create type public.result_verdict as enum ('accepted', 'returned');
exception when duplicate_object then null; end $$;

/**
 * A history, not a single answer. Work is returned, fixed, handed in again and
 * accepted — and the first two rows are the useful ones when a student asks why
 * their mark is what it is. The newest row is the board's standing.
 */
create table if not exists public.board_results (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.project_boards (id) on delete cascade,
  verdict     public.result_verdict not null,
  feedback    text not null default '',
  decided_by  uuid references public.profiles (id) on delete set null,
  -- clock_timestamp, not now(): now() is the transaction's start, so two
  -- answers recorded in one transaction would tie and "the latest" would then
  -- be whichever the planner happened to return.
  decided_at  timestamptz not null default clock_timestamp(),

  -- A return with no reason is not a response; it is a rejection slip.
  constraint board_results_reason_when_returned
    check (verdict = 'accepted' or length(btrim(feedback)) > 0)
);

-- create table if not exists leaves an existing default alone, so set it here.
alter table public.board_results
  alter column decided_at set default clock_timestamp();

create index if not exists board_results_by_board
  on public.board_results (board_id, decided_at desc);

-- ---------------------------------------------------------------- deciding

create or replace function public.record_board_result(
  p_board    uuid,
  p_verdict  public.result_verdict,
  p_feedback text default ''
) returns public.board_results
language plpgsql security definer set search_path = public as $$
declare
  b    public.project_boards%rowtype;
  proj public.projects%rowtype;
  res  public.board_results%rowtype;
begin
  select * into b from public.project_boards where id = p_board for update;
  if b.id is null then
    raise exception 'That board no longer exists';
  end if;

  if auth.uid() is not null and not public.is_board_professor(p_board) then
    raise exception 'Only the professor of this class answers what was handed in'
      using errcode = 'insufficient_privilege';
  end if;

  if b.submitted_at is null then
    raise exception 'That has not been handed in yet, so there is nothing to answer'
      using errcode = 'check_violation';
  end if;

  insert into public.board_results (board_id, verdict, feedback, decided_by)
  values (p_board, p_verdict, coalesce(btrim(p_feedback), ''), auth.uid())
  returning * into res;

  -- Returning it is what gives the group their board back.
  if p_verdict = 'returned' then
    update public.project_boards
       set submitted_at = null, submitted_by = null
     where id = p_board;
  end if;

  select p.* into proj from public.projects p where p.id = b.project_id;

  insert into public.notifications
    (user_id, type, class_id, project_id, title, preview)
  select m.student_id, 'result_recorded'::public.notification_type, proj.class_id, proj.id,
         proj.title,
         case when p_verdict = 'accepted'
              then 'Your professor accepted what you handed in'
              else 'Your professor returned this for another look' end
    from public.group_members m
   where m.group_id = b.group_id
  union all
  select b.student_id, 'result_recorded'::public.notification_type, proj.class_id, proj.id,
         proj.title,
         case when p_verdict = 'accepted'
              then 'Your professor accepted what you handed in'
              else 'Your professor returned this for another look' end
   where b.student_id is not null;

  return res;
end;
$$;

grant execute on function
  public.record_board_result(uuid, public.result_verdict, text) to authenticated;

-- ---------------------------------------------------------------- policies

alter table public.board_results enable row level security;

/** The group reads its own answer; the professor reads and writes theirs. */
drop policy if exists board_results_select on public.board_results;
create policy board_results_select on public.board_results
  for select using (
    public.is_board_member(board_id) or public.is_board_professor(board_id)
  );

-- No insert, update or delete policy: results only ever arrive through
-- record_board_result, which checks who is asking and keeps the board in step.

grant select on public.board_results to authenticated;

-- ---------------------------------------------------------------- view

/** The standing answer per board, with who gave it. */
drop view if exists public.board_result_overview;

create view public.board_result_overview
with (security_invoker = true) as
select distinct on (r.board_id)
       r.id,
       r.board_id,
       r.verdict,
       r.feedback,
       r.decided_at,
       r.decided_by,
       btrim(p.first_name || ' ' || p.last_name) as decided_by_name,
       (select count(*) from public.board_results x where x.board_id = r.board_id)::int
         as answer_count
  from public.board_results r
  left join public.profiles p on p.id = r.decided_by
 order by r.board_id, r.decided_at desc;

grant select on public.board_result_overview to authenticated;

-- ---------------------------------------------------------------- board view

/**
 * task_board_overview lives here now: it has to carry the standing verdict, and
 * board_results is created in this file. One file owns it at a time — two
 * definitions is how a column silently goes missing, which is exactly what
 * happened to `last_activity` below. It was added in dashboard.sql, dropped
 * without anyone noticing when deadline-lock.sql redefined the view, and
 * findStalled has been reading undefined ever since — dating every unfinished
 * board to the epoch and calling it stalled for twenty thousand days.
 */
drop view if exists public.task_board_overview;

create view public.task_board_overview
with (security_invoker = true) as
select b.id,
       b.project_id,
       b.group_id,
       b.student_id,
       b.submitted_at,
       b.submitted_by,
       btrim(sb.first_name || ' ' || sb.last_name) as submitted_by_name,
       p.class_id,
       p.title      as project_title,
       p.due_at     as project_due_at,
       p.locked_at  as project_locked_at,
       p.total_points,
       g.name       as group_name,
       g.set_id     as group_set_id,
       -- An individual board has no group to name it, so it is named by the
       -- student who owns it. Null on a group board.
       case when b.student_id is null then null
            else btrim(sp.first_name || ' ' || sp.last_name) end as student_name,
       -- The standing answer, so a card can say what became of the work.
       res.verdict    as result_verdict,
       res.decided_at as result_at,
       t.task_count,
       t.done_count,
       t.doing_count,
       t.unclaimed_count,
       t.late_count,
       (select count(*) from public.group_members m where m.group_id = b.group_id)::int
         as member_count,
       t.total_weight,
       t.last_activity,
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
  left join public.profiles sp on sp.id = b.student_id
  left join public.profiles sb on sb.id = b.submitted_by
  left join lateral (
    select r.verdict, r.decided_at
      from public.board_results r
     where r.board_id = b.id
     order by r.decided_at desc
     limit 1
  ) res on true
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
           ), 0)::numeric as unclaimed_weight,
           max(x.updated_at) as last_activity
      from public.project_tasks x
     where x.board_id = b.id
  ) t;

grant select on public.task_board_overview to authenticated;

commit;
