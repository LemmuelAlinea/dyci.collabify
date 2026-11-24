-- supabase/stage-plan.sql
-- Suggest stages (docs/superpowers/specs/2026-11-24-stage-suggestions-design.md).
--
-- general_stage_plan_context gives a work project's planner everything a stage
-- plan needs: the window still to plan, the stage slots (length, dates, each
-- slot's team hours, the buffer), the tasks to place, the milestones and a
-- fingerprint of what was read. work-ai's `stages` action asks the model to
-- place the tasks; the app shows the checked plan; apply_stage_plan writes it
-- in one transaction, or refuses when anything it read has changed.
--
-- Runs after subtask-dates.sql and before anon-lockdown.sql. It redefines
-- nothing another file owns. Suite: supabase/tests/stage-plan.test.sql.

------------------------------------------------------------------ helpers

-- The project's stage mode, 'sequential' when it has no settings row.
create or replace function public.stage_plan_org(p_project uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select organization from public.general_sprint_settings where project_id = p_project), 'sequential');
$$;

revoke all on function public.stage_plan_org(uuid) from public, anon, authenticated;

-- The tasks a plan places: released, live, open, top-level tasks in the
-- backlog or in a planned stage (in streams, the team's only). A task with live
-- open subtasks counts their estimates, otherwise its own.
create or replace function public.stage_plan_tasks(p_project uuid, p_team uuid)
returns table(id uuid, title text, description text, minutes int, priority text, rank double precision,
              due_at timestamptz, milestone_id uuid, sprint_id uuid, subtasks int)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.title, coalesce(t.description, ''),
         case when sub.n > 0 then sub.mins else t.estimated_minutes end,
         t.priority, t.rank, t.due_at, t.milestone_id, t.sprint_id, coalesce(sub.n, 0)
    from public.general_tasks t
    cross join lateral (
      select count(*)::int as n, sum(st.estimated_minutes)::int as mins
        from public.general_tasks st
       where st.parent_id = t.id and st.archived_at is null and st.trashed_at is null and st.status <> 'done'
    ) sub
   where t.project_id = p_project
     and t.parent_id is null
     and t.archived_at is null and t.trashed_at is null
     and t.status <> 'done'
     and coalesce(t.routing_state, 'released') = 'released'
     and (t.sprint_id is null or exists (
           select 1 from public.general_sprints g where g.id = t.sprint_id and g.state = 'planned'))
     and (public.stage_plan_org(p_project) <> 'streams' or t.team_id = p_team);
$$;

revoke all on function public.stage_plan_tasks(uuid, uuid) from public, anon, authenticated;

-- The planned stages a plan may change, in date order.
create or replace function public.stage_plan_planned(p_project uuid, p_team uuid)
returns setof public.general_sprints
language sql
stable
security definer
set search_path = public
as $$
  select g.* from public.general_sprints g
   where g.project_id = p_project and g.state = 'planned'
     and (public.stage_plan_org(p_project) <> 'streams' or g.team_id = p_team)
   order by g.starts_on, g.created_at, g.id;
$$;

revoke all on function public.stage_plan_planned(uuid, uuid) from public, anon, authenticated;

-- The people whose hours count: active, live members who may hold tasks
-- (not stakeholders or QA); in streams, the team's members.
create or replace function public.stage_plan_people(p_project uuid, p_team uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(gm.user_id order by gm.user_id), '{}')
    from public.general_members gm
    join public.profiles pr on pr.id = gm.user_id and pr.status = 'active'
   where gm.project_id = p_project and gm.role not in ('stakeholder', 'qa')
     and (public.stage_plan_org(p_project) <> 'streams' or exists (
           select 1 from public.general_team_members tm where tm.team_id = p_team and tm.user_id = gm.user_id));
$$;

revoke all on function public.stage_plan_people(uuid, uuid) from public, anon, authenticated;

-- Free minutes for this project in the dates: each person's available hours
-- (time off taken away) minus their load in the space's other projects.
create or replace function public.stage_plan_capacity(p_space uuid, p_project uuid, p_people uuid[], p_from date, p_to date)
returns table(total int, best int)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(f.free), 0)::int, coalesce(max(f.free), 0)::int
    from unnest(p_people) as pe(uid)
    cross join lateral (
      select greatest(0,
        coalesce((select h.available_minutes from public.work_person_hours(p_space, pe.uid, p_from, p_to) h), 0)
        - coalesce((select sum(l.load_minutes) from public.work_person_load(p_space, pe.uid, p_from, p_to) l
                     where l.project_id is distinct from p_project), 0)) as free
    ) f;
