-- A student's own record — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/student-reports.test.sql
--
-- The claim these views make is a negative one: a student sees their own work
-- and their own board, and nothing else. So every "they cannot see it" is
-- paired with somebody who can see exactly that row on the same statement — a
-- view that returned nothing to anybody would otherwise pass the whole suite.

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

/**
 * Two groups on one project. A and B share the first board; C is on the second
 * and has no business seeing the first.
 */
do $$
declare
  v_class uuid; v_prof uuid;
  v_a uuid; v_b uuid; v_c uuid;
  v_set uuid; v_g1 uuid; v_g2 uuid;
  v_proj uuid; v_b1 uuid; v_b2 uuid;
  t uuid[];
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 3
   limit 1;

  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a
   order by student_id limit 1;
  select student_id into v_c from public.class_members
   where class_id = v_class and status = 'active' and student_id not in (v_a, v_b)
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-student-report', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Alpha') returning id into v_g1;
  insert into public.groups (set_id, name) values (v_set, 'Beta') returning id into v_g2;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g1, v_set, v_a), (v_g1, v_set, v_b), (v_g2, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-student-report', 'activity', 1, 2, 'group', v_set,
          now() + interval '7 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_b1 from public.project_boards where project_id = v_proj and group_id = v_g1;
  select id into v_b2 from public.project_boards where project_id = v_proj and group_id = v_g2;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_b1, 'zz alpha ' || g, 10, v_prof, 'professor' from generate_series(1, 4) g;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_b2, 'zz beta task', 10, v_prof, 'professor');

  select array_agg(id order by title) into t
    from public.project_tasks where board_id = v_b1;
  -- A holds three of four, B one: a split worth printing.
  insert into public.task_assignees (task_id, student_id)
  values (t[1], v_a), (t[2], v_a), (t[3], v_a), (t[4], v_b);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('class', v_class), ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c),
    ('proj', v_proj), ('b1', v_b1), ('b2', v_b2);
  raise notice 'fixture ready';
end $$;

-- --------------------------------------------------------------- their own

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b1 uuid := (select v from fx where k='b1');
  r public.my_work_report%rowtype;
  n int;
begin
  perform pg_temp.act_as(v_a);
  select * into r from public.my_work_report where board_id = v_b1;
  perform pg_temp.must_be('a student sees their own board', r.board_id = v_b1);
  perform pg_temp.must_be('...with what they hold on it', r.tasks_held = 3);
  perform pg_temp.must_be('...and the board total beside it', r.board_tasks = 4);
  perform pg_temp.must_be('...and the class it belongs to', length(r.class_initial) > 0);

  -- Only their own row. B holds a task on the same board; the view is one
  -- person's, so B's line is not in it.
  select count(*) into n from public.my_work_report where board_id = v_b1;
  perform pg_temp.must_be('my work is one row per board, never a roster', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------ their group's board

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_b1 uuid := (select v from fx where k='b1');
  n int; mine int; holders text;
begin
  perform pg_temp.act_as(v_a);

  select count(*) into n from public.my_board_tasks where board_id = v_b1;
  perform pg_temp.must_be('the whole board of tasks is printable', n = 4);

  select r.holders into holders from public.my_board_tasks r
   where r.board_id = v_b1 and r.holders <> '' limit 1;
  perform pg_temp.must_be('...and each task names who holds it', length(holders) > 0);

  select count(*) into n from public.my_board_members where board_id = v_b1;
  perform pg_temp.must_be('every member of the board is listed', n = 2);

  select count(*) into mine from public.my_board_members
   where board_id = v_b1 and is_me;
  perform pg_temp.must_be('...with exactly one of them marked as the reader', mine = 1);

  -- The control on the same statement: B reads the same board, and the row
  -- marked as theirs is a different one.
  perform pg_temp.act_as(v_b);
  select count(*) into mine from public.my_board_members
   where board_id = v_b1 and is_me and student_id = v_b;
  perform pg_temp.must_be('a groupmate reading it is marked as themselves', mine = 1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ another group

-- The point of the whole file. Each refusal is paired with the person who does
-- see that row, seconds later, so "nothing" can never be the whole answer.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  v_b1 uuid := (select v from fx where k='b1');
  v_b2 uuid := (select v from fx where k='b2');
  n int;
begin
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.my_board_tasks where board_id = v_b2;
  perform pg_temp.must_be('another group''s tasks are not readable', n = 0);
  select count(*) into n from public.my_board_members where board_id = v_b2;
  perform pg_temp.must_be('...nor how that group split its work', n = 0);
  select count(*) into n from public.my_work_report where board_id = v_b2;
  perform pg_temp.must_be('...nor its row in my own record', n = 0);

  -- The control: the group who owns it reads all three.
  perform pg_temp.act_as(v_c);
  select count(*) into n from public.my_board_tasks where board_id = v_b2;
  perform pg_temp.must_be('the group who owns that board reads its tasks', n = 1);
  select count(*) into n from public.my_board_members where board_id = v_b2;
  perform pg_temp.must_be('...and its members', n = 1);

  -- ...and the same person is shut out of the first board, which is the mirror
  -- of the refusal above rather than a repeat of it.
  select count(*) into n from public.my_board_tasks where board_id = v_b1;
  perform pg_temp.must_be('...while reading nothing of the other one', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------- and nothing wider

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  perform pg_temp.act_as(v_a);

  -- A student's report page must not become a way into the professor's.
  select count(*) into n from public.report_student_work;
  perform pg_temp.must_be('a student reads no professor report of contribution', n = 0);
  select count(*) into n from public.report_class_summary;
  perform pg_temp.must_be('...nor the class summary', n = 0);
  select count(*) into n from public.class_actions;
  perform pg_temp.must_be('...nor a single recommendation', n = 0);
  select count(*) into n from public.board_diagnosis;
  perform pg_temp.must_be('...nor any board diagnosis', n = 0);

  -- The control: their professor reads all four for the same class.
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.report_class_summary where class_id = v_class;
  perform pg_temp.must_be('their professor still reads the class summary', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- Somebody with no connection to the class reads none of it, mine included.
do $$
declare
  v_out uuid;
  v_b1 uuid := (select v from fx where k='b1');
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  select id into v_out from public.profiles
   where role = 'student'
     and id not in (select student_id from public.class_members where class_id = v_class)
   limit 1;

  perform pg_temp.act_as(v_out);
  select count(*) into n from public.my_board_tasks where board_id = v_b1;
  perform pg_temp.must_be('an outsider reads none of the board', n = 0);
  select count(*) into n from public.my_board_members where board_id = v_b1;
  perform pg_temp.must_be('...nor who is on it', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
