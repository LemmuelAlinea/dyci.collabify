-- The program chair's console — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/admin-program.test.sql
--
-- Two claims are being tested and neither is worth anything alone. The chair
-- can count what is happening across the program; and the chair still cannot
-- read a word of it. Every assertion here is one half of that pair, on the same
-- fixture, seconds apart.

begin;

-- ------------------------------------------------------------------ helpers

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_admin uuid; v_prof uuid; v_class uuid; v_stud uuid;
  v_syllabus uuid; v_proj uuid; v_board uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;

  -- A class with real work in it, so the counts have something to be wrong about.
  select c.professor_id, c.id, c.syllabus_id into v_prof, v_class, v_syllabus
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 1
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 5
   order by c.created_at
   limit 1;

  select student_id into v_stud from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('admin', v_admin), ('prof', v_prof), ('class', v_class), ('stud', v_stud),
    ('syllabus', v_syllabus);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------- counts, never content

/**
 * The column list is pinned. Everything this view may ever carry is a count, a
 * date, or the name of a class or its professor — so a column arriving later
 * called `latest_comment` or `top_task` has to break this test first.
 */
do $$
declare
  expected text[] := array[
    'class_id', 'class_initial', 'class_name', 'code', 'section', 'year_level',
    'semester', 'school_year', 'professor_id', 'professor_name', 'term_start',
    'term_end', 'archived_at', 'has_syllabus', 'weeks_total', 'weeks_covered',
    'weeks_elapsed', 'weeks_in_term', 'students', 'projects', 'projects_released',
    'boards', 'tasks', 'tasks_done', 'tasks_late', 'last_activity'
  ];
  actual text[];
begin
  select array_agg(column_name order by column_name) into actual
    from information_schema.columns
   where table_schema = 'public' and table_name = 'admin_class_overview';

  perform pg_temp.must_be('the view carries exactly the agreed columns',
    actual = (select array_agg(c order by c) from unnest(expected) c));
end $$;

-- ----------------------------------------------------------- the wall stands

/**
 * The pair that matters. The chair counts the whole program on one statement
 * and reads not one row of what is in it on the next. Either half alone would
 * pass with the feature broken in the opposite direction.
 */
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  n int; classes int;
begin
  perform pg_temp.act_as(v_admin);

  select count(*) into classes from public.admin_class_overview;
  perform pg_temp.must_be('the chair sees every class in the program', classes >= 1);

  select count(*) into n from public.project_tasks;
  perform pg_temp.must_be('...and cannot read a single task', n = 0);
  select count(*) into n from public.task_comments;
  perform pg_temp.must_be('...nor a comment', n = 0);
  select count(*) into n from public.task_files;
  perform pg_temp.must_be('...nor a file', n = 0);
  select count(*) into n from public.messages;
  perform pg_temp.must_be('...nor a message', n = 0);
  select count(*) into n from public.board_results;
  perform pg_temp.must_be('...nor a verdict', n = 0);
  select count(*) into n from public.projects;
  perform pg_temp.must_be('...nor the projects themselves', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------- the figures

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_class uuid := (select v from fx where k='class');
  r public.admin_class_overview%rowtype;
  real_students int; real_tasks int; real_done int;
begin
  -- What is actually there, read with no policies in the way.
  select count(*) into real_students from public.class_members
   where class_id = v_class and status = 'active';
  select count(*), count(*) filter (where t.status = 'done')
    into real_tasks, real_done
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where p.class_id = v_class;

  perform pg_temp.act_as(v_admin);
  select * into r from public.admin_class_overview where class_id = v_class;

  perform pg_temp.must_be('the student count is the real one', r.students = real_students);
  perform pg_temp.must_be('the task count is the real one', r.tasks = real_tasks);
  perform pg_temp.must_be('...and so is what is finished', r.tasks_done = real_done);
  perform pg_temp.must_be('the professor is named', length(r.professor_name) > 0);
  perform pg_temp.must_be('a dated class reports the weeks elapsed',
    r.term_start is null or r.weeks_elapsed >= 1);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- readiness

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_class uuid := (select v from fx where k='class');
  v_syllabus uuid := (select v from fx where k='syllabus');
  r public.admin_class_overview%rowtype;
begin
  perform pg_temp.act_as(v_admin);
  select * into r from public.admin_class_overview where class_id = v_class;
  perform pg_temp.must_be('a class with a syllabus says so', r.has_syllabus);
  perform pg_temp.must_be('...and counts its weeks', r.weeks_total >= 5);
  perform pg_temp.act_as_service();

  -- The control: take the syllabus away and the same class is not ready.
  update public.classes set syllabus_id = null where id = v_class;
  perform pg_temp.act_as(v_admin);
  select * into r from public.admin_class_overview where class_id = v_class;
  perform pg_temp.must_be('taking the syllabus away shows the class as not ready',
    not r.has_syllabus and r.weeks_total = 0);
  perform pg_temp.act_as_service();

  update public.classes set syllabus_id = v_syllabus where id = v_class;
end $$;

-- --------------------------------------------------------- syllabus coverage

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  before_covered int; after_covered int; v_new uuid;
begin
  perform pg_temp.act_as(v_admin);
  select weeks_covered into before_covered
    from public.admin_class_overview where class_id = v_class;
  perform pg_temp.act_as_service();

  -- A project spanning two weeks nobody has covered yet.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-admin-coverage', 'activity', 14, 15, 'individual',
          now() + interval '20 days')
  returning id into v_new;

  perform pg_temp.act_as(v_admin);
  select weeks_covered into after_covered
    from public.admin_class_overview where class_id = v_class;
  perform pg_temp.must_be('setting work against two weeks covers two more',
    after_covered = before_covered + 2);
  perform pg_temp.act_as_service();

  -- The control: archive it, and the coverage goes back. A withdrawn project
  -- did not cover its weeks.
  update public.projects set archived_at = now() where id = v_new;
  perform pg_temp.act_as(v_admin);
  select weeks_covered into after_covered
    from public.admin_class_overview where class_id = v_class;
  perform pg_temp.must_be('archiving it gives the two weeks back',
    after_covered = before_covered);
  perform pg_temp.act_as_service();
end $$;

-- A finished term is still the chair's to review.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_class uuid := (select v from fx where k='class');
  r public.admin_class_overview%rowtype;
  n int;
begin
  update public.classes set archived_at = now() where id = v_class;

  perform pg_temp.act_as(v_admin);
  select * into r from public.admin_class_overview where class_id = v_class;
  perform pg_temp.must_be('an archived class is still listed', r.class_id = v_class);
  perform pg_temp.must_be('...and says when the term ended', r.archived_at is not null);

  -- The control on the same statement: analytics drops it, as it should.
  select count(*) into n from public.class_health where class_id = v_class;
  perform pg_temp.must_be('...while analytics has let it go', n = 0);
  perform pg_temp.act_as_service();

  update public.classes set archived_at = null where id = v_class;
end $$;

-- ---------------------------------------------------------------- who sees

/**
 * The view is not `security_invoker`, so `is_admin()` is the entire gate. If it
 * were ever dropped, this is the test that would notice.
 */
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.admin_class_overview;
  perform pg_temp.must_be('a professor reads nothing of the program console', n = 0);

  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.admin_class_overview;
  perform pg_temp.must_be('a student reads nothing of it either', n = 0);

  -- The control: the admin reads it on the same statement, so "nothing" is
  -- never the answer for everybody.
  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.admin_class_overview;
  perform pg_temp.must_be('...and the chair still reads all of it', n >= 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
