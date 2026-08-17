-- Collabify — dashboards. One column: when a board last moved.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/dashboard.sql

begin;

-- A stalled group is the one thing a professor cannot find without this. Null
-- on an empty board, so "never touched" and "touched long ago" stay different.
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
       -- The board always totals 100, split by how far the work has got.
       case when t.total_weight = 0 then 0
            else round(t.done_weight / t.total_weight * 100, 1) end as done_pct,
       case when t.total_weight = 0 then 0
            else round(t.doing_weight / t.total_weight * 100, 1) end as doing_pct,
       case when t.total_weight = 0 then 0
            else round(t.unclaimed_weight / t.total_weight * 100, 1) end as unclaimed_pct,
       t.last_activity
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
           ), 0)::numeric as unclaimed_weight,
           max(x.updated_at) as last_activity
      from public.project_tasks x
     where x.board_id = b.id
  ) t;

grant select on public.task_board_overview to authenticated;

-- The dashboard reads announcements across every class at once.
create index if not exists announcements_recent_idx
  on public.announcements (class_id, pinned desc, created_at desc);

commit;
