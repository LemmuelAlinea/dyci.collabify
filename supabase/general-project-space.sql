-- Collabify — the space a project belongs to, by name.
--
--   node scripts/db.mjs supabase/general-project-space.sql
--
-- The projects page lists every project the account joined, across all spaces,
-- so a card has to say which space it came from. The view already carried
-- `space_id`; this adds the name beside it.
--
-- The join is a LEFT join on purpose. The view is security_invoker, so
-- general_spaces' own policy applies: a space is readable only by its members
-- and by somebody holding a pending invitation to it. Joining it any other way
-- would drop the project row entirely for anybody who joined a project by code
-- without joining its space — the project would vanish from their own list.
-- Left-joined, that reader keeps the project and gets a null name, which the
-- page renders as nothing rather than as a guess.
--
-- Redefines general_project_overview from general-project-archive.sql, which is
-- the last file to own it; run after that one.

begin;

create or replace view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       (select jc.code from public.general_join_codes jc where jc.project_id = p.id) as join_code,
       coalesce((select jc.open from public.general_join_codes jc where jc.project_id = p.id), false)
         as join_open,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at,
       m.level as my_level,
       (select count(*) from public.general_members x where x.project_id = p.id)::int as member_count,
       coalesce(t.task_count, 0) as task_count,
       coalesce(t.done_count, 0) as done_count,
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset,
       p.has_code,
       p.space_id,
       s.name as space_name
  from public.general_projects p
  left join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join public.general_spaces s on s.id = p.space_id
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id and x.archived_at is null
  ) t on true;

grant select on public.general_project_overview to authenticated;

commit;
