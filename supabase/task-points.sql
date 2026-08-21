-- Collabify — task points. A board always totals 100, however many tasks it holds.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/task-points.sql

begin;

-- Weights are stored relative and turned into percentages here, never the other
-- way round. Adding a task shrinks every other slice, so nobody earns more by
-- making more tasks.

drop view if exists public.task_member_progress cascade;
drop view if exists public.task_board_overview cascade;

create view public.task_board_overview
with (security_invoker = true) as
select b.id,
       b.project_id,
       b.group_id,
       b.student_id,
       p.class_id,
       p.title      as project_title,
       p.due_at     as project_due_at,
       p.total_points,
       g.name       as group_name,
       g.set_id     as group_set_id,
       t.task_count,
       t.done_count,
       t.doing_count,
       t.unclaimed_count,
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

/**
 * Two numbers per member, and they answer different questions.
 *
 *   personal_pct  — of the work this student holds, how much is finished.
 *                   This is their own 100, and their individual grade.
 *   group_pct     — how much of the group's 100 they have delivered.
 *   held_pct      — how much of the group's 100 is theirs to deliver.
 *
 * A student holding a fifth of the board and finishing all of it reads
 * personal 100%, held 20%, group 20% — which is exactly the intent.
 * Shared tasks split their weight equally between the people on them.
 */
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
            else round(coalesce(sum(h.share), 0) / bt.total * 100, 1) end as held_pct
  from board_members bm
  join board_total bt on bt.board_id = bm.board_id
  left join held h on h.board_id = bm.board_id and h.student_id = bm.student_id
 group by bm.board_id, bm.project_id, bm.student_id, bt.total;

grant select on public.task_member_progress to authenticated;

commit;
