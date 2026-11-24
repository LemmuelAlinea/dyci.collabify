begin;

-- These checks write task_types directly to test the older guards; task-type-looks.sql lets only
-- its save functions do that, so the suite stands in for them with their flag.
select set_config('collabify.task_type_save', 'on', true);

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

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  p uuid;
  t uuid;
  m uuid;
  o uuid;
begin
  for i in 1..4 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-task-type-' || i || '@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_manage_projects)
      values(u[i], 'zz-task-type-' || i || '@example.test', 'Type', i::text, 'member', 'active', i = 1);
  end loop;

  perform pg_temp.act_as(u[1]);
  p := (public.create_general_project('Zz task types', '')).id;
  perform pg_temp.service();
  insert into public.general_members(project_id, user_id, role) values
    (p, u[2], 'coordinator'), (p, u[3], 'member'), (p, u[4], 'qa');

  perform pg_temp.act_as(u[1]);
  update public.general_projects set task_types = array['Research', 'Design'] where id = p;
  perform pg_temp.check('manager saves choices',
    (select task_types = array['Research', 'Design'] from public.general_projects where id = p));
  perform pg_temp.refuse('duplicate names',
    format('update public.general_projects set task_types = array[%L, %L] where id = %L', 'Design', 'design', p),
    'distinct task type names');
  perform pg_temp.refuse('built-in name',
    format('update public.general_projects set task_types = array[%L] where id = %L', 'Bug', p),
    'distinct task type names');
  perform pg_temp.act_as(u[2]);
  update public.general_projects set task_types = array['Other'] where id = p;
  perform pg_temp.service();
  perform pg_temp.check('coordinator cannot edit types',
    (select task_types = array['Research', 'Design'] from public.general_projects where id = p));

  perform pg_temp.act_as(u[1]);
  insert into public.general_tasks(project_id, title, task_type)
    values(p, 'Zz research', 'Research') returning id into t;
  perform pg_temp.check('planned task keeps custom type',
    (select task_type = 'Research' and kind = 'task' from public.general_tasks where id = t));
  update public.general_tasks set task_type = 'Design' where id = t;
  perform pg_temp.check('task type can change',
    (select task_type = 'Design' from public.general_tasks where id = t));
  update public.general_tasks set task_type = 'Research' where id = t;
  perform pg_temp.refuse('unknown type refused',
    format('insert into public.general_tasks(project_id, title, task_type) values (%L, %L, %L)', p, 'Bad', 'Unknown'),
    'Choose a task type');
  perform pg_temp.refuse('bug cannot wear custom type',
    format('insert into public.general_tasks(project_id, title, kind, task_type) values (%L, %L, %L, %L)', p, 'Bad', 'bug', 'Research'),
    'Choose a task type');

  update public.general_projects set members_create_tasks = true where id = p;
  perform pg_temp.act_as(u[3]);
  m := public.create_general_member_task(p, 'Zz member', '', null, null, 'Design');
  perform pg_temp.service();
  perform pg_temp.check('member task keeps custom type',
    (select task_type = 'Design' and routing_state = 'planning' from public.general_tasks where id = m));

  perform pg_temp.act_as(u[1]);
  perform public.set_general_task_flow(p, 'open');
  perform pg_temp.act_as(u[3]);
  o := public.create_general_open_task(p, 'Zz open', '', null, null, null, null, 'task', '{}'::uuid[], 'Research');
  perform pg_temp.service();
  perform pg_temp.check('open task keeps custom type',
    (select task_type = 'Research' and routing_state = 'released' from public.general_tasks where id = o));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('QA cannot use custom type',
    format('select public.create_general_open_task(%L, %L, %L, null, null, null, null, %L, %L::uuid[], %L)',
      p, 'Bad', '', 'bug', '{}', 'Research'), 'Choose a task type');

  perform pg_temp.act_as(u[1]);
  update public.general_projects set task_types = array['Design'] where id = p;
  update public.general_tasks set title = 'Zz research edited' where id = t;
  perform pg_temp.check('removed type stays on existing tasks',
    (select task_type = 'Research' from public.general_tasks where id = t));
  perform pg_temp.refuse('removed type cannot be assigned',
    format('update public.general_tasks set task_type = %L where id = %L', 'Research', m),
    'Choose a task type');
end $$;

rollback;
