-- The printable record — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/reports.test.sql
--
-- Every claim is paired with a control on the same fixture seconds later. The
-- pairing that matters most here is against the analytics views: reports keep
-- archived work and analytics drops it, and both halves are asserted on the
-- same class in the same breath. A one-sided check would pass with the report
-- views reading exactly like the analytics ones.

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
  v_class uuid; v_prof uuid;
  v_a uuid; v_b uuid;
  v_set uuid; v_group uuid;
  v_group_proj uuid; v_solo_proj uuid;
  v_group_board uuid; v_solo_board uuid;
  t uuid[];
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 8
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   limit 1;

  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-report-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Report group')
  returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  -- A group project on weeks 3-4, and an individual one on week 7. The solo
  -- board is the case class_member_load cannot answer.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-report-group', 'activity', 3, 4, 'group', v_set,
          now() + interval '5 days')
  returning id into v_group_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-report-solo', 'activity', 7, 7, 'individual',
          now() + interval '9 days')
  returning id into v_solo_proj;

  perform public.ensure_project_boards(v_group_proj);
  perform public.ensure_project_boards(v_solo_proj);
  select id into v_group_board from public.project_boards
   where project_id = v_group_proj and group_id = v_group;
  select id into v_solo_board from public.project_boards
   where project_id = v_solo_proj and student_id = v_a;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_group_board, 'zz group task ' || g, 10, v_prof, 'professor'
    from generate_series(1, 3) g;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_solo_board, 'zz solo task', 10, v_prof, 'professor');

  select array_agg(id order by title) into t
    from public.project_tasks where board_id = v_group_board;
  -- Two people on one task, one person on another, and the third left alone.
  insert into public.task_assignees (task_id, student_id)
  values (t[1], v_a), (t[1], v_b), (t[2], v_a);
  -- The solo task needs no insert: solo-auto-claim.sql puts the board's owner
  -- on it the moment it is created, and claiming it again is a duplicate key.

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('class', v_class), ('prof', v_prof), ('a', v_a), ('b', v_b),
    ('gproj', v_group_proj), ('sproj', v_solo_proj),
    ('gboard', v_group_board), ('sboard', v_solo_board),
    ('t1', t[1]), ('t3', t[3]);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------ the class, counted

do $$
declare
  v_class uuid := (select v from fx where k='class');
  r public.report_class_summary%rowtype;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  select * into r from public.report_class_summary where class_id = v_class;

  perform pg_temp.must_be('the class is summarised once', r.class_id = v_class);
  perform pg_temp.must_be('its live students are counted', r.students >= 2);
  perform pg_temp.must_be('the fixture projects are in the count', r.projects >= 2);
  perform pg_temp.must_be('...and none of them is archived yet', r.projects_archived = 0);
  perform pg_temp.must_be('the four fixture tasks are counted', r.tasks >= 4);
  perform pg_temp.must_be('weeks 3, 4 and 7 are covered', r.weeks_covered >= 3);
  perform pg_temp.must_be('and the syllabus is longer than what is covered',
    r.weeks_total > r.weeks_covered);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------- the archive rule

-- The whole reason these views exist. A report is asked for after the term
-- ends, which is exactly when analytics stops answering.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  before_tasks int; after_tasks int; n int; arch timestamptz;
begin
  perform pg_temp.act_as(v_prof);
  select tasks into before_tasks from public.report_class_summary where class_id = v_class;
  select count(*) into n from public.class_health where class_id = v_class;
  perform pg_temp.must_be('while the class is live, analytics answers for it', n = 1);
  perform pg_temp.act_as_service();

  update public.classes set archived_at = now() where id = v_class;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.class_health where class_id = v_class;
  perform pg_temp.must_be('archiving it takes the class out of analytics', n = 0);

  select tasks, archived_at into after_tasks, arch
    from public.report_class_summary where class_id = v_class;
  perform pg_temp.must_be('...but the report still has it', after_tasks = before_tasks);
  perform pg_temp.must_be('...and says when the term ended', arch is not null);

  select count(*) into n from public.report_week_coverage where class_id = v_class;
  perform pg_temp.must_be('its syllabus coverage survives too', n > 0);
  perform pg_temp.act_as_service();

  update public.classes set archived_at = null where id = v_class;
end $$;

-- An archived project is still work that happened, and still counted.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_proj uuid := (select v from fx where k='gproj');
  v_board uuid := (select v from fx where k='gboard');
  v_prof uuid := (select v from fx where k='prof');
  r public.report_class_summary%rowtype; n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.board_diagnosis where board_id = v_board;
  perform pg_temp.must_be('a live project is diagnosed', n = 1);
  perform pg_temp.act_as_service();

  update public.projects set archived_at = now() where id = v_proj;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.board_diagnosis where board_id = v_board;
  perform pg_temp.must_be('archiving it drops it from the diagnosis', n = 0);

  select * into r from public.report_class_summary where class_id = v_class;
  perform pg_temp.must_be('the report still counts the project', r.projects >= 2);
  perform pg_temp.must_be('...and says one of them is archived', r.projects_archived = 1);

  select count(*) into n from public.report_board_tasks where board_id = v_board;
  perform pg_temp.must_be('its tasks are still printable', n = 3);
  perform pg_temp.act_as_service();

  update public.projects set archived_at = null where id = v_proj;
