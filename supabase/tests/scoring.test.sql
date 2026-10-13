-- Rubric scoring — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/scoring.test.sql
--
-- Every refusal is paired with a control that succeeds. Peer factors use the same
-- three students and ratings as peer-evaluation.test.sql:
--   a rates a=5 b=4 c=2 · b rates a=4 b=4 c=2 · c rates a=4 b=3 c=5
-- Received (self excluded): a 4.0 · b 3.5 · c 2.0, team mean 3.1667, so the
-- factors are a 1.263 · b 1.105 · c 0.632. On a group score of 80 the
-- suggestions are a 84 (capped at 1.05) · b 84 (capped) · c 50.5.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Points for the group project's two criteria, as save_board_scores takes them. */
create or replace function pg_temp.pts(p_a uuid, s_a numeric, p_b uuid, s_b numeric) returns text
language sql as $$
  select jsonb_build_array(
    jsonb_build_object('criterion_id', p_a, 'points', s_a),
    jsonb_build_object('criterion_id', p_b, 'points', s_b))::text;
$$;

/** Final scores for a, b and c, as confirm_member_scores takes them. */
create or replace function pg_temp.finals(p_a uuid, f_a numeric, p_b uuid, f_b numeric, p_c uuid, f_c numeric)
returns text language sql as $$
  select jsonb_build_array(
    jsonb_build_object('student_id', p_a, 'final', f_a),
    jsonb_build_object('student_id', p_b, 'final', f_b),
    jsonb_build_object('student_id', p_c, 'final', f_c))::text;
$$;

/** Everyone in the order (a, b, c) rated with one score across all five dimensions. */
create or replace function pg_temp.ratings(p_a uuid, s_a int, p_b uuid, s_b int, p_c uuid, s_c int)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ratee_id', p_a, 'contributes', s_a, 'interacts', s_a, 'on_track', s_a,
                       'quality', s_a, 'skills', s_a, 'comment', ''),
    jsonb_build_object('ratee_id', p_b, 'contributes', s_b, 'interacts', s_b, 'on_track', s_b,
                       'quality', s_b, 'skills', s_b, 'comment', ''),
    jsonb_build_object('ratee_id', p_c, 'contributes', s_c, 'interacts', s_c, 'on_track', s_c,
                       'quality', s_c, 'skills', s_c, 'comment', ''));
$$;

-- ---------------------------------------------------------------- fixture

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_solo uuid; v_board uuid; v_solo_board uuid;
  v_ca uuid; v_cb uuid; v_cs uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 4
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 0 limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select student_id into v_c from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 2 limit 1;
  select student_id into v_d from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 3 limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-score-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-score-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b), (v_g, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id,
     total_points, due_at)
  values (v_class, v_prof, 'zz-score-proj', 'activity', 1, 2, 'group', v_set, 100,
          now() + interval '5 days')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, total_points, due_at)
  values (v_class, v_prof, 'zz-score-solo', 'activity', 1, 2, 'individual', 50,
          now() + interval '5 days')
  returning id into v_solo;

  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_proj, 1, 'zz-Function', 'It works', 60) returning id into v_ca;
  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_proj, 2, 'zz-Docs', 'It is explained', 40) returning id into v_cb;
  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_solo, 1, 'zz-Solo', 'All of it', 50) returning id into v_cs;

  perform public.ensure_project_boards(v_proj);
  perform public.ensure_project_boards(v_solo);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;
  select id into v_solo_board from public.project_boards where project_id = v_solo and student_id = v_a;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('set', v_set), ('group', v_g), ('proj', v_proj), ('solo', v_solo),
    ('board', v_board), ('solo_board', v_solo_board),
    ('crit_a', v_ca), ('crit_b', v_cb), ('crit_s', v_cs);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------- points and history (Task 1)

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cs uuid := (select v from fx where k='crit_s');
  n int;
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse('points above the criterion''s maximum are refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 61)', v_board, v_ca));
  perform pg_temp.must_refuse('points come in whole or half steps',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 2.3)', v_board, v_ca));
  perform pg_temp.must_refuse('negative points are refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, -1)', v_board, v_ca));
  perform pg_temp.must_refuse('a criterion from another project is refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 5)', v_board, v_cs));
  perform pg_temp.must_allow('with no scores yet, the rubric''s points can change',
    format('update public.project_criteria set max_points = 60 where id = %L', v_ca));
  perform pg_temp.must_allow('the maximum itself is a valid score',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 60)', v_board, v_ca));

  select count(*) into n from public.score_history
   where board_id = v_board and action = 'criterion' and old_value is null and new_value = 60;
  perform pg_temp.must_be('a first score writes a history row', n = 1);

  update public.board_scores set points = 52.5 where board_id = v_board and criterion_id = v_ca;
  select count(*) into n from public.score_history
   where board_id = v_board and action = 'criterion' and old_value = 60 and new_value = 52.5;
  perform pg_temp.must_be('a changed score records the old and new points', n = 1);

  update public.board_scores set points = 52.5 where board_id = v_board and criterion_id = v_ca;
  select count(*) into n from public.score_history where board_id = v_board and action = 'criterion';
  perform pg_temp.must_be('saving the same points again writes nothing', n = 2);
end $$;

