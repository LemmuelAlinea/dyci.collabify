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
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse('a scored criterion cannot move to an unscored project',
    format('update public.project_criteria set project_id = %L where id = %L',
           (select v from fx where k='solo'), v_ca));
  perform pg_temp.act_as(v_prof);
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

-- ------------------------------------------------- the suggestion (Task 2)

do $$
begin
  perform pg_temp.must_be('no factor: the group score', public.suggest_score(80, null, 100) = 80);
  perform pg_temp.must_be('80 × 0.9 gives 72', public.suggest_score(80, 0.9, 100) = 72);
  perform pg_temp.must_be('the factor caps at 1.05: 80 × 1.2 gives 84', public.suggest_score(80, 1.2, 100) = 84);
  perform pg_temp.must_be('never above the total', public.suggest_score(100, 1.04, 100) = 100);
  perform pg_temp.must_be('never above the total without a factor either', public.suggest_score(110, null, 100) = 100);
  perform pg_temp.must_be('a half rounds up: 10 × 1.025 gives 10.5', public.suggest_score(10, 1.025, 100) = 10.5);
  perform pg_temp.must_be('75.5 × 0.987 gives 74.5', public.suggest_score(75.5, 0.987, 100) = 74.5);
  perform pg_temp.must_be('80 × 0.632 gives 50.5', public.suggest_score(80, 0.632, 100) = 50.5);
  perform pg_temp.must_be('nothing scored, nothing suggested', public.suggest_score(null, 1, 100) is null);
end $$;

-- ------------------------------------------------------ saving (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  v_cs uuid := (select v from fx where k='crit_s');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot score',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cb, 30)));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('every criterion must be scored',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board,
           jsonb_build_array(jsonb_build_object('criterion_id', v_ca, 'points', 50))::text));
  perform pg_temp.must_refuse('a criterion from another project is refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cs, 30)));
  perform pg_temp.must_refuse('quarter points are refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50.25, v_cb, 30)));
  perform pg_temp.must_refuse('a hundredth that would round to a whole point is refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50.04, v_cb, 30)));
  perform pg_temp.must_refuse('points above the maximum are refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 61, v_cb, 30)));
  perform pg_temp.must_refuse('confirming before scoring is refused',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 0, v_b, 0, v_c, 0)));
  perform pg_temp.must_allow('the professor scores the board',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cb, 30)));
  perform pg_temp.must_be('and the scores are stored',
    (select sum(points) from public.board_scores where board_id = v_board) = 80);
end $$;