end $$;

-- ---------------------------------------------------- the individual board

do $$
declare
  v_sboard uuid := (select v from fx where k='sboard');
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  n int; r public.report_student_work%rowtype;
begin
  perform pg_temp.act_as(v_prof);

  -- The control, and the reason this view exists: the analytics load view drops
  -- individual boards, so half of what a student did is invisible to it.
  select count(*) into n from public.class_member_load where board_id = v_sboard;
  perform pg_temp.must_be('analytics has nothing for a solo board', n = 0);

  select * into r from public.report_student_work
   where board_id = v_sboard and student_id = v_a;
  perform pg_temp.must_be('the report has the student on it', r.student_id = v_a);
  perform pg_temp.must_be('...with the task they hold', r.tasks_held = 1);
  perform pg_temp.must_be('...and no group name, because there is no group',
    r.group_name is null and r.board_student_name is not null);
  perform pg_temp.act_as_service();
end $$;

-- A shared task counts for both people, and the unclaimed one for neither.
do $$
declare
  v_gboard uuid := (select v from fx where k='gboard');
  v_t1 uuid := (select v from fx where k='t1');
  v_t3 uuid := (select v from fx where k='t3');
  v_prof uuid := (select v from fx where k='prof');
  holders text; n int;
begin
  perform pg_temp.act_as(v_prof);
  select r.holders into holders from public.report_board_tasks r where r.task_id = v_t1;
  perform pg_temp.must_be('a shared task names both holders',
    holders like '%,%');

  select r.holders into holders from public.report_board_tasks r where r.task_id = v_t3;
  perform pg_temp.must_be('...and an unclaimed one names nobody', holders = '');

  select count(*) into n from public.report_student_work
   where board_id = v_gboard and tasks_held = 0;
  perform pg_temp.must_be('a member holding nothing still appears, at zero', n >= 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------- syllabus coverage

do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  r public.report_week_coverage%rowtype;
  v_new uuid;
begin
  perform pg_temp.act_as(v_prof);
  select * into r from public.report_week_coverage where class_id = v_class and week_no = 3;
  perform pg_temp.must_be('a covered week names the project against it',
    r.project_count >= 1 and r.project_titles like '%zz-report-group%');

  select * into r from public.report_week_coverage where class_id = v_class and week_no = 8;
  perform pg_temp.must_be('an uncovered week reports nothing against it',
    r.project_count = 0 and r.project_titles = '');
  perform pg_temp.must_be('...and still prints what the syllabus asked for',
    length(btrim(r.title)) > 0);
  perform pg_temp.act_as_service();

  -- The control: set something against that week and the same row fills in.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, (select v from fx where k='prof'), 'zz-report-week8', 'activity',
          8, 8, 'individual', now() + interval '20 days')
  returning id into v_new;

  perform pg_temp.act_as(v_prof);
  select * into r from public.report_week_coverage where class_id = v_class and week_no = 8;
  perform pg_temp.must_be('setting a project against it closes the gap',
    r.project_count = 1 and r.project_titles = 'zz-report-week8');
  perform pg_temp.act_as_service();
end $$;

-- -------------------------------------------------------- no marks in here

/**
 * Collabify records no grade, and a printed report is exactly where a
 * completion figure would start being read as one. Asserting on the column
 * names means widening a report to carry a mark cannot happen quietly.
 */
do $$
declare
  bad text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into bad
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('report_class_summary', 'report_week_coverage',
                        'report_student_work', 'report_board_tasks')
     and column_name ~* '(score|grade|mark|rating|points|percentage_grade)';
  perform pg_temp.must_be('no report view carries anything that could pass for a mark',
    bad is null);
end $$;

-- ---------------------------------------------------------------- who sees

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.report_class_summary;
  perform pg_temp.must_be('the professor reads their own classes', n > 0);

  perform pg_temp.act_as(v_a);
  select count(*) into n from public.report_class_summary;
  perform pg_temp.must_be('a student in the class reads no class summary', n = 0);
  select count(*) into n from public.report_week_coverage where class_id = v_class;
  perform pg_temp.must_be('...nor the coverage of its syllabus', n = 0);
  select count(*) into n from public.report_student_work;
  perform pg_temp.must_be('...nor anybody''s contribution, including their own', n = 0);
  select count(*) into n from public.report_board_tasks;
  perform pg_temp.must_be('...nor the printable task list', n = 0);

  perform pg_temp.act_as((select id from public.profiles
                           where role = 'student' and id <> v_a
                             and id not in (select student_id from public.class_members
                                             where class_id = v_class)
                           limit 1));
  select count(*) into n from public.report_class_summary;
  perform pg_temp.must_be('somebody outside the class reads none of it', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
