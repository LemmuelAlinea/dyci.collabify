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

rollback;