-- ------------------------------------------- confirming with peer factors (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_round uuid;
  s record;
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('with no final round, everyone''s suggestion is the group score',
    (select bool_and(suggested_now = 80 and factor is null) from public.score_sheet(v_proj)));

  perform public.open_peer_round(v_proj, 'final', now() + interval '2 days');
  select id into v_round from public.peer_rounds where project_id = v_proj and kind = 'final';
  perform pg_temp.act_as(v_a);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 5, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_b);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a final round still open gives no factor',
    (select bool_and(factor is null and suggested_now = 80) from public.score_sheet(v_proj)));

  perform pg_temp.must_refuse('a confirm must cover the whole group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           jsonb_build_array(jsonb_build_object('student_id', v_a, 'final', 80))::text));
  perform pg_temp.must_refuse('a confirm cannot name someone outside the group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80, v_b, 80, v_d, 80)));
  perform pg_temp.must_refuse('a final above the total is refused',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 101, v_b, 80, v_c, 80)));
  perform pg_temp.must_refuse('a final must be whole or half points',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80.3, v_b, 80, v_c, 80)));
  perform pg_temp.must_allow('the professor confirms while the round is open',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80, v_b, 80, v_c, 70)));

  select * into s from public.score_sheet(v_proj) where student_id = v_c;
  perform pg_temp.must_be('a changed final is marked overridden', s.overridden and s.final = 70);
  perform pg_temp.must_be('and nothing has changed under it yet', not s.suggestion_changed);

  perform public.close_peer_round(v_round);
  perform pg_temp.must_be('closing the final round sets the factors (a 1.263, b 1.105, c 0.632)',
    (select factor from public.score_sheet(v_proj) where student_id = v_a) = 1.263
    and (select factor from public.score_sheet(v_proj) where student_id = v_b) = 1.105
    and (select factor from public.score_sheet(v_proj) where student_id = v_c) = 0.632);
  perform pg_temp.must_be('and the suggestions follow (84, 84, 50.5)',
    (select suggested_now from public.score_sheet(v_proj) where student_id = v_a) = 84
    and (select suggested_now from public.score_sheet(v_proj) where student_id = v_b) = 84
    and (select suggested_now from public.score_sheet(v_proj) where student_id = v_c) = 50.5);
  perform pg_temp.must_be('so every earlier confirm reads "suggestion changed"',
    (select bool_and(suggestion_changed) from public.score_sheet(v_proj)));

  perform pg_temp.must_allow('the professor confirms the suggestions',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 50.5)));
  perform pg_temp.must_be('now nothing is overridden or stale',
    (select bool_and(not overridden and not suggestion_changed) from public.score_sheet(v_proj)));
  perform pg_temp.must_be('and the factor used is kept with the score',
    (select factor from public.member_scores where board_id = v_board and student_id = v_a) = 1.263);
  perform pg_temp.must_allow('the professor raises c''s score',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 55)));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('each confirm that changed a final is in the history',
    (select count(*) from public.score_history
      where board_id = v_board and student_id = v_c and action = 'confirm') = 3);

  -- Somebody joins the group after the confirm.
  insert into public.group_members (group_id, set_id, student_id)
  values ((select v from fx where k='group'), (select v from fx where k='set'), v_d);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('after a join, the old list no longer covers the group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 55)));
  perform pg_temp.must_be('the newcomer shows up unconfirmed, with no factor',
    exists (select 1 from public.score_sheet(v_proj)
             where student_id = v_d and confirmed_at is null and factor is null and suggested_now = 80));
  perform pg_temp.must_be('and everyone else''s factor is unchanged',
    (select factor from public.score_sheet(v_proj) where student_id = v_a) = 1.263);
  perform pg_temp.act_as_service();
  delete from public.group_members where group_id = (select v from fx where k='group') and student_id = v_d;
end $$;

-- ------------------------------------------------------- release (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  g jsonb;
  n int;
  expected int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('before release a student has no grade', public.my_grade(v_proj) is null);
  perform pg_temp.must_be('and no peer summary', public.my_peer_summary(v_proj) is null);
  perform pg_temp.must_refuse('a student cannot release grades',
    format('select public.release_project_scores(%L)', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor releases grades',
    format('select public.release_project_scores(%L)', v_proj));

  perform pg_temp.act_as_service();
  select count(*) into n from public.notifications where project_id = v_proj and type = 'grades_released';
  select count(*) into expected from public.notification_prefs np
   where np.announcements and np.user_id in (v_a, v_b, v_c);
  perform pg_temp.must_be('release tells each confirmed student who has announcements on', n = expected);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('releasing again tells nobody twice',
    public.release_project_scores(v_proj) = 0);

  perform pg_temp.act_as(v_a);
  g := public.my_grade(v_proj);
  perform pg_temp.must_be('a sees 84 of 100 from a group score of 80',
    (g ->> 'final')::numeric = 84 and (g ->> 'total_points')::int = 100
    and (g ->> 'group_total')::numeric = 80 and (g ->> 'in_group')::boolean);
  perform pg_temp.must_be('with the rubric breakdown, in order',
    jsonb_array_length(g -> 'criteria') = 2
    and (g -> 'criteria' -> 0 ->> 'points')::numeric = 50
    and (g -> 'criteria' -> 1 ->> 'points')::numeric = 30
    and (g -> 'criteria' -> 1 ->> 'max_points')::int = 40);
  perform pg_temp.must_be('and how teammates saw them: 4.00 from 2 raters, team 3.17',
    (g -> 'peer' ->> 'raters')::int = 2
    and (g -> 'peer' -> 'me' ->> 'contributes')::numeric = 4.00
    and (g -> 'peer' -> 'team' ->> 'contributes')::numeric = 3.17);
  perform pg_temp.must_be('a''s grade carries the factor 1.263 and is not overridden',
    (g ->> 'factor')::numeric = 1.263 and not (g ->> 'overridden')::boolean);

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_be('c sees the overridden 55',
    (public.my_grade(v_proj) ->> 'final')::numeric = 55);
  perform pg_temp.must_be('and c''s grade says it was overridden',
    (public.my_grade(v_proj) ->> 'overridden')::boolean);
  perform pg_temp.act_as(v_d);
  perform pg_temp.must_be('a classmate outside the group has no grade here',
    public.my_grade(v_proj) is null);

  -- Changing a criterion after release.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can still correct a criterion after release',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 55, v_cb, 30)));
  perform pg_temp.must_be('which marks the confirmed scores as stale',
    (select suggestion_changed from public.score_sheet(v_proj) where student_id = v_a));
  perform pg_temp.act_as(v_a);
  g := public.my_grade(v_proj);
  perform pg_temp.must_be('the student sees the new breakdown and keeps the confirmed score',
    (g ->> 'group_total')::numeric = 85 and (g ->> 'final')::numeric = 84);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor unreleases',
    format('select public.unrelease_project_scores(%L)', v_proj));
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('and the grade is hidden again', public.my_grade(v_proj) is null);
end $$;

-- ------------------------------------------- a student who changes groups (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_set uuid := (select v from fx where k='set');
  v_g1 uuid := (select v from fx where k='group');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  v_g2 uuid;
  v_board2 uuid;
  n int;
  expected int;
begin
  -- c moves from the confirmed group to a new one with d.
  perform pg_temp.act_as_service();
  insert into public.groups (set_id, name) values (v_set, 'zz-score-group-2') returning id into v_g2;
  delete from public.group_members where group_id = v_g1 and student_id = v_c;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g2, v_set, v_c), (v_g2, v_set, v_d);
  perform public.ensure_project_boards(v_proj);
  select id into v_board2 from public.project_boards where project_id = v_proj and group_id = v_g2;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor scores the new group''s board',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board2, pg_temp.pts(v_ca, 40, v_cb, 20)));
  perform pg_temp.must_be('c and d have no factor there, so the suggestion is the group score',
    (select bool_and(suggested_now = 60 and factor is null) from public.score_sheet(v_proj) where board_id = v_board2));
  perform pg_temp.must_allow('and confirms c and d',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board2,
           jsonb_build_array(jsonb_build_object('student_id', v_c, 'final', 60),
                             jsonb_build_object('student_id', v_d, 'final', 60))::text));
  perform pg_temp.must_be('c''s old confirm on the first board is still stored',
    exists (select 1 from public.member_scores where board_id = v_board and student_id = v_c));

  -- Release from a clean slate of notifications.
  perform pg_temp.act_as_service();
  delete from public.notifications where project_id = v_proj and type = 'grades_released';
  perform pg_temp.act_as(v_prof);
  perform public.release_project_scores(v_proj);

  perform pg_temp.act_as_service();
  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'grades_released' and user_id = v_c;
  select count(*) into expected from public.notification_prefs np
   where np.announcements and np.user_id = v_c;
  perform pg_temp.must_be('a student who moved is notified once, not once per board', n = expected);
  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'grades_released';
  select count(*) into expected from public.notification_prefs np
   where np.announcements and np.user_id in (v_a, v_b, v_c, v_d);
  perform pg_temp.must_be('and each current member is notified once', n = expected);

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_be('c sees the new group''s 60, not the old board''s 55',
    (public.my_grade(v_proj) ->> 'final')::numeric = 60);
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('and a still sees the first board''s 84',
    (public.my_grade(v_proj) ->> 'final')::numeric = 84);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('re-confirming the first board drops c, who left it',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           jsonb_build_array(jsonb_build_object('student_id', v_a, 'final', 84),
                             jsonb_build_object('student_id', v_b, 'final', 84))::text));
  perform pg_temp.must_be('and the history records c''s 55 going',
    not exists (select 1 from public.member_scores where board_id = v_board and student_id = v_c)
    and exists (select 1 from public.score_history
                 where board_id = v_board and student_id = v_c and action = 'confirm'
                   and old_value = 55 and new_value is null));

  -- Put everything back for the blocks below.
  perform pg_temp.act_as_service();
  delete from public.score_releases where project_id = v_proj;
  delete from public.notifications where project_id = v_proj and type = 'grades_released';
  delete from public.member_scores where board_id = v_board2;
  delete from public.board_scores where board_id = v_board2;
  delete from public.project_boards where id = v_board2;
  delete from public.group_members where group_id = v_g2;
  delete from public.groups where id = v_g2;
  insert into public.group_members (group_id, set_id, student_id) values (v_g1, v_set, v_c);
