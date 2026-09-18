-- Project presets.
--
-- A preset is a starting shape, not a type: it writes fields, teams, positions
-- and tasks into a brand-new project and then has no further say. Nothing it
-- creates is locked, and `general_projects.preset` only records which shape the
-- project started from, so a later report can ask "how many research papers are
-- running" without the answer constraining anybody.
--
-- The content itself lives in src/lib/general/presets.ts. This file only knows
-- how to apply a payload, so adding a preset never needs a migration.
--
-- Redefines create_general_project, whose previous definition is in
-- supabase/general.sql. Re-running general.sql alone afterwards drops the
-- preset arguments; re-run this file after it.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.general_projects
  add column if not exists preset text;

comment on column public.general_projects.preset is
  'The preset this project started from, for reporting only. It grants and forbids nothing.';

commit;

begin;

/*
 * One transaction for the whole project.
 *
 * The old four-argument signature is dropped rather than left beside this one:
 * two functions differing only by defaulted arguments make every call
 * ambiguous, and PostgREST would pick by the keys it was sent.
 */
drop function if exists public.create_general_project(text, text, date, date);

create or replace function public.create_general_project(
  p_name        text,
  p_description text default '',
  p_starts_on   date default null,
  p_ends_on     date default null,
  p_preset      text default null,
  p_content     jsonb default null
) returns public.general_projects
language plpgsql security definer set search_path = public as $$
declare
  p          public.general_projects%rowtype;
  item       jsonb;
  team_name  text;
  team_ids   jsonb := '{}'::jsonb;
  n          int;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to create a project'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.rate_limit('general_create', 20, interval '1 hour',
    'You have created a lot of projects in the last hour. Try again later.');

  insert into public.general_projects (name, description, starts_on, ends_on, created_by, preset)
  values (btrim(p_name), coalesce(p_description, ''), p_starts_on, p_ends_on, auth.uid(),
          nullif(btrim(coalesce(p_preset, '')), ''))
  returning * into p;

  insert into public.general_members (project_id, user_id, level)
  values (p.id, auth.uid(), 'owner');

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return p;
  end if;

  -- Caps that match what a person could do by hand in one sitting. A payload
  -- over them is a mistake or an abuse, and either way is refused whole.
  if jsonb_array_length(coalesce(p_content -> 'fields', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_content -> 'teams', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_content -> 'positions', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_content -> 'tasks', '[]'::jsonb)) > 100 then
    raise exception 'That preset is too large to apply'
      using errcode = 'check_violation';
  end if;

  -- Teams first: a position or a task points at one by the name it was given,
  -- and only the database knows the id it just assigned.
  n := 0;
  for team_name in
    select value #>> '{}' from jsonb_array_elements(coalesce(p_content -> 'teams', '[]'::jsonb))
  loop
    if btrim(coalesce(team_name, '')) <> '' and not team_ids ? team_name then
      insert into public.general_teams (project_id, name)
      values (p.id, btrim(team_name))
      returning jsonb_build_object(team_name, id) into item;
      team_ids := team_ids || item;
      n := n + 1;
    end if;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'fields', '[]'::jsonb))
  loop
    insert into public.general_fields (project_id, name, type, options, sort)
    values (
      p.id,
      btrim(item ->> 'name'),
      (item ->> 'type')::public.general_field_type,
      coalesce(item -> 'options', '[]'::jsonb),
      coalesce((item ->> 'sort')::int, 0)
    );
  end loop;

  n := 0;
  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'positions', '[]'::jsonb))
  loop
    insert into public.general_positions (project_id, name, team_id, sort)
    values (
      p.id,
      btrim(item ->> 'name'),
      case when item ->> 'team' is not null then (team_ids ->> (item ->> 'team'))::uuid end,
      n
    );
    n := n + 1;
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_content -> 'tasks', '[]'::jsonb))
  loop
    insert into public.general_tasks (project_id, title, description, team_id, created_by)
    values (
      p.id,
      btrim(item ->> 'title'),
      coalesce(item ->> 'description', ''),
      case when item ->> 'team' is not null then (team_ids ->> (item ->> 'team'))::uuid end,
      auth.uid()
    );
  end loop;

  return p;
end;
$$;

revoke all on function public.create_general_project(text, text, date, date, text, jsonb) from public, anon;
grant execute on function public.create_general_project(text, text, date, date, text, jsonb) to authenticated;

commit;

begin;

-- The overview carries the preset so a card can say what kind of project it
-- started from without a second read. Appended last, because `create or replace
-- view` can only add columns at the end. Body copied from general-tasks.sql;
-- keep the two in step.
create or replace view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       -- RLS on general_join_codes leaves these null for anybody who cannot invite.
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
       -- Mirrors projectProgress() in src/lib/general/progress.ts.
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       -- RLS narrows this: an Owner counts every open request, a Member only their own.
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset
  from public.general_projects p
  join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id
  ) t on true;

grant select on public.general_project_overview to authenticated;

commit;