$$;

revoke all on function public.stage_plan_capacity(uuid, uuid, uuid[], date, date) from public, anon, authenticated;

-- Refuses unless the caller plans this live work project.
create or replace function public.stage_plan_guard(p_project uuid)
returns public.general_projects
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  gp public.general_projects;
begin
  if auth.uid() is null then
    raise exception 'Sign in to plan stages.' using errcode = 'insufficient_privilege';
  end if;
  select * into gp from public.general_projects where id = p_project;
  if gp.id is null or gp.class_board_id is not null then
    raise exception 'Suggest stages is for work projects only.' using errcode = 'insufficient_privilege';
  end if;
  if not public.work_is_project_planner(p_project) then
    raise exception 'Only the project manager and coordinators can plan stages.' using errcode = 'insufficient_privilege';
  end if;
  if gp.archived_at is not null or gp.trashed_at is not null then
    raise exception 'This project is archived, so its stages can no longer change.' using errcode = 'insufficient_privilege';
  end if;
  return gp;
end;
$$;

revoke all on function public.stage_plan_guard(uuid) from public, anon, authenticated;

-- A live team of this project.
create or replace function public.stage_plan_team_ok(p_project uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team is not null and exists (
    select 1 from public.general_teams t where t.id = p_team and t.project_id = p_project and t.archived_at is null);
$$;

revoke all on function public.stage_plan_team_ok(uuid, uuid) from public, anon, authenticated;

------------------------------------------------------------------ fingerprint

-- What a plan was built from: the tasks' stage, hours and due time, and the
-- planned stages' dates, names and milestone. Internal.
create or replace function public.stage_plan_shown(p_project uuid, p_team uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(
    coalesce((select string_agg(concat_ws('|', t.id, t.sprint_id, t.minutes, t.due_at, t.milestone_id), ';' order by t.id)
                from public.stage_plan_tasks(p_project, p_team) t), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('|', g.id, g.starts_on, g.ends_on, g.milestone_id, g.name, g.goal), ';' order by g.id)
                from public.stage_plan_planned(p_project, p_team) g), '')
    || '#' ||
    coalesce((select string_agg(concat_ws('|', g.id, g.ends_on), ';' order by g.id)
                from public.general_sprints g
               where g.project_id = p_project and g.state = 'active'
                 and (public.stage_plan_org(p_project) <> 'streams' or g.team_id = p_team)), ''));
$$;

revoke all on function public.stage_plan_shown(uuid, uuid) from public, anon, authenticated;

------------------------------------------------------------------ context

create or replace function public.general_stage_plan_context(
  p_project uuid, p_team uuid default null, p_length_days int default null)
returns jsonb
language plpgsql
volatile -- fills a temporary table
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  gp        public.general_projects;
  v_org     text;
  v_base    int;
  v_from    date;
  v_to      date;
  v_today   date := public.work_today();
  v_people  uuid[];
  v_biggest int;
  v_total   int;
  v_len     int;
  v_suggest int;
  v_planned uuid[];
  v_stages  jsonb := '[]'::jsonb;
  v_start   date;
  v_end     date;
  v_snap    date;
  v_cap     int;
  v_cum     bigint := 0;
  v_i       int := 0;
  v_count   int;
  v_tasks   jsonb;
  v_keys    jsonb;
  v_ms      jsonb;
  v_project jsonb;
  v_running jsonb;
  v_left    int;
  r         record;