end $$;

-- ------------------------------------------------- an individual board (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_solo uuid := (select v from fx where k='solo');
  v_sb uuid := (select v from fx where k='solo_board');
  v_cs uuid := (select v from fx where k='crit_s');
begin
  perform pg_temp.act_as(v_prof);
  perform public.save_board_scores(v_sb,
    jsonb_build_array(jsonb_build_object('criterion_id', v_cs, 'points', 45)));
  perform pg_temp.must_allow('an individual board confirms with no list',
    format('select public.confirm_member_scores(%L, ''[]''::jsonb)', v_sb));
  perform pg_temp.must_be('its one student gets the board total, with no factor',
    exists (select 1 from public.member_scores
             where board_id = v_sb and student_id = v_a and final = 45
               and factor is null and not overridden));
  perform pg_temp.must_allow('the professor rescores the individual board after confirming',
    format('select public.save_board_scores(%L, %L::jsonb)', v_sb,
           jsonb_build_array(jsonb_build_object('criterion_id', v_cs, 'points', 40))::text));
  perform pg_temp.must_be('which marks its confirmed 45 as stale',
    (select suggestion_changed and final = 45 and suggested_now = 40
       from public.score_sheet(v_solo) where board_id = v_sb));

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_solo;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived project''s scores cannot change',
    format('select public.save_board_scores(%L, %L::jsonb)', v_sb,
           jsonb_build_array(jsonb_build_object('criterion_id', v_cs, 'points', 40))::text));
  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_solo;
