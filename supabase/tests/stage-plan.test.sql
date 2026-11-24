-- supabase/tests/stage-plan.test.sql
-- Suggest stages: the context a planner reads (window, slots, team hours,
-- tasks, the fingerprint), and apply_stage_plan, which writes a reviewed plan
-- in one go or refuses a stale one. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/stage-plan.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create or replace function pg_temp.refuse(p_label text, p_sql text, p_needle text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS %', p_label;
      return;
    end if;
    raise exception 'FAIL % (refused for another reason: %)', p_label, sqlerrm;
  end;
  raise exception 'FAIL % (not refused)', p_label;
end $$;

create or replace function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;

-- The context's stages as apply_stage_plan input, named "Zz n".
create or replace function pg_temp.stages_of(ctx jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s -> 'id', 'name', 'Zz ' || (o)::text, 'goal', 'Goal ' || (o)::text,
           'starts_on', s -> 'starts_on', 'ends_on', s -> 'ends_on') order by o), '[]'::jsonb)
    from jsonb_array_elements(ctx -> 'stages') with ordinality as x(s, o)
$$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  -- 1 pm, 2 coordinator, 3 member, 4 stakeholder, 5 outsider
  s uuid; p uuid; p2 uuid; p3 uuid; team uuid;
  t_big uuid; t_dep uuid; t_ms uuid; t_due uuid; t_sub uuid; t_none uuid; t_plan uuid; t_run uuid;
  sub_a uuid; sub_b uuid; run uuid; old1 uuid; old2 uuid; ms uuid; other uuid;
  ctx jsonb; ctx2 jsonb; stg jsonb; tasks jsonb; res jsonb; cap1 int; e date; n int;
  today date := (now() at time zone 'Asia/Manila')::date;
  wt date := public.work_today();
  key_of jsonb;
  fin uuid; t_fin uuid; sub_open uuid; sub_done uuid; t_late uuid; t_old uuid; sh text;
