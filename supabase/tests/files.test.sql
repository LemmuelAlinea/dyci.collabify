-- The files view — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/files.test.sql
--
-- file_overview gathers four stores and carries no role logic. These check that
-- what each person reaches is decided entirely by their own policies, with each
-- "cannot see" paired against somebody who can, on the same file.

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_g1 uuid; v_g2 uuid; v_proj uuid;
  b1 uuid; b2 uuid; t1 uuid; t2 uuid; f1 uuid; f2 uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status='active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status='active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class,'zz-files-fixture','manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set,'Files A') returning id into v_g1;
  insert into public.groups (set_id, name) values (v_set,'Files B') returning id into v_g2;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g1, v_set, v_a), (v_g2, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-files-proj','activity',1,2,'group',v_set, now()+interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into b1 from public.project_boards where project_id=v_proj and group_id=v_g1;
  select id into b2 from public.project_boards where project_id=v_proj and group_id=v_g2;

  insert into public.project_tasks (board_id,title,weight,created_by,author_role)
  values (b1,'zz-files-task-A',10,v_prof,'professor') returning id into t1;
  insert into public.project_tasks (board_id,title,weight,created_by,author_role)
  values (b2,'zz-files-task-B',10,v_prof,'professor') returning id into t2;

  -- Only the people on a task may attach to it, so each claims theirs first.
  perform pg_temp.act_as(v_a);
  insert into public.task_assignees (task_id, student_id) values (t1, v_a);
  insert into public.task_files (task_id, uploaded_by, file_path, file_name, size_bytes)
  values (t1, v_a, 'zz/a.pdf','a.pdf', 100) returning id into f1;
  perform pg_temp.act_as(v_b);
  insert into public.task_assignees (task_id, student_id) values (t2, v_b);
  insert into public.task_files (task_id, uploaded_by, file_path, file_name, size_bytes)
  values (t2, v_b, 'zz/b.pdf','b.pdf', 200) returning id into f2;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof',v_prof),('a',v_a),('b',v_b),('class',v_class),
    ('proj',v_proj),('g1',v_g1),('f1',f1),('f2',f2);
  raise notice 'fixture ready';
end $$;

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  f1 uuid := (select v from fx where k='f1');
  f2 uuid := (select v from fx where k='f2');
  n int;
begin
  perform pg_temp.act_as(v_a);

  select count(*) into n from public.file_overview where id = f1;
  perform pg_temp.must_be('a student reaches their own group''s file', n = 1);

  select count(*) into n from public.file_overview where id = f2;
  perform pg_temp.must_be('...and not the other group''s', n = 0);

  -- Current policy, recorded rather than assumed: teaching_resources_own is
  -- professor_id = auth.uid(), so the source PDFs of the syllabus and the
  -- curriculum reach nobody else. Students read the parsed weeks through
  -- class_week_map instead. Widening that is an access decision, not a bug.
  select count(*) into n from public.file_overview
   where source in ('syllabus','curriculum');
  perform pg_temp.must_be('a student reaches no course-material PDF', n = 0);

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.file_overview where id in (f1, f2);
  perform pg_temp.must_be('the professor reaches both groups'' files', n = 2);

  select count(*) into n from public.file_overview
   where id = f1 and group_name = 'Files A';
  perform pg_temp.must_be('...each carrying the group that handed it up', n = 1);

  select count(*) into n from public.file_overview
   where source in ('syllabus','curriculum')
     and class_id = (select v from fx where k='class');
  perform pg_temp.must_be('course material is attached to the class', n >= 1);

  select count(*) into n from public.file_overview
   where id = f1 and bucket = 'task-files';
  perform pg_temp.must_be('every row carries the bucket to ask for a link', n = 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
