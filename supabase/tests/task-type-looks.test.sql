-- supabase/tests/task-type-looks.test.sql
-- Task type sets: their shape, who writes them, renames, counts. Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/task-type-looks.sql supabase/anon-lockdown.sql
--   node scripts/db.mjs supabase/tests/task-type-looks.test.sql
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
    raise exception 'FAIL %: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL %: allowed', p_label;
end $$;

-- One entry of a set.
create or replace function pg_temp.e(p_slot text, p_name text, p_color text default '#0891b2',
  p_icon text default 'tag', p_description text default '') returns jsonb language sql as $$
  select jsonb_build_object('slot', p_slot, 'name', p_name, 'description', p_description,
    'color', p_color, 'icon', p_icon)
$$;

create or replace function pg_temp.work(variadic p_more jsonb[] default '{}') returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.e('default', 'Task', '#2563eb', 'square-check'),
    pg_temp.e('bug', 'Bug', '#dc2626', 'bug')) || coalesce((select jsonb_agg(x) from unnest(p_more) x), '[]'::jsonb)
$$;

create or replace function pg_temp.problem(p_set jsonb, p_family text default 'work') returns text language sql as $$
  select public.task_type_set_problem(p_set, p_family)
$$;

-- ------------------------------------------------------------ part 1: shape, guard, backfill
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  p uuid;
  p2 uuid;
  c uuid; prof uuid; cp uuid;
  many jsonb := '[]';
  work_default jsonb := pg_temp.work();