begin
  for k in 1..5 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-stageplan-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-stageplan-'||k||'@example.test', 'Stage', k::text, 'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz stageplan space', '')).id;
  p := (public.create_general_project('Zz stageplan', 'A test', today - 7, today + 60, null, null, s)).id;
  p2 := (public.create_general_project('Zz stageplan streams', '', today - 7, today + 60, null, null, s)).id;
  p3 := (public.create_general_project('Zz stageplan open end', '', today - 7, null, null, null, s)).id;
  perform pg_temp.service();
  -- 20 h a week each, so nobody has 50 free hours in two weeks.
  insert into public.general_space_hours_default(space_id, weekly_minutes) values (s, 1200)
    on conflict (space_id) do update set weekly_minutes = 1200;
  insert into public.general_space_members(space_id, user_id, role) values
    (s, u[2], 'coordinator'), (s, u[3], 'member'), (s, u[4], 'stakeholder');
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'stakeholder'),
    (p2, u[3], 'member');

  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, priority)
    values (p, 'Zz big', 'released', now(), u[1], 3000, 'high') returning id into t_big;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p, 'Zz dep', 'released', now(), u[1], 300) returning id into t_dep;
  insert into public.general_task_dependencies(task_id, depends_on_id, project_id) values (t_dep, t_big, p);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p, 'Zz milestone work', 'released', now(), u[1], 240) returning id into t_ms;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, due_at)
    values (p, 'Zz due soon', 'released', now(), u[1], 120, pg_temp.at(today + 6, '17:00')) returning id into t_due;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz with parts', 'released', now(), u[1]) returning id into t_sub;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p, t_sub, 'Zz part undated', 'released', now(), u[1], 180) returning id into sub_a;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, estimated_minutes, starts_at, due_at)
    values (p, t_sub, 'Zz part dated', 'released', now(), u[1], 180, pg_temp.at(today + 2, '09:00'), pg_temp.at(today + 3, '17:00'))
    returning id into sub_b;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p, 'Zz no estimate', 'released', now(), u[1]) returning id into t_none;
  insert into public.general_tasks(project_id, title, routing_state, created_by, estimated_minutes)
    values (p, 'Zz still planning', 'planning', u[1], 60) returning id into t_plan;

  -- A running stage that ends in three days, with one task; two planned stages.
  insert into public.general_sprints(project_id, name, starts_on, ends_on)
    values (p, 'Zz running', today - 7, today + 3) returning id into run;
  update public.general_sprints set state = 'active' where id = run;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, sprint_id)
    values (p, 'Zz running work', 'released', now(), u[1], 60, run) returning id into t_run;
  insert into public.general_sprints(project_id, name, starts_on, ends_on)
    values (p, 'Zz old one', today + 10, today + 20) returning id into old1;
  insert into public.general_sprints(project_id, name, starts_on, ends_on)
    values (p, 'Zz old two', today + 21, today + 30) returning id into old2;
  update public.general_tasks set sprint_id = old2 where id = t_ms;

  -- The API runs with pg_safeupdate, which refuses a DELETE with no WHERE.
  perform pg_temp.check('no delete without a where',
    not exists (select 1 from pg_proc
                 where pronamespace = 'public'::regnamespace
                   and (proname like 'stage_plan%' or proname in ('general_stage_plan_context', 'apply_stage_plan'))
                   and prosrc ~* 'delete\s+from\s+\S+\s*;'));

  -- A serialization_failure makes the API retry the call over and over; a stale plan is a plain refusal.
  perform pg_temp.check('the stale refusal is not retried',
    not exists (select 1 from pg_proc
                 where pronamespace = 'public'::regnamespace and proname = 'apply_stage_plan'
                   and prosrc ilike '%serialization_failure%'));

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(u[1]);
  ctx := public.general_stage_plan_context(p);
  perform pg_temp.check('planner reads the context',
    ctx ->> 'blocked' is null and jsonb_array_length(ctx -> 'stages') >= 2);
  perform pg_temp.check('the last stage is the buffer',
    (ctx -> 'stages' -> -1 ->> 'buffer')::boolean
    and not (ctx -> 'stages' -> 0 ->> 'buffer')::boolean);
  perform pg_temp.check('stages are back to back',
    not exists (select 1 from jsonb_array_elements(ctx -> 'stages') with ordinality a(x, i)
                  join jsonb_array_elements(ctx -> 'stages') with ordinality b(y, j) on j = i + 1
                 where (y ->> 'starts_on')::date <> (x ->> 'ends_on')::date + 1));
  perform pg_temp.check('the first stage starts after today and after the running stage',
    (ctx -> 'stages' -> 0 ->> 'starts_on')::date > wt
    and (ctx -> 'stages' -> 0 ->> 'starts_on')::date > today + 3);
  perform pg_temp.check('the last stage ends on the project end',
    (ctx -> 'stages' -> -1 ->> 'ends_on')::date = today + 60);
  perform pg_temp.check('planned stages are reused in order',
    ctx -> 'stages' -> 0 ->> 'id' = old1::text and ctx -> 'stages' -> 1 ->> 'id' = old2::text);
  perform pg_temp.check('the running stage is listed',
    ctx -> 'running' -> 0 ->> 'id' = run::text and (ctx -> 'running' -> 0 ->> 'task_count')::int = 1);

  perform pg_temp.act_as(u[2]);
  perform pg_temp.check('a coordinator reads it too', public.general_stage_plan_context(p) ->> 'blocked' is null);
  for k in 3..5 loop
    perform pg_temp.act_as(u[k]);
    perform pg_temp.refuse('others are refused ' || k,
      format('select public.general_stage_plan_context(%L)', p), 'Only the project manager and coordinators');
  end loop;

  perform pg_temp.act_as(u[1]);
  cap1 := (ctx -> 'stages' -> 0 ->> 'capacity_minutes')::int;
  perform pg_temp.service();
  insert into public.general_space_capacity(space_id, user_id, weekly_minutes) values (s, u[4], 2400)
    on conflict (space_id, user_id) do update set weekly_minutes = 2400;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('a stakeholder''s hours never count',
    (public.general_stage_plan_context(p) -> 'stages' -> 0 ->> 'capacity_minutes')::int = cap1 and cap1 > 0);

  select jsonb_object_agg(t ->> 'id', t) into key_of from jsonb_array_elements(ctx -> 'tasks') t;
  perform pg_temp.check('a parent counts its subtasks',
    (key_of -> t_sub::text ->> 'minutes')::int = 360 and (key_of -> t_sub::text ->> 'subtasks')::int = 2);
  perform pg_temp.check('an unestimated task is counted apart',
    key_of -> t_none::text -> 'minutes' = 'null'::jsonb and (ctx ->> 'unestimated')::int = 1);
  perform pg_temp.check('a planning task is left out and counted',
    not key_of ? t_plan::text and (ctx ->> 'planning_count')::int = 1);
  perform pg_temp.check('the running stage keeps its task', not key_of ? t_run::text and not key_of ? sub_a::text);
  perform pg_temp.check('a task in a planned stage is planned', key_of ? t_ms::text);
  perform pg_temp.check('dependencies are listed', key_of -> t_dep::text -> 'depends_on' = jsonb_build_array(t_big));
  perform pg_temp.check('due day and dated',
    (key_of -> t_due::text ->> 'due_on')::date = today + 6 and (key_of -> t_due::text ->> 'dated')::boolean
    and not (key_of -> t_big::text ->> 'dated')::boolean);
  perform pg_temp.check('keys run t1, t2…',
    (select bool_and(t ->> 'key' = 't' || i) from jsonb_array_elements(ctx -> 'tasks') with ordinality x(t, i)));

  perform pg_temp.check('length follows the biggest task', (ctx ->> 'suggested_length_days')::int >= 21);
  ctx2 := public.general_stage_plan_context(p, null, 7);
  perform pg_temp.check('a chosen length is used',
    (ctx2 ->> 'length_days')::int = 7
    and (ctx2 -> 'stages' -> 0 ->> 'ends_on')::date = (ctx2 -> 'stages' -> 0 ->> 'starts_on')::date + 6);
  -- 57 days in 2-week stages leaves 1 day over; it joins the last stage instead of becoming one.
  perform pg_temp.check('a short remainder joins the last stage',
    (select ((x ->> 'ends_on')::date - (x ->> 'starts_on')::date + 1) >= 7
       from jsonb_array_elements(public.general_stage_plan_context(p, null, 14) -> 'stages') with ordinality a(x, o)
      order by o desc limit 1));
  perform pg_temp.check('an odd length falls back',
    (public.general_stage_plan_context(p, null, 10) ->> 'length_days')::int = (ctx ->> 'suggested_length_days')::int);

  -- A milestone two days before a stage end pulls that end onto it.
  e := (ctx2 -> 'stages' -> 1 ->> 'ends_on')::date;
  perform pg_temp.service();
  insert into public.general_milestones(project_id, name, due_on) values (p, 'Zz beta', e - 2) returning id into ms;
  update public.general_tasks set milestone_id = ms where id = t_ms;
  perform pg_temp.act_as(u[1]);
  ctx2 := public.general_stage_plan_context(p, null, 7);
  perform pg_temp.check('milestone snap',
    exists (select 1 from jsonb_array_elements(ctx2 -> 'stages') x where (x ->> 'ends_on')::date = e - 2)
    and ctx2 -> 'milestones' -> 0 ->> 'key' = 'm1');

  -- A reused stage that would end after its milestone loses the link.
  perform pg_temp.service();
  update public.general_sprints set milestone_id = ms where id = old1;
  perform pg_temp.act_as(u[1]);
  ctx2 := public.general_stage_plan_context(p, null, 28);
  perform pg_temp.check('a lost milestone link is named',
    (ctx2 -> 'stages' -> 0 ->> 'ends_on')::date > e - 2
      and ctx2 -> 'stages' -> 0 ->> 'milestone_lost' = 'Zz beta'
      and ctx2 -> 'stages' -> 0 -> 'milestone_id' = 'null'::jsonb);
  perform pg_temp.service();
  update public.general_sprints set milestone_id = null where id = old1;

  -- No end date and no hours: one stage and the buffer.
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by)
    values (p3, 'Zz open', 'released', now(), u[1]);
  perform pg_temp.act_as(u[1]);
  ctx2 := public.general_stage_plan_context(p3);
  perform pg_temp.check('no end date and no hours',
    jsonb_array_length(ctx2 -> 'stages') = 2 and ctx2 -> 'window' -> 'to' = 'null'::jsonb
    and (ctx2 -> 'stages' -> 1 ->> 'buffer')::boolean);

  -- Streams: a team first; then only that team's work and people.
  perform pg_temp.service();
  insert into public.general_sprint_settings(project_id, organization) values (p2, 'streams')
    on conflict (project_id) do update set organization = 'streams';
  insert into public.general_teams(project_id, name) values (p2, 'Zz team') returning id into team;
  insert into public.general_team_members(team_id, project_id, user_id) values (team, p2, u[3]);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, team_id)
    values (p2, 'Zz team work', 'released', now(), u[1], 60, team);
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p2, 'Zz no team', 'released', now(), u[1], 60) returning id into other;
  perform pg_temp.act_as(u[1]);
  ctx2 := public.general_stage_plan_context(p2);
  perform pg_temp.check('streams needs a team',
    ctx2 ->> 'blocked' = 'Choose a team to plan its stages.' and jsonb_array_length(ctx2 -> 'stages') = 0);
  ctx2 := public.general_stage_plan_context(p2, team);
  perform pg_temp.check('a team plan holds that team''s tasks',
    jsonb_array_length(ctx2 -> 'tasks') = 1 and ctx2 -> 'tasks' -> 0 ->> 'title' = 'Zz team work');
  perform pg_temp.service();
  perform pg_temp.check('a team plan counts that team''s people',
    (ctx2 -> 'stages' -> 0 ->> 'capacity_minutes')::int
      = (select available_minutes from public.work_person_hours(s, u[3],
           (ctx2 -> 'stages' -> 0 ->> 'starts_on')::date, (ctx2 -> 'stages' -> 0 ->> 'ends_on')::date)));

  ------------------------------------------------------------------ applying
  perform pg_temp.act_as(u[1]);
  ctx := public.general_stage_plan_context(p);
  stg := pg_temp.stages_of(ctx);
  -- The second stage is new, so the second planned stage is dropped.
  stg := jsonb_set(stg, '{1,id}', 'null'::jsonb);
  select jsonb_agg(jsonb_build_object('id', t ->> 'id', 'stage',
           case when t ->> 'id' = t_dep::text then to_jsonb(1)
                when t ->> 'id' = t_none::text then 'null'::jsonb
                else to_jsonb(0) end))
    into tasks from jsonb_array_elements(ctx -> 'tasks') t;
  n := jsonb_array_length(stg);
  res := public.apply_stage_plan(p, null, stg, tasks, ctx ->> 'shown');
  perform pg_temp.check('apply reports what it did',
    (res ->> 'updated')::int = 1 and (res ->> 'created')::int = n - 1 and (res ->> 'deleted')::int = 1);
  perform pg_temp.check('stages carry their names and dates',
    (select name = 'Zz 1' and goal = 'Goal 1' and starts_on = (ctx -> 'stages' -> 0 ->> 'starts_on')::date
       from public.general_sprints where id = old1));
  perform pg_temp.check('a reused planned stage kept its id', exists (select 1 from public.general_sprints where id = old1));
  perform pg_temp.check('dropped planned stage is deleted', not exists (select 1 from public.general_sprints where id = old2));
  perform pg_temp.check('the running stage is untouched',
    (select state = 'active' and name = 'Zz running' from public.general_sprints where id = run)
    and (select sprint_id = run from public.general_tasks where id = t_run));
  perform pg_temp.check('tasks moved',
    (select sprint_id = old1 from public.general_tasks where id = t_big)
    and (select s2.name = 'Zz 2' from public.general_tasks t join public.general_sprints s2 on s2.id = t.sprint_id where t.id = t_dep)
    and (select sprint_id is null from public.general_tasks where id = t_none));
  perform pg_temp.check('an undated task got its stage''s dates',
    (select starts_at = pg_temp.at((ctx -> 'stages' -> 0 ->> 'starts_on')::date, '09:00')
            and due_at = pg_temp.at((ctx -> 'stages' -> 0 ->> 'ends_on')::date, '23:59')
       from public.general_tasks where id = t_big));
  perform pg_temp.check('a dated task kept its dates',
    (select due_at = pg_temp.at(today + 6, '17:00') from public.general_tasks where id = t_due));
  perform pg_temp.check('apply dates undated subtasks only',
    (select due_at = pg_temp.at((ctx -> 'stages' -> 0 ->> 'ends_on')::date, '23:59') and sprint_id = old1
       from public.general_tasks where id = sub_a)
    and (select due_at = pg_temp.at(today + 3, '17:00') and sprint_id = old1 from public.general_tasks where id = sub_b)
    and (select due_at = pg_temp.at((ctx -> 'stages' -> 0 ->> 'ends_on')::date, '23:59')
           from public.general_tasks where id = t_sub));

  -- Stale: an estimate changes after the review was read.
  ctx := public.general_stage_plan_context(p);
  perform pg_temp.service();
  update public.general_tasks set estimated_minutes = 500 where id = t_dep;
  perform pg_temp.act_as(u[1]);
  n := (select count(*) from public.general_sprints where project_id = p);
  perform pg_temp.refuse('stale',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p, pg_temp.stages_of(ctx), '[]', ctx ->> 'shown'),
    'Something changed while you were reviewing. Suggest again to see the latest.');
  perform pg_temp.check('a stale apply writes nothing', (select count(*) from public.general_sprints where project_id = p) = n);

  ctx := public.general_stage_plan_context(p);
  stg := pg_temp.stages_of(ctx);
  perform pg_temp.refuse('overlapping dates',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p,
      jsonb_set(stg, '{1,starts_on}', stg -> 0 -> 'ends_on'), '[]', ctx ->> 'shown'), 'overlap');
  perform pg_temp.refuse('a stage from elsewhere',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p,
      jsonb_set(stg, '{0,id}', to_jsonb(run)), '[]', ctx ->> 'shown'), 'not a planned stage of this project');
  perform pg_temp.refuse('a long name',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p,
      jsonb_set(stg, '{0,name}', to_jsonb(repeat('x', 61))), '[]', ctx ->> 'shown'), '60 characters');
  perform pg_temp.refuse('a task outside the plan',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p, stg,
      jsonb_build_array(jsonb_build_object('id', t_plan, 'stage', 0)), ctx ->> 'shown'), 'not in this plan');
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('a member cannot apply',
    format('select public.apply_stage_plan(%L, null, %L, %L, %L)', p, stg, '[]', ctx ->> 'shown'),
    'Only the project manager and coordinators');

  ------------------------------------------------------------------ review fixes
  -- A done subtask stays in its finished stage when its parent is planned again.
  perform pg_temp.service();
  insert into public.general_sprints(project_id, name, starts_on, ends_on)
    values (p3, 'Zz finished', today - 20, today - 6) returning id into fin;
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p3, 'Zz carried parent', 'released', now(), u[1], 60) returning id into t_fin;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, estimated_minutes)
    values (p3, t_fin, 'Zz open part', 'released', now(), u[1], 60) returning id into sub_open;
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, estimated_minutes, sprint_id)
    values (p3, t_fin, 'Zz done part', 'released', now(), u[1], 60, fin) returning id into sub_done;
  update public.general_tasks set status = 'done' where id = sub_done;
  update public.general_sprints set state = 'active' where id = fin;
  update public.general_sprints set state = 'completed' where id = fin;
  -- An undated task that starts after the first stage ends keeps no due date rather than failing.
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, estimated_minutes, starts_at)
    values (p3, 'Zz starts late', 'released', now(), u[1], 60, pg_temp.at(today + 400, '09:00')) returning id into t_late;
  perform pg_temp.act_as(u[1]);
  ctx := public.general_stage_plan_context(p3);
  select jsonb_agg(jsonb_build_object('id', t ->> 'id', 'stage', 0)) into tasks from jsonb_array_elements(ctx -> 'tasks') t;
  perform public.apply_stage_plan(p3, null, pg_temp.stages_of(ctx), tasks, ctx ->> 'shown');
  perform pg_temp.check('a done subtask stays in its finished stage',
    (select sprint_id = fin from public.general_tasks where id = sub_done)
    and (select sprint_id is not null and sprint_id <> fin from public.general_tasks where id = sub_open));
  perform pg_temp.check('a task starting after its stage ends keeps no due date',
    (select due_at is null and sprint_id is not null from public.general_tasks where id = t_late));

  -- Tasks in planned stages that the plan leaves out are counted for the review.
  perform pg_temp.service();
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, sprint_id)
    values (p, 'Zz done in a planned stage', 'released', now(), u[1], old1) returning id into t_old;
  update public.general_tasks set status = 'done' where id = t_old;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('tasks outside the plan are counted',
    (public.general_stage_plan_context(p) ->> 'outside_count')::int = 1);

  -- Apply checks the team as the context does.
  perform pg_temp.service();
  update public.general_tasks set status = 'done' where project_id = p2 and team_id = team;
  perform pg_temp.act_as(u[1]);
  update public.general_teams set archived_at = now() where id = team;
  perform pg_temp.service();
  sh := public.stage_plan_shown(p2, team);
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('an archived team is not planned',
    public.general_stage_plan_context(p2, team) ->> 'blocked' = 'Choose a team to plan its stages.');
  ctx := public.general_stage_plan_context(p);
  perform pg_temp.refuse('apply refuses an archived team',
    format('select public.apply_stage_plan(%L, %L, %L, %L, %L)', p2, team,
      '[{"id":null,"name":"Zz","goal":"","starts_on":"2099-01-01","ends_on":"2099-01-10"}]', '[]',
      sh), 'Choose a team to plan its stages.');
  perform pg_temp.service();
end $$;

rollback;
