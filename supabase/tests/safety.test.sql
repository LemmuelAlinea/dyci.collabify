-- What a delete is allowed to take with it — rolled back, touches nothing.
--
--   node scripts/db.mjs supabase/tests/safety.test.sql
--
-- The claim is narrow and has two halves, so both are tested: a delete that
-- would destroy other people's work is refused, and the deletes that are
-- supposed to work still do. A constraint that refused everything would pass
-- the first half on its own.

begin;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 56);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

-- ------------------------------------------------------------------ fixture

/**
 * A professor of their own, with a class, a project and a task in it, so the
 * delete being refused is refused over real work rather than an empty row.
 */
do $$
declare
  v_prof uuid := gen_random_uuid();
  v_other uuid;
  v_class uuid; v_proj uuid; v_board uuid;
  v_student uuid; v_syllabus uuid;
begin
  select id into v_other from public.profiles where role = 'professor' order by created_at limit 1;
  select student_id into v_student from public.class_members where status = 'active' limit 1;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_prof, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-safety@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_prof, 'Zz', 'Safety', 'zz-safety@example.test', 'professor', 'active');

  -- Borrow a syllabus that already has weeks: a project refuses a week span the
  -- class's syllabus does not cover, which is the guard doing its job.
  select syllabus_id into v_syllabus from public.classes
   where syllabus_id is not null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = syllabus_id) >= 1
   limit 1;

  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_prof, 'zz Safety Class', 'ZZS', 'ZZ-SAFE-1', 'BSIT 9Z', '3rd', '1st', '2026-2027',
          v_syllabus)
  returning id into v_class;

  insert into public.class_members (class_id, student_id) values (v_class, v_student);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz safety project', 'activity', 1, 1, 'individual',
          now() + interval '5 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'zz safety task', 10, v_prof, 'professor');

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values
    ('prof', v_prof), ('other', v_other), ('class', v_class), ('proj', v_proj);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------- the delete that destroys

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid := (select v from fx where k='class');
  v_proj uuid := (select v from fx where k='proj');
  n int;
begin
  perform pg_temp.must_refuse('deleting a professor who holds a class is refused',
    format('delete from public.profiles where id = %L', v_prof));

  -- The point of refusing: everything is still there afterwards.
  select count(*) into n from public.classes where id = v_class;
  perform pg_temp.must_be('the class survived the attempt', n = 1);
  select count(*) into n from public.projects where id = v_proj;
  perform pg_temp.must_be('...and its project', n = 1);
  select count(*) into n from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
   where b.project_id = v_proj;
  perform pg_temp.must_be('...and the task on it', n = 1);
  select count(*) into n from public.class_members where class_id = v_class;
  perform pg_temp.must_be('...and the enrolment', n = 1);
end $$;

-- ------------------------------------------------------ the way out is real

/**
 * A constraint that cannot be satisfied is a trap rather than a safeguard, so
 * the hand-over is tested too: give the class and the project to somebody else
 * and the same delete goes through.
 */
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_other uuid := (select v from fx where k='other');
  v_class uuid := (select v from fx where k='class');
  v_proj uuid := (select v from fx where k='proj');
  n int;
begin
  update public.classes set professor_id = v_other where id = v_class;
  update public.projects set created_by = v_other where id = v_proj;

  perform pg_temp.must_allow('once handed over, the account can go',
    format('delete from public.profiles where id = %L', v_prof));

  select count(*) into n from public.classes where id = v_class;
  perform pg_temp.must_be('the class is still standing, under its new professor', n = 1);
  select count(*) into n from public.projects where id = v_proj;
  perform pg_temp.must_be('...and so is the project', n = 1);
end $$;

-- --------------------------------------------------- the cascades that stay

/**
 * The change has to be narrow. Deleting a class is still meant to take its
 * projects and their boards — that is what deleting a class means — and a
 * student's own participation still goes with them.
 */
do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_proj uuid := (select v from fx where k='proj');
  n int;
begin
  delete from public.classes where id = v_class;

  select count(*) into n from public.projects where id = v_proj;
  perform pg_temp.must_be('deleting a class still takes its projects', n = 0);
  select count(*) into n from public.project_boards where project_id = v_proj;
  perform pg_temp.must_be('...and their boards', n = 0);
end $$;

-- A student holds only their own rows, so nothing blocks removing one.
do $$
declare
  v_stud uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_stud, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-safety-stud@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_stud, 'Zz', 'Student', 'zz-safety-stud@example.test', 'student', 'active');

  perform pg_temp.must_allow('a student account can still be deleted',
    format('delete from public.profiles where id = %L', v_stud));
end $$;

rollback;
