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
  begin execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then raise notice 'PASS %', p_label; return; end if;
    raise exception 'FAIL %: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL %: allowed', p_label;
end $$;

do $$
declare c uuid; prof uuid; student uuid; student2 uuid; gs uuid; g uuid; p uuid; b uuid;
  parent uuid; child uuid; second uuid; started uuid; made jsonb;
begin
  select cl.id, cl.professor_id, m.student_id into c, prof, student
    from public.classes cl join public.class_members m on m.class_id = cl.id and m.status = 'active'
    where (select count(*) from public.class_members x where x.class_id = cl.id and x.status = 'active') >= 2
    order by cl.created_at limit 1;
  perform pg_temp.check('fixture available', c is not null and student is not null);
  select student_id into student2 from public.class_members where class_id = c
    and status = 'active' and student_id <> student order by student_id limit 1;
  insert into public.group_sets(class_id, name, mode) values(c, 'zz-task-settings', 'manual') returning id into gs;
  insert into public.groups(set_id, name) values(gs, 'Task group') returning id into g;
  insert into public.group_members(group_id, set_id, student_id) values
    (g, gs, student), (g, gs, student2);
  insert into public.projects(class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
    values(c, prof, 'zz-task-settings', 'activity', 1, 2, 'group', gs, now() + interval '14 days') returning id into p;
  perform public.ensure_project_boards(p);
  select id into b from public.project_boards where project_id = p limit 1;

  perform pg_temp.act_as(prof);
  update public.projects set task_types = array['Research', 'Review'], default_priority = 'high',
    allow_multiple_assignees = false where id = p;
  perform pg_temp.refuse('duplicate types', format('update public.projects set task_types = array[%L,%L] where id = %L',
    'Research', 'research', p), 'distinct task type names');
  perform pg_temp.act_as(student);
  update public.projects set default_priority = 'low' where id = p;
  perform pg_temp.check('student cannot set rules',
    (select default_priority = 'high' from public.projects where id = p));
  insert into public.project_tasks(board_id, title, created_by, task_type)
    values(b, 'Parent', student, 'Research') returning id into parent;
  perform pg_temp.check('custom type and priority default',
    (select task_type = 'Research' and priority = 'high' from public.project_tasks where id = parent));
  perform pg_temp.refuse('unknown type', format('insert into public.project_tasks(board_id,title,created_by,task_type) values(%L,%L,%L,%L)',
    b, 'Bad', student, 'Unknown'), 'Choose a task type');
  insert into public.project_tasks(board_id, title, created_by, parent_id)
    values(b, 'Child', student, parent) returning id into child;
  perform pg_temp.check('subtask stored on parent',
    (select parent_id = parent from public.project_tasks where id = child));
  insert into public.project_tasks(board_id, title, created_by)
    values(b, 'Second', student) returning id into second;
  insert into public.task_assignees(task_id, student_id) values(second, student);
  perform pg_temp.refuse('one holder limit', format('insert into public.task_assignees(task_id,student_id) values(%L,%L)',
    second, student2), 'one holder per task');
  perform public.set_class_task_dependency(parent, second, true);
  perform pg_temp.check('dependency saved', exists (select 1 from public.class_task_dependencies
    where task_id = parent and depends_on_id = second));
  perform pg_temp.refuse('cycle rejected', format('select public.set_class_task_dependency(%L,%L,true)',
    second, parent), 'cannot form a loop');
  perform pg_temp.refuse('cannot finish parent before child', format('update public.project_tasks set status = %L where id = %L',
    'done', parent), 'Finish the subtasks first');
  perform pg_temp.act_as(prof);
  update public.projects set require_assignee = true where id = p;
  perform pg_temp.refuse('holder required to start', format('update public.project_tasks set status = %L where id = %L',
    'in_progress', parent), 'Assign someone before work starts');
  update public.projects set require_assignee = false, default_stage = 1 where id = p;
  insert into public.project_tasks(board_id, title, created_by) values(b, 'Starts here', prof)
    returning id into started;
  perform pg_temp.check('default stage starts new tasks in progress',
    (select status = 'in_progress' and stage = 1 from public.project_tasks where id = started));
  update public.projects set default_stage = 0 where id = p;
  update public.project_tasks set status = 'done' where id in (child, second);
  update public.project_tasks set status = 'done' where id = parent;
  perform pg_temp.refuse('cannot reopen a completed blocker',
    format('update public.project_tasks set status = %L where id = %L', 'todo', second),
    'Reopen the tasks that depend on this one first');
  update public.projects set task_types = array['Review'], allow_dependencies = false,
    allow_subtasks = false where id = p;
  update public.project_tasks set title = 'Parent edited' where id = parent;
  perform pg_temp.check('removed type stays on task',
    (select task_type = 'Research' from public.project_tasks where id = parent));
  perform pg_temp.refuse('disabled subtasks', format('insert into public.project_tasks(board_id,title,created_by,parent_id) values(%L,%L,%L,%L)',
    b, 'Blocked child', prof, parent), 'Subtasks are off');
  perform pg_temp.refuse('disabled dependencies', format('select public.set_class_task_dependency(%L,%L,true)',
    second, child), 'Dependencies are off');
  made := public.create_professor_task(p, 'Set work', '', 1, null, b, false, 'Review', 'urgent');
  perform pg_temp.check('professor fanout keeps type and priority',
    (select task_type = 'Review' and priority = 'urgent' from public.project_tasks
      where origin_id = (made->>'origin_id')::uuid limit 1));
  perform pg_temp.check('professor updates fanout fields',
    (public.update_professor_task((made->>'origin_id')::uuid, 'Set work', '', 1, null, 'Task', 'low')->>'result') = 'updated');
  perform pg_temp.check('fanout values changed',
    (select task_type = 'Task' and priority = 'low' from public.project_tasks
      where origin_id = (made->>'origin_id')::uuid limit 1));
end $$;
rollback;