begin
  for i in 1..2 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-type-look-' || i || '@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_manage_projects)
      values(u[i], 'zz-type-look-' || i || '@example.test', 'Look', i::text, 'member', 'active', true);
  end loop;

  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz type looks', '')).id;
  perform pg_temp.service();

  perform pg_temp.check('new work project gets Task and Bug',
    (select task_type_set = jsonb_build_array(
       jsonb_build_object('slot', 'default', 'name', 'Task', 'description', 'Standard actionable work.',
         'color', '#2563eb', 'icon', 'square-check'),
       jsonb_build_object('slot', 'bug', 'name', 'Bug', 'description', 'Errors, defects, and issues requiring fixes.',
         'color', '#dc2626', 'icon', 'bug'))
     from public.general_projects where id = p));
  perform pg_temp.check('shown is the md5 of the set',
    (select task_type_set_shown = md5(task_type_set::text) from public.general_projects where id = p));
  perform pg_temp.check('no preset yet',
    (select task_type_preset is null from public.general_projects where id = p));
  perform pg_temp.check('class-board Files projects carry a valid work set',
    not exists (select 1 from public.general_projects
      where class_board_id is not null and public.task_type_set_problem(task_type_set, 'work') is not null));
  perform pg_temp.check('68 icon keys',
    cardinality(public.task_type_icon_keys()) = 68 and 'tag' = any(public.task_type_icon_keys()));

  -- The validator.
  perform pg_temp.check('a default set is valid', pg_temp.problem(work_default) is null);
  perform pg_temp.check('two defaults',
    pg_temp.problem(work_default || jsonb_build_array(pg_temp.e('default', 'Other'))) = 'Keep one default type.');
  perform pg_temp.check('no default',
    pg_temp.problem(jsonb_build_array(pg_temp.e('bug', 'Bug'))) = 'Keep one default type.');
  perform pg_temp.check('work without bug',
    pg_temp.problem(jsonb_build_array(pg_temp.e('default', 'Task'))) = 'Keep one bug type.');
  perform pg_temp.check('class with bug',
    pg_temp.problem(work_default, 'class') = 'Class projects have no bug type.');
  perform pg_temp.check('class default only is valid',
    pg_temp.problem(jsonb_build_array(pg_temp.e('default', 'Task')), 'class') is null);
  for i in 1..21 loop
    many := many || jsonb_build_array(pg_temp.e(null, 'Type ' || i));
  end loop;
  perform pg_temp.check('21 customs', pg_temp.problem(work_default || many) = 'Keep at most 20 custom task types.');
  perform pg_temp.check('20 customs pass', pg_temp.problem(work_default || (many - 20)) is null);
  perform pg_temp.check('case-insensitive duplicate',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'epic'), pg_temp.e(null, 'Epic')))
      = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.');
  perform pg_temp.check('custom BUG on work',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'BUG')))
      = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.');
  perform pg_temp.check('custom named like a slot',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'task')))
      = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.');
  perform pg_temp.check('custom Task on class',
    pg_temp.problem(jsonb_build_array(pg_temp.e('default', 'Research Task'), pg_temp.e(null, 'Task')), 'class')
      = 'Use distinct names of 1 to 40 characters. Task stays reserved for the built-in type.');
  perform pg_temp.check('custom Bug on class is fine',
    pg_temp.problem(jsonb_build_array(pg_temp.e('default', 'Task'), pg_temp.e(null, 'Bug')), 'class') is null);
  perform pg_temp.check('untrimmed name',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, ' Epic')))
      = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.');
  perform pg_temp.check('41-character name',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, repeat('x', 41))))
      = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.');
  perform pg_temp.check('121-character description',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic', '#0891b2', 'tag', repeat('x', 121))))
      = 'Keep each description to 120 characters.');
  perform pg_temp.check('untrimmed description',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic', '#0891b2', 'tag', 'Big ')))
      = 'Keep each description to 120 characters.');
  perform pg_temp.check('upper-case hex',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic', '#DB2777'))) = 'Choose a color as #rrggbb.');
  perform pg_temp.check('named color',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic', 'red'))) = 'Choose a color as #rrggbb.');
  perform pg_temp.check('unknown icon',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic', '#0891b2', 'rocket-ship'))) = 'Choose an icon from the list.');
  perform pg_temp.check('extra key',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic') || '{"was":"Old"}'))
      = 'Each task type needs a slot, name, description, color and icon.');
  perform pg_temp.check('missing key',
    pg_temp.problem(pg_temp.work(pg_temp.e(null, 'Epic') - 'icon'))
      = 'Each task type needs a slot, name, description, color and icon.');
  perform pg_temp.check('unknown slot',
    pg_temp.problem(pg_temp.work(pg_temp.e('epic', 'Epic')))
      = 'Each task type needs a slot, name, description, color and icon.');
  perform pg_temp.check('not an array',
    pg_temp.problem('{}'::jsonb) = 'Each task type needs a slot, name, description, color and icon.');
  perform pg_temp.check('slot named Bug Task passes',
    pg_temp.problem(jsonb_build_array(pg_temp.e('default', 'Task'), pg_temp.e('bug', 'Bug Task'))) is null);

  -- Direct writes.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('pm cannot write the set directly',
    format('update public.general_projects set task_type_set = %L where id = %L',
      pg_temp.work(pg_temp.e(null, 'Epic')), p), 'Change task types in Settings.');
  perform pg_temp.refuse('pm cannot write task_types directly',
    format('update public.general_projects set task_types = array[%L] where id = %L', 'Epic', p),
    'Change task types in Settings.');
  perform pg_temp.refuse('pm cannot write the preset directly',
    format('update public.general_projects set task_type_preset = %L where id = %L', 'software', p),
    'Change task types in Settings.');
  perform pg_temp.refuse('a new project cannot start with its own set',
    format('insert into public.general_projects(name, space_id, task_type_set) values (%L, %L, %L)',
      'Zz sneaky', (select space_id from public.general_projects where id = p),
      pg_temp.work(pg_temp.e(null, 'Epic'))), 'Change task types in Settings.');

  perform pg_temp.service();
  update public.general_projects set task_type_set = pg_temp.work(pg_temp.e(null, 'Epic')),
    task_type_preset = 'software' where id = p;
  perform pg_temp.check('service role writes the set',
    (select task_type_set -> 2 ->> 'name' = 'Epic' and task_type_preset = 'software'
       from public.general_projects where id = p));
  perform pg_temp.refuse('even the service role cannot store an invalid set',
    format('update public.general_projects set task_type_set = %L where id = %L', '[]', p),
    'Keep one default type.');
  perform pg_temp.refuse('preset keys are slugs',
    format('update public.general_projects set task_type_preset = %L where id = %L', 'Not a key', p),
    'Choose a preset from the list.');

  -- Class projects.
  select cl.id, cl.professor_id into c, prof from public.classes cl order by cl.created_at limit 1;
  perform pg_temp.check('class fixture available', c is not null);
  insert into public.projects(class_id, created_by, title, type, start_week, end_week, audience)
    values(c, prof, 'zz-type-looks', 'activity', 1, 2, 'individual') returning id into cp;
  perform pg_temp.check('new class project gets Task only',
    (select task_type_set = jsonb_build_array(jsonb_build_object('slot', 'default', 'name', 'Task',
       'description', 'Standard actionable work.', 'color', '#2563eb', 'icon', 'square-check'))
     from public.projects where id = cp));
  perform pg_temp.act_as(prof);
  perform pg_temp.refuse('professor cannot write class task_types directly',
    format('update public.projects set task_types = array[%L] where id = %L', 'Review', cp),
    'Change task types in Settings.');
  perform pg_temp.service();

  -- The backfill: names in task_types that the set lacks join it, once.
  perform pg_temp.act_as(u[1]);
  p2 := (public.create_general_project('Zz backfill', '')).id;
  perform pg_temp.service();
  perform set_config('collabify.task_type_save', 'on', true);
  update public.general_projects set task_types = array['Epic', 'Feature'] where id = p2;
  update public.projects set task_types = array['Review'] where id = cp;
  perform set_config('collabify.task_type_save', 'off', true);
  perform public.backfill_task_type_sets();
  perform pg_temp.check('backfill appends missing names',
    (select task_type_set = public.default_task_type_set('work')
         || jsonb_build_array(pg_temp.e(null, 'Epic', '#0891b2'), pg_temp.e(null, 'Feature', '#9333ea'))
       from public.general_projects where id = p2));
  perform pg_temp.check('backfill covers class projects',
    (select task_type_set -> 1 = pg_temp.e(null, 'Review', '#0891b2') from public.projects where id = cp));
  perform public.backfill_task_type_sets();
  perform pg_temp.check('a second backfill changes nothing',
    (select jsonb_array_length(task_type_set) = 4 from public.general_projects where id = p2));
end $$;

-- ------------------------------------------------------------ part 2: saving, renames, counts
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
    gen_random_uuid(), gen_random_uuid()];  -- pm, coordinator, member, qa, stakeholder, outsider
  p uuid; arch uuid;
  shown text;
  t_epic1 uuid; t_epic2 uuid; t_epic_trash uuid; t_feat uuid; t_plain uuid; t_bug uuid;
  stamp timestamptz;
  events_before int; notes_before int;
  c uuid; prof uuid; student uuid; student2 uuid; gs uuid; g1 uuid; g2 uuid; cp uuid; b1 uuid; b2 uuid;
  ct1 uuid; ct2 uuid;
  base jsonb;
begin
  for i in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-type-save-' || i || '@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_manage_projects)
      values(u[i], 'zz-type-save-' || i || '@example.test', 'Save', i::text, 'member', 'active', i = 1);
  end loop;
  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz type saves', '')).id;
  arch := (public.create_general_project('Zz archived types', '')).id;
  perform pg_temp.service();
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'qa'), (p, u[5], 'stakeholder');

  -- The pm saves a set with new types and a preset key.
  perform pg_temp.act_as(u[1]);
  select task_type_set_shown into shown from public.general_projects where id = p;
  perform public.save_general_task_types(p,
    pg_temp.work(pg_temp.e(null, 'Epic', '#db2777', 'zap'), pg_temp.e(null, 'Feature', '#9333ea', 'layers')),
    shown, 'software');
  perform pg_temp.check('pm saves the set, the names and the preset',
    (select task_type_set = pg_temp.work(pg_temp.e(null, 'Epic', '#db2777', 'zap'), pg_temp.e(null, 'Feature', '#9333ea', 'layers'))
        and task_types = array['Epic', 'Feature'] and task_type_preset = 'software'
       from public.general_projects where id = p));

  -- Others are refused.
  for i in 2..6 loop
    perform pg_temp.act_as(u[i]);
    perform pg_temp.refuse('role ' || i || ' cannot save',
      format('select public.save_general_task_types(%L, %L, %L)', p, pg_temp.work(),
        (select task_type_set_shown from public.general_projects where id = p)),
      'Only the project manager changes task types.');
  end loop;
  perform pg_temp.service();
  update public.general_projects set archived_at = now() where id = arch;
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('archived project refused',
    format('select public.save_general_task_types(%L, %L, %L)', arch, pg_temp.work(),
      (select task_type_set_shown from public.general_projects where id = arch)),
    'Restore the project before changing task types.');
  perform pg_temp.refuse('a stale save is refused',
    format('select public.save_general_task_types(%L, %L, %L)', p, pg_temp.work(), md5('old')),
    'Someone changed these task types. Reload to see them.');
  begin
    perform public.save_general_task_types(p, pg_temp.work(), md5('old'));
  exception when others then
    perform pg_temp.check('stale errcode is 55000', sqlstate = '55000');
  end;
  perform pg_temp.check('a stale save changes nothing',
    (select task_types = array['Epic', 'Feature'] from public.general_projects where id = p));
  perform pg_temp.refuse('an invalid set is refused',
    format('select public.save_general_task_types(%L, %L, %L)', p, '[]',
      (select task_type_set_shown from public.general_projects where id = p)),
    'Keep one default type.');

  -- Tasks to rename.
  insert into public.general_tasks(project_id, title, task_type) values (p, 'Zz epic 1', 'Epic') returning id into t_epic1;
  insert into public.general_tasks(project_id, title, task_type) values (p, 'Zz epic 2', 'Epic') returning id into t_epic2;
  insert into public.general_tasks(project_id, title, task_type) values (p, 'Zz epic 3', 'Epic') returning id into t_epic_trash;
  insert into public.general_tasks(project_id, title, task_type) values (p, 'Zz feature', 'Feature') returning id into t_feat;
  insert into public.general_tasks(project_id, title) values (p, 'Zz plain') returning id into t_plain;
  perform pg_temp.service();
  update public.general_tasks set archived_at = now(), trashed_at = now() where id = t_epic_trash;
  insert into public.general_tasks(project_id, title, kind) values (p, 'Zz bug', 'bug') returning id into t_bug;

  -- Counts: live tasks per custom name, for the pm only.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.check('pm counts live tasks per type',
    (select coalesce(jsonb_object_agg(name, tasks), '{}') from public.general_task_type_counts(p))
      = '{"Epic": 2, "Feature": 1}'::jsonb);
  perform pg_temp.act_as(u[3]);
  perform pg_temp.check('a member counts nothing', not exists (select 1 from public.general_task_type_counts(p)));

  -- Rename Epic to Initiative.
  perform pg_temp.service();
  select count(*) into events_before from public.general_task_events where task_id in (t_epic1, t_epic2, t_epic_trash, t_feat);
  select count(*) into notes_before from public.notifications;
  perform pg_temp.act_as(u[1]);
  perform public.save_general_task_types(p,
    pg_temp.work(pg_temp.e(null, 'Initiative', '#db2777', 'zap') || '{"was":"Epic"}',
      pg_temp.e(null, 'Feature', '#9333ea', 'layers') || '{"was":"Feature"}'),
    (select task_type_set_shown from public.general_projects where id = p));
  perform pg_temp.service();
  perform pg_temp.check('renamed tasks follow, trashed ones included',
    (select count(*) = 3 from public.general_tasks where id in (t_epic1, t_epic2, t_epic_trash) and task_type = 'Initiative'));
  perform pg_temp.check('the stored set has no was',
    (select not (task_type_set -> 2 ? 'was') and task_types = array['Initiative', 'Feature']
       from public.general_projects where id = p));
  perform pg_temp.check('a rename writes no task history',
    (select count(*) = events_before from public.general_task_events where task_id in (t_epic1, t_epic2, t_epic_trash, t_feat)));
  perform pg_temp.check('a rename sends no notification', (select count(*) = notes_before from public.notifications));

  -- Swap two names in one save.
  perform pg_temp.act_as(u[1]);
  perform public.save_general_task_types(p,
    pg_temp.work(pg_temp.e(null, 'Feature', '#db2777', 'zap') || '{"was":"Initiative"}',
      pg_temp.e(null, 'Initiative', '#9333ea', 'layers') || '{"was":"Feature"}'),
    (select task_type_set_shown from public.general_projects where id = p));
  perform pg_temp.service();
  perform pg_temp.check('a swap trades the names',
    (select task_type = 'Feature' from public.general_tasks where id = t_epic1)
    and (select task_type = 'Initiative' from public.general_tasks where id = t_feat));

  -- Slots rename without touching a task row; a dropped custom type stays on its tasks.
  select updated_at into stamp from public.general_tasks where id = t_plain;
  perform pg_temp.act_as(u[1]);
  base := jsonb_build_array(pg_temp.e('default', 'Research Task', '#2563eb', 'search') || '{"was":"Task"}',
    pg_temp.e('bug', 'Defect', '#dc2626', 'bug') || '{"was":"Bug"}',
    pg_temp.e(null, 'Feature', '#db2777', 'zap') || '{"was":"Feature"}');
  perform public.save_general_task_types(p, base, (select task_type_set_shown from public.general_projects where id = p));
  perform pg_temp.service();
  perform pg_temp.check('a slot rename touches no task',
    (select updated_at = stamp and task_type is null from public.general_tasks where id = t_plain)
    and (select kind = 'bug' and task_type is null from public.general_tasks where id = t_bug));
  perform pg_temp.check('a removed type stays on its tasks',
    (select task_type = 'Initiative' from public.general_tasks where id = t_feat));

  -- A removed name can't be given to another task, until it is added back.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('removed name refused on edit',
    format('update public.general_tasks set task_type = %L where id = %L', 'Initiative', t_epic2),
    'Choose a task type');
  perform public.save_general_task_types(p,
    jsonb_build_array(pg_temp.e('default', 'Research Task', '#2563eb', 'search'), pg_temp.e('bug', 'Defect', '#dc2626', 'bug'),
      pg_temp.e(null, 'Feature', '#db2777', 'zap'), pg_temp.e(null, 'Initiative', '#9333ea', 'layers')),
    (select task_type_set_shown from public.general_projects where id = p), null);
  update public.general_tasks set task_type = 'Initiative' where id = t_epic2;
  perform pg_temp.check('added back, the name works again',
    (select task_type = 'Initiative' from public.general_tasks where id = t_epic2));
  perform pg_temp.check('a null preset keeps the stored one',
    (select task_type_preset = 'software' from public.general_projects where id = p));

  -- Rename one type and delete another in one save.
  perform public.save_general_task_types(p,
    jsonb_build_array(pg_temp.e('default', 'Research Task', '#2563eb', 'search'), pg_temp.e('bug', 'Defect', '#dc2626', 'bug'),
      pg_temp.e(null, 'Epic', '#db2777', 'zap') || '{"was":"Feature"}'),
    (select task_type_set_shown from public.general_projects where id = p));
  perform pg_temp.service();
  perform pg_temp.check('rename and delete together',
    (select task_type = 'Epic' from public.general_tasks where id = t_epic1)
    and (select task_type = 'Initiative' from public.general_tasks where id = t_epic2));

  -- QA keeps its rule.
  perform pg_temp.act_as(u[1]);
  perform public.set_general_task_flow(p, 'open');
  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('QA still raises bugs',
    public.create_general_open_task(p, 'Zz qa bug', '', null, null, null, null, 'bug', '{}'::uuid[]) is not null);
  perform pg_temp.refuse('QA still cannot raise a task',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[])',
      p, 'Bad', '', 'task', '{}'), 'QA creates bug tasks only.');

  -- Class projects: the professor saves; renames reach every board.
  perform pg_temp.service();
  select cl.id, cl.professor_id, m.student_id into c, prof, student
    from public.classes cl join public.class_members m on m.class_id = cl.id and m.status = 'active'
    where (select count(*) from public.class_members x where x.class_id = cl.id and x.status = 'active') >= 2
    order by cl.created_at limit 1;
  perform pg_temp.check('class fixture available', c is not null and student is not null);
  select student_id into student2 from public.class_members where class_id = c
    and status = 'active' and student_id <> student order by student_id limit 1;
  insert into public.group_sets(class_id, name, mode) values(c, 'zz-type-looks', 'manual') returning id into gs;
  insert into public.groups(set_id, name) values(gs, 'Type group 1') returning id into g1;
  insert into public.groups(set_id, name) values(gs, 'Type group 2') returning id into g2;
  insert into public.group_members(group_id, set_id, student_id) values (g1, gs, student), (g2, gs, student2);
  insert into public.projects(class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
    values(c, prof, 'zz-type-looks-class', 'activity', 1, 2, 'group', gs, now() + interval '14 days') returning id into cp;
  perform public.ensure_project_boards(cp);
  select id into b1 from public.project_boards where project_id = cp and group_id = g1;
  select id into b2 from public.project_boards where project_id = cp and group_id = g2;

  perform pg_temp.act_as(prof);
  perform public.save_class_task_types(cp,
    jsonb_build_array(pg_temp.e('default', 'Task', '#2563eb', 'square-check'), pg_temp.e(null, 'Review', '#0d9488', 'clipboard-check')),
    (select task_type_set_shown from public.projects where id = cp), 'research');
  perform pg_temp.check('professor saves the class set',
    (select task_types = array['Review'] and task_type_preset = 'research' from public.projects where id = cp));
  perform pg_temp.refuse('class sets keep their own rules',
    format('select public.save_class_task_types(%L, %L, %L)', cp, pg_temp.work(),
      (select task_type_set_shown from public.projects where id = cp)),
    'Class projects have no bug type.');
  perform pg_temp.act_as(student);
  perform pg_temp.refuse('a student cannot save',
    format('select public.save_class_task_types(%L, %L, %L)', cp,
      jsonb_build_array(pg_temp.e('default', 'Task')), (select task_type_set_shown from public.projects where id = cp)),
    'Only a professor changes task types.');

  perform pg_temp.service();
  insert into public.project_tasks(board_id, title, created_by, task_type)
    values (b1, 'Zz class review', student, 'Review') returning id into ct1;
  insert into public.project_tasks(board_id, title, created_by, task_type, status)
    values (b2, 'Zz class review started', student2, 'Review', 'in_progress') returning id into ct2;
  update public.project_boards set submitted_at = now() where id = b2;

  perform pg_temp.act_as(prof);
  perform pg_temp.check('professor counts every copy',
    (select tasks = 2 from public.class_task_type_counts(cp) where name = 'Review'));
  perform public.save_class_task_types(cp,
    jsonb_build_array(pg_temp.e('default', 'Research Task', '#2563eb', 'search') || '{"was":"Task"}',
      pg_temp.e(null, 'Peer Review', '#0d9488', 'clipboard-check') || '{"was":"Review"}'),
    (select task_type_set_shown from public.projects where id = cp));
  perform pg_temp.service();
  perform pg_temp.check('class rename reaches started and submitted boards',
    (select count(*) = 2 from public.project_tasks where id in (ct1, ct2) and task_type = 'Peer Review'));
  perform pg_temp.act_as(student);
  perform pg_temp.check('a student counts nothing', not exists (select 1 from public.class_task_type_counts(cp)));
  perform pg_temp.service();
end $$;

-- Nobody signed out runs the functions.
do $$
begin
  perform pg_temp.check('anon cannot save or count',
    not has_function_privilege('anon', 'public.save_general_task_types(uuid, jsonb, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.save_class_task_types(uuid, jsonb, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.general_task_type_counts(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.class_task_type_counts(uuid)', 'execute'));
end $$;

rollback;