-- ------------------------------------------------------- the lock (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('scores lock a criterion''s points',
    format('update public.project_criteria set max_points = 50 where id = %L', v_ca));
  perform pg_temp.must_refuse('scores lock the order',
    format('update public.project_criteria set position = 3 where id = %L', v_ca));
  perform pg_temp.must_refuse('scores lock out a new criterion',
    format('insert into public.project_criteria (project_id, position, label, max_points) values (%L, 3, ''zz-extra'', 5)', v_proj));
  perform pg_temp.must_refuse('scores lock out removing a criterion',
    format('delete from public.project_criteria where id = %L', v_cb));
  perform pg_temp.must_refuse('scores lock the project total',
    format('update public.projects set total_points = 90 where id = %L', v_proj));
  perform pg_temp.must_allow('wording stays editable',
    format('update public.project_criteria set label = ''zz-Function, renamed'', description = ''zz-said better'' where id = %L', v_ca));
  perform pg_temp.must_be('and the professor can tell the rubric is scored',
    public.project_has_scores(v_proj));

  perform pg_temp.act_as((select v from fx where k='a'));
  perform pg_temp.must_be('a student cannot ask whether scoring has started',
    not public.project_has_scores(v_proj));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the new wording landed',
    exists (select 1 from public.project_criteria where id = v_ca and label = 'zz-Function, renamed'));
  perform pg_temp.must_be('and the points did not move',
    (select max_points from public.project_criteria where id = v_cb) = 40
    and (select total_points from public.projects where id = v_proj) = 100);
end $$;

-- ----------------------------------------------- audience change (Task 1)

do $$
declare
  v_proj uuid := (select v from fx where k='proj');
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  perform pg_temp.must_refuse('changing who a scored project goes to is refused',
    format('select public.set_project_audience(%L, ''individual'', null)', v_proj));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('and the scored board is still there',
    exists (select 1 from public.board_scores where board_id = (select v from fx where k='board')));
end $$;

-- ------------------------------------------------------- who sees (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
begin
  perform pg_temp.act_as_service();
  insert into public.member_scores (board_id, student_id, suggested, final, overridden)
  values (v_board, v_a, 80, 80, false), (v_board, v_b, 80, 75, true);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('before release a member sees no board scores',
    (select count(*) from public.board_scores where board_id = v_board) = 0);
  perform pg_temp.must_be('nor their own member score',
    (select count(*) from public.member_scores where board_id = v_board) = 0);
  perform pg_temp.must_refuse('a student cannot write a score',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 1)', v_board, v_ca));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor sees the board''s scores',
    (select count(*) from public.board_scores where board_id = v_board) = 1);
  perform pg_temp.must_be('and every member score',
    (select count(*) from public.member_scores where board_id = v_board) = 2);
  perform pg_temp.must_be('and the history',
    (select count(*) from public.score_history where project_id = v_proj) > 0);
  perform pg_temp.must_refuse('the professor cannot write a member score outside the functions',
    format('insert into public.member_scores (board_id, student_id, suggested, final, overridden) values (%L, %L, 1, 1, false)',
           v_board, (select v from fx where k='c')));

  perform pg_temp.act_as_service();
  insert into public.score_releases (project_id) values (v_proj);
  perform pg_temp.must_be('releasing writes a history row',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'release'));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('after release a member sees the board''s scores',
    (select count(*) from public.board_scores where board_id = v_board) = 1);
  perform pg_temp.must_be('and only their own member score',
    (select count(*) from public.member_scores where board_id = v_board) = 1
    and (select student_id from public.member_scores where board_id = v_board) = v_a);
  perform pg_temp.must_be('the release itself is visible to the class',
    exists (select 1 from public.score_releases where project_id = v_proj));
  perform pg_temp.must_be('a student never reads the history',
    (select count(*) from public.score_history where project_id = v_proj) = 0);

  perform pg_temp.act_as(v_d);
  perform pg_temp.must_be('a classmate outside the group sees no board scores',
    (select count(*) from public.board_scores where board_id = v_board) = 0);

  perform pg_temp.act_as_service();
  delete from public.score_releases where project_id = v_proj;
  perform pg_temp.must_be('withdrawing a release is recorded',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'unrelease'));

  -- Task 2 starts from an unscored board.
  delete from public.member_scores where board_id = v_board;
  delete from public.board_scores where board_id = v_board;
end $$;

-- ================================================= Task 2 appends below here

-- ---------------------------------------------- a scored project can go (last)

do $$
declare
  v_class uuid := (select class_id from public.projects where id = (select v from fx where k='proj'));
  v_prof uuid := (select v from fx where k='prof');
  v_set uuid := (select v from fx where k='set');
  v_g uuid := (select v from fx where k='group');
  v_p uuid; v_c uuid; v_b uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, total_points)
  values (v_class, v_prof, 'zz-score-doomed', 'activity', 1, 2, 'group', v_set, 10)
  returning id into v_p;
  insert into public.project_criteria (project_id, position, label, max_points)
  values (v_p, 1, 'zz-only', 10) returning id into v_c;
  perform public.ensure_project_boards(v_p);
  select id into v_b from public.project_boards where project_id = v_p and group_id = v_g;
  insert into public.board_scores (board_id, criterion_id, points) values (v_b, v_c, 7);
  perform pg_temp.must_allow('a scored project can still be deleted',
    format('delete from public.projects where id = %L', v_p));
  perform pg_temp.must_be('and its scores went with it',
    not exists (select 1 from public.board_scores where criterion_id = v_c));
end $$;

rollback;