begin
  gp := public.stage_plan_guard(p_project);
  v_org := public.stage_plan_org(p_project);

  select jsonb_build_object('id', gp.id, 'name', gp.name, 'description', coalesce(gp.description, ''),
           'starts_on', gp.starts_on, 'ends_on', gp.ends_on, 'organization', v_org,
           'term_singular', coalesce(st.term_singular, 'Stage'), 'term_plural', coalesce(st.term_plural, 'Stages')),
         coalesce(st.length_days, 14)
    into v_project, v_base
    from (select 1) one
    left join public.general_sprint_settings st on st.project_id = p_project;

  if v_org = 'streams' and not public.stage_plan_team_ok(p_project, p_team) then
    return jsonb_build_object('blocked', 'Choose a team to plan its stages.', 'project', v_project,
      'length_days', null, 'suggested_length_days', null, 'window', null, 'running', '[]'::jsonb,
      'stages', '[]'::jsonb, 'tasks', '[]'::jsonb, 'milestones', '[]'::jsonb, 'total_minutes', 0,
      'unestimated', 0, 'planning_count', 0, 'left_out', 0, 'outside_count', 0, 'shown', null);
  end if;

  -- The running stages (the team's, in streams); the plan starts after the last.
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'ends_on', g.ends_on,
           'task_count', (select count(*) from public.general_tasks t
                           where t.sprint_id = g.id and t.archived_at is null and t.trashed_at is null))
           order by g.ends_on), '[]'::jsonb)
    into v_running
    from public.general_sprints g
   where g.project_id = p_project and g.state = 'active'
     and (v_org <> 'streams' or g.team_id = p_team);

  -- The window: never today; after the project's start and any running stage.
  v_from := v_today + 1;
  v_from := v_from + case extract(isodow from v_from)::int when 6 then 2 when 7 then 1 else 0 end;
  v_from := greatest(v_from, coalesce(gp.starts_on, v_from),
    coalesce((select max(g.ends_on) + 1 from public.general_sprints g
               where g.project_id = p_project and g.state = 'active'
                 and (v_org <> 'streams' or g.team_id = p_team)), v_from));
  v_to := gp.ends_on;
  if v_to is not null and v_from > v_to then
    return jsonb_build_object('blocked', 'The project ends before another stage could start.', 'project', v_project,
      'length_days', null, 'suggested_length_days', null, 'window', jsonb_build_object('from', v_from, 'to', v_to),
      'running', v_running, 'stages', '[]'::jsonb, 'tasks', '[]'::jsonb, 'milestones', '[]'::jsonb,
      'total_minutes', 0, 'unestimated', 0, 'planning_count', 0, 'left_out', 0, 'outside_count', 0, 'shown', null);
  end if;

  -- The tasks, due soonest first (undated last, then by rank), at most 200.
  create temporary table if not exists pg_temp.stage_plan_rows (
    ord int, id uuid, title text, description text, minutes int, priority text, rank double precision,
    due_at timestamptz, milestone_id uuid, sprint_id uuid, subtasks int) on commit drop;
  delete from pg_temp.stage_plan_rows;
  insert into pg_temp.stage_plan_rows
  select row_number() over (order by t.due_at nulls last, t.rank, t.id)::int, t.*
    from public.stage_plan_tasks(p_project, p_team) t;
  select count(*) filter (where ord > 200) into v_left from pg_temp.stage_plan_rows;
  delete from pg_temp.stage_plan_rows where ord > 200;

  select coalesce(max(minutes), 0), coalesce(sum(minutes), 0) into v_biggest, v_total from pg_temp.stage_plan_rows;
  v_people := public.stage_plan_people(p_project, p_team);

  -- The length: the setting in whole weeks, longer while the biggest task
  -- doesn't fit one person's free hours in one stage, a week when the window is short.
  v_suggest := greatest(7, least(28, (round(v_base / 7.0) * 7)::int));
  while v_suggest < 28 and v_biggest > (
      select c.best from public.stage_plan_capacity(gp.space_id, p_project, v_people, v_from, v_from + v_suggest - 1) c) loop
    v_suggest := v_suggest + 7;
  end loop;
  if v_to is not null and (v_to - v_from + 1) < 2 * v_suggest then
    v_suggest := 7;
  end if;
  v_len := case when p_length_days in (7, 14, 21, 28) then p_length_days else v_suggest end;

  -- The slots, back to back; an end within 3 days of a milestone moves onto it.
  select array_agg(g.id order by g.starts_on, g.created_at, g.id) into v_planned
    from public.stage_plan_planned(p_project, p_team) g;
  v_start := v_from;
  loop
    exit when v_to is not null and v_start > v_to;
    v_end := v_start + v_len - 1;
    if v_to is not null and v_end >= v_to then
      v_end := v_to;
    else
      select m.due_on into v_snap
        from public.general_milestones m
       where m.project_id = p_project and m.reached_at is null
         and m.due_on between greatest(v_start, v_end - 3) and v_end + 3
         and (v_to is null or m.due_on <= v_to)
       order by abs(m.due_on - v_end), m.due_on
       limit 1;
      if v_snap is not null then v_end := v_snap; end if;
      v_snap := null;
    end if;
    select c.total into v_cap from public.stage_plan_capacity(gp.space_id, p_project, v_people, v_start, v_end) c;
    v_i := v_i + 1;
    v_stages := v_stages || jsonb_build_object('key', 's' || v_i, 'starts_on', v_start, 'ends_on', v_end,
      'capacity_minutes', v_cap, 'buffer', false);
    v_cum := v_cum + v_cap;
    v_start := v_end + 1;
    if v_to is null then
      -- Enough stages for the work, then one more as the buffer.
      exit when v_i >= 26;
      if v_cum >= v_total and v_i >= 1 then
        v_end := v_start + v_len - 1;
        select c.total into v_cap from public.stage_plan_capacity(gp.space_id, p_project, v_people, v_start, v_end) c;
        v_i := v_i + 1;
        v_stages := v_stages || jsonb_build_object('key', 's' || v_i, 'starts_on', v_start, 'ends_on', v_end,
          'capacity_minutes', v_cap, 'buffer', false);
        exit;
      end if;
    end if;
    exit when v_i >= 52;
  end loop;

  v_count := jsonb_array_length(v_stages);
  if v_count >= 2 then
    v_stages := jsonb_set(v_stages, array[(v_count - 1)::text, 'buffer'], 'true'::jsonb);
  end if;

  -- Reuse the planned stages in order; keep a milestone link only while it still holds.
  for r in select i, g.id, g.milestone_id, m.name as ms_name, m.due_on as ms_due
             from generate_subscripts(coalesce(v_planned, '{}'::uuid[]), 1) i
             join public.general_sprints g on g.id = v_planned[i]
             left join public.general_milestones m on m.id = g.milestone_id
            where i <= v_count loop
    v_stages := jsonb_set(v_stages, array[(r.i - 1)::text, 'id'], to_jsonb(r.id));
    if r.milestone_id is not null and r.ms_due is not null
       and (v_stages -> (r.i - 1) ->> 'ends_on')::date <= r.ms_due then
      v_stages := jsonb_set(v_stages, array[(r.i - 1)::text, 'milestone_id'], to_jsonb(r.milestone_id));
    elsif r.milestone_id is not null then
      v_stages := jsonb_set(v_stages, array[(r.i - 1)::text, 'milestone_lost'], to_jsonb(r.ms_name));
    end if;
  end loop;
  select coalesce(jsonb_agg(x || jsonb_build_object(
           'id', coalesce(x -> 'id', 'null'::jsonb),
           'milestone_id', coalesce(x -> 'milestone_id', 'null'::jsonb),
           'milestone_lost', coalesce(x -> 'milestone_lost', 'null'::jsonb)) order by o), '[]'::jsonb)
    into v_stages
    from jsonb_array_elements(v_stages) with ordinality a(x, o);

  -- Tasks with keys; dependencies mapped onto the tasks in this plan.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r2.id, 'key', 't' || r2.ord, 'title', r2.title, 'description', r2.description,
           'minutes', r2.minutes, 'priority', r2.priority, 'rank', r2.rank,
           'due_on', (r2.due_at at time zone 'Asia/Manila')::date, 'dated', r2.due_at is not null,
           'milestone_id', r2.milestone_id, 'sprint_id', r2.sprint_id, 'subtasks', r2.subtasks,
           'depends_on', coalesce((
             select jsonb_agg(distinct d2.dep)
               from (select coalesce(dt.parent_id, dt.id) as dep
                       from public.general_task_dependencies d
                       join public.general_tasks it on it.id = d.task_id
                       join public.general_tasks dt on dt.id = d.depends_on_id
                      where d.project_id = p_project
                        and coalesce(it.parent_id, it.id) = r2.id) d2
              where d2.dep <> r2.id and exists (select 1 from pg_temp.stage_plan_rows q where q.id = d2.dep)),
             '[]'::jsonb)) order by r2.ord), '[]'::jsonb)
    into v_tasks
    from pg_temp.stage_plan_rows r2;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'key', 'm' || m.o, 'name', m.name, 'due_on', m.due_on)
           order by m.o), '[]'::jsonb)
    into v_ms
    from (select m0.*, row_number() over (order by m0.due_on, m0.id) as o
            from public.general_milestones m0
           where m0.project_id = p_project and m0.reached_at is null and m0.due_on is not null) m;

  return jsonb_build_object(
    'blocked', null,
    'project', v_project,
    'length_days', v_len,
    'suggested_length_days', v_suggest,
    'window', jsonb_build_object('from', v_from, 'to', v_to),
    'running', v_running,
    'stages', v_stages,
    'tasks', v_tasks,
    'milestones', v_ms,
    'total_minutes', v_total,
    'unestimated', (select count(*) from pg_temp.stage_plan_rows where minutes is null),
    'planning_count', (select count(*) from public.general_tasks t
                        where t.project_id = p_project and t.parent_id is null
                          and t.archived_at is null and t.trashed_at is null and t.status <> 'done'
                          and t.routing_state = 'planning'
                          and (v_org <> 'streams' or t.team_id = p_team)),
    'left_out', v_left,
    'outside_count', (select count(*) from public.general_tasks t
                       join public.stage_plan_planned(p_project, p_team) g on g.id = t.sprint_id
                      where t.parent_id is null and t.archived_at is null and t.trashed_at is null
                        and not exists (select 1 from pg_temp.stage_plan_rows q where q.id = t.id)),
    'shown', public.stage_plan_shown(p_project, p_team));