end $$;

-- ------------------------------------------------------- clearing (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_cb uuid := (select v from fx where k='crit_b');
begin
  perform pg_temp.act_as(v_prof);
  perform public.release_project_scores(v_proj);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot clear scores',
    format('select public.clear_project_scores(%L)', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor clears the project''s scores',
    format('select public.clear_project_scores(%L)', v_proj));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('every score and confirm on the project is gone',
    not exists (select 1 from public.board_scores where board_id = v_board)
    and not exists (select 1 from public.member_scores where board_id = v_board));
  perform pg_temp.must_be('the release went with them',
    not exists (select 1 from public.score_releases where project_id = v_proj));
  perform pg_temp.must_be('the history kept everything and recorded the clear',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'clear')
    and exists (select 1 from public.score_history where project_id = v_proj and action = 'confirm'));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('clearing unlocks the rubric',
    format('update public.project_criteria set max_points = 45 where id = %L', v_cb));
  perform pg_temp.act_as_service();
  update public.project_criteria set max_points = 40 where id = v_cb;
end $$;

-- ------------------------------------------- the rubric write path (Task 4)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  same_points text := '[{"label":"zz-Function, again","description":"x","max_points":60},'
                      '{"label":"zz-Docs","description":"y","max_points":40}]';
  new_points text := '[{"label":"zz-Function","description":"x","max_points":50},'
                     '{"label":"zz-Docs","description":"y","max_points":50}]';
  one_row text := '[{"label":"zz-Function","description":"x","max_points":60}]';
  p public.projects%rowtype;
  msg text;
begin
  perform pg_temp.act_as(v_prof);
  perform public.save_board_scores(v_board, pg_temp.pts(v_ca, 50, v_cb, 30)::jsonb);

  perform pg_temp.must_allow('a scored rubric can be reworded through the edit path',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, same_points));
  perform pg_temp.must_be('and each criterion keeps its id, so its score still points at it',
    (select label from public.project_criteria where id = v_ca) = 'zz-Function, again'
    and (select count(*) from public.board_scores where board_id = v_board) = 2);
  perform pg_temp.must_refuse('new points on a scored rubric are refused',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, new_points));
  perform pg_temp.must_refuse('dropping a criterion from a scored rubric is refused',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, one_row));

  select * into p from public.projects where id = v_proj;
  begin
    perform public.update_project_series(
      array[v_proj], p.title, p.type, p.type_label, p.guidelines, p.start_week, p.end_week,
      p.total_points, p.due_at, p.release_at, new_points::jsonb);
    msg := null;
  exception when others then
    msg := sqlerrm;
  end;
  perform pg_temp.must_be('a project edit that changes scored points names the section and the reason',
    msg like '%·%' and msg like '%Scores exist%');

  begin
    execute format('delete from public.groups where id = %L', (select v from fx where k='group'));
    msg := null;
  exception when others then
    msg := sqlerrm;
  end;
  perform pg_temp.must_be('the professor cannot delete a scored group, and is told why',
    msg like '%has scores. Clear them first, or archive the group instead.');
  perform pg_temp.must_refuse('nor wipe it by re-saving the set''s arrangement',
    format('select public.save_group_arrangement(%L, ''[]''::jsonb)', (select v from fx where k='set')));
  perform pg_temp.must_be('and the group and its scores are still there',
    exists (select 1 from public.groups where id = (select v from fx where k='group'))
    and (select count(*) from public.board_scores where board_id = v_board) = 2);

  perform public.clear_project_scores(v_proj);
  perform pg_temp.must_allow('once cleared, the points change',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, new_points));
  perform pg_temp.must_be('in place, keeping the ids',
    (select max_points from public.project_criteria where id = v_ca) = 50
    and (select max_points from public.project_criteria where id = v_cb) = 50);
  perform pg_temp.must_allow('and a criterion can be dropped',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, one_row));
  perform pg_temp.must_be('leaving just the first',
    (select count(*) from public.project_criteria where project_id = v_proj) = 1
    and exists (select 1 from public.project_criteria where id = v_ca));
end $$;

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