end;
$$;

revoke all on function public.general_stage_plan_context(uuid, uuid, int) from public, anon;
grant execute on function public.general_stage_plan_context(uuid, uuid, int) to authenticated;

------------------------------------------------------------------ apply

-- Writes a reviewed plan in one transaction. Security definer with the
-- planner check above; the task and stage triggers still see the caller
-- (auth.uid()), so their rules, milestone tagging and history apply.
create or replace function public.apply_stage_plan(
  p_project uuid, p_team uuid, p_stages jsonb, p_tasks jsonb, p_shown text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  gp        public.general_projects;
  v_org     text;
  v_n       int;
  v_ids     uuid[] := '{}';
  v_prev    date;
  v_created int := 0;
  v_updated int := 0;
  v_deleted int := 0;
  v_moved   int := 0;
  v_id      uuid;
  v_stage   int;
  v_s       date;
  v_e       date;
  x         jsonb;
  i         int;
begin
  gp := public.stage_plan_guard(p_project);
  v_org := public.stage_plan_org(p_project);
  if v_org = 'streams' and not public.stage_plan_team_ok(p_project, p_team) then
    raise exception 'Choose a team to plan its stages.' using errcode = 'invalid_parameter_value';
  end if;

  perform 1 from public.general_sprints where project_id = p_project for update;
  if p_shown is null or public.stage_plan_shown(p_project, p_team) is distinct from p_shown then
    raise exception 'Something changed while you were reviewing. Suggest again to see the latest.'
      using errcode = 'serialization_failure';
  end if;

  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) not between 1 and 52 then
    raise exception 'A plan needs at least one stage.' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' then
    raise exception 'The plan''s tasks could not be read.' using errcode = 'invalid_parameter_value';
  end if;
  v_n := jsonb_array_length(p_stages);

  -- Check every stage before writing anything.
  for i in 0 .. v_n - 1 loop
    x := p_stages -> i;
    if char_length(btrim(coalesce(x ->> 'name', ''))) not between 1 and 60 then
      raise exception 'A stage name needs 1 to 60 characters.' using errcode = 'invalid_parameter_value';
    end if;
    if char_length(coalesce(x ->> 'goal', '')) > 200 then
      raise exception 'A stage goal can be up to 200 characters.' using errcode = 'invalid_parameter_value';
    end if;
    v_s := (x ->> 'starts_on')::date;
    v_e := (x ->> 'ends_on')::date;
    if v_s is null or v_e is null or v_e < v_s then
      raise exception 'Each stage needs a start on or before its end.' using errcode = 'invalid_parameter_value';
    end if;
    if i = 0 and v_s <= public.work_today() then
      raise exception 'The first stage has to start after today.' using errcode = 'invalid_parameter_value';
    end if;
    if v_prev is not null and v_s <= v_prev then
      raise exception 'Stages can''t overlap. Suggest again to get new dates.' using errcode = 'invalid_parameter_value';
    end if;
    v_prev := v_e;
    if x ->> 'id' is not null then
      v_id := (x ->> 'id')::uuid;
      if v_id = any(v_ids) or not exists (select 1 from public.stage_plan_planned(p_project, p_team) g where g.id = v_id) then
        raise exception 'That stage is not a planned stage of this project.' using errcode = 'invalid_parameter_value';
      end if;
      v_ids := v_ids || v_id;
    end if;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    if not exists (select 1 from public.stage_plan_tasks(p_project, p_team) t where t.id = (x ->> 'id')::uuid) then
      raise exception 'A task in the plan is not in this plan''s tasks. Suggest again to see the latest.'
        using errcode = 'invalid_parameter_value';
    end if;
    if x ->> 'stage' is not null and ((x ->> 'stage')::int < 0 or (x ->> 'stage')::int >= v_n) then
      raise exception 'A task points at a stage that is not in the plan.' using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- 1. Reused stages, 2. new ones.
  v_ids := '{}';
  for i in 0 .. v_n - 1 loop
    x := p_stages -> i;
    if x ->> 'id' is not null then
      v_id := (x ->> 'id')::uuid;
      update public.general_sprints g
         set name = btrim(x ->> 'name'), goal = coalesce(x ->> 'goal', ''),
             starts_on = (x ->> 'starts_on')::date, ends_on = (x ->> 'ends_on')::date,
             milestone_id = case when g.milestone_id is not null and exists (
                                    select 1 from public.general_milestones m
                                     where m.id = g.milestone_id and m.due_on < (x ->> 'ends_on')::date)
                                 then null else g.milestone_id end
       where g.id = v_id;
      v_updated := v_updated + 1;
    else
      insert into public.general_sprints(project_id, name, goal, starts_on, ends_on, team_id)
        values (p_project, btrim(x ->> 'name'), coalesce(x ->> 'goal', ''),
                (x ->> 'starts_on')::date, (x ->> 'ends_on')::date,
                case when v_org = 'streams' then p_team end)
        returning id into v_id;
      v_created := v_created + 1;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  -- 3. Tasks and their live subtasks; 4. stage dates for undated work.
  for x in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    v_id := (x ->> 'id')::uuid;
    v_stage := (x ->> 'stage')::int;
    update public.general_tasks t
       set sprint_id = case when v_stage is null then null else v_ids[v_stage + 1] end
     where (t.id = v_id
            or (t.parent_id = v_id and t.archived_at is null and t.trashed_at is null and t.status <> 'done'
                and (t.sprint_id is null or exists (
                      select 1 from public.general_sprints g where g.id = t.sprint_id and g.state = 'planned'))))
       and t.sprint_id is distinct from case when v_stage is null then null else v_ids[v_stage + 1] end;
    v_moved := v_moved + 1;
    if v_stage is not null then
      v_s := (p_stages -> v_stage ->> 'starts_on')::date;
      v_e := (p_stages -> v_stage ->> 'ends_on')::date;
      update public.general_tasks t
         set starts_at = coalesce(t.starts_at, (v_s + time '09:00') at time zone 'Asia/Manila'),
             due_at = (v_e + time '23:59') at time zone 'Asia/Manila'
       where t.due_at is null and t.status <> 'done'
         and t.archived_at is null and t.trashed_at is null
         and (t.starts_at is null or (t.starts_at at time zone 'Asia/Manila')::date <= v_e)
         and (
           (t.id = v_id and not exists (
              select 1 from public.general_tasks st
               where st.parent_id = v_id and st.archived_at is null and st.trashed_at is null))
           or t.parent_id = v_id);
    end if;
  end loop;

  -- 5. Planned stages the plan no longer names.
  delete from public.general_sprints g
   where g.id in (select pl.id from public.stage_plan_planned(p_project, p_team) pl)
     and not (g.id = any(v_ids));
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'deleted', v_deleted, 'moved', v_moved);
end;
$$;

revoke all on function public.apply_stage_plan(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.apply_stage_plan(uuid, uuid, jsonb, jsonb, text) to authenticated;
