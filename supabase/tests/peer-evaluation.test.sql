-- Peer evaluation — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
--
-- Every refusal is paired with a control that succeeds. The averages are checked
-- against a hand computation on three students with known ratings:
--   a rates a=5 b=4 c=2 · b rates a=4 b=4 c=2 · c rates a=4 b=3 c=5
-- (each number is all five dimensions). Received, self excluded:
--   a = (4+4)/2 = 4.0 · b = (4+3)/2 = 3.5 · c = (2+2)/2 = 2.0

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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Everyone in the order (a, b, c) rated with one score across all five dimensions. */
create or replace function pg_temp.ratings(
  p_a uuid, s_a int, p_b uuid, s_b int, p_c uuid, s_c int, p_note text default ''
) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ratee_id', p_a, 'contributes', s_a, 'interacts', s_a, 'on_track', s_a,
                       'quality', s_a, 'skills', s_a, 'comment', ''),
    jsonb_build_object('ratee_id', p_b, 'contributes', s_b, 'interacts', s_b, 'on_track', s_b,
                       'quality', s_b, 'skills', s_b, 'comment', ''),
    jsonb_build_object('ratee_id', p_c, 'contributes', s_c, 'interacts', s_c, 'on_track', s_c,
                       'quality', s_c, 'skills', s_c, 'comment', p_note)
  );
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_solo uuid; v_board uuid;
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
  values (v_class, 'zz-peer-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-peer-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b), (v_g, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-peer-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-peer-solo', 'activity', 1, 2, 'individual', now() + interval '5 days')
  returning id into v_solo;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('proj', v_proj), ('solo', v_solo), ('board', v_board), ('group', v_g);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------ opening rounds

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_solo uuid := (select v from fx where k='solo');
  v_round uuid;
  n int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot open a round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a round must close in the future',
    format('select public.open_peer_round(%L, ''check_in'', now() - interval ''1 hour'')', v_proj));
  perform pg_temp.must_refuse('an individual project has no peer evaluation',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_solo));
  perform pg_temp.must_allow('the professor opens a check-in round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_proj));
  perform pg_temp.must_refuse('only one round is open at a time',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''2 days'')', v_proj));

  select id into v_round from public.peer_rounds where project_id = v_proj;
  perform pg_temp.act_as_service();
  insert into fx values ('round', v_round);

  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'peer_round_opened';
  perform pg_temp.must_be('opening tells the group (those with deadline reminders on)',
    n = (select count(*) from public.notification_prefs np
          where np.deadline_reminders
            and np.user_id in ((select v from fx where k='a'), (select v from fx where k='b'),
                               (select v from fx where k='c'))));
  if exists (select 1 from public.notification_prefs np
              where np.deadline_reminders
                and np.user_id in ((select v from fx where k='a'), (select v from fx where k='b'),
                                   (select v from fx where k='c'))) then
    perform pg_temp.must_be('and at least one student was actually told', n >= 1);
  else
    raise notice 'skipped: no fixture student has deadline reminders on';
  end if;
  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'peer_round_opened'
     and user_id = (select v from fx where k='d');
  perform pg_temp.must_be('someone outside the group is not told', n = 0);
end $$;

-- ------------------------------------------------------- a scheduled project

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_g uuid := (select v from fx where k='group');
  v_set uuid;
  v_class uuid;
  v_sched uuid;
  v_round uuid;
  v_err text;
  n int;
begin
  select g.set_id, s.class_id into v_set, v_class
    from public.groups g join public.group_sets s on s.id = g.set_id where g.id = v_g;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-peer-scheduled', 'activity', 1, 2, 'group', v_set,
          now() + interval '5 days', now() + interval '3 days')
  returning id into v_sched;
  perform public.ensure_project_boards(v_sched);

  perform pg_temp.act_as(v_prof);
  begin
    perform public.open_peer_round(v_sched, 'check_in', now() + interval '2 days');
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.must_be('an unreleased project opens no round',
    v_err like 'This project isn''t released yet%');
  perform pg_temp.act_as_service();
  select count(*) into n from public.notifications
   where project_id = v_sched and type = 'peer_round_opened';
  perform pg_temp.must_be('and nobody is told about one', n = 0);

  -- A round that exists anyway (written straight to the table) stays out of reach.
  insert into public.peer_rounds (project_id, kind, closes_at)
  values (v_sched, 'check_in', now() + interval '2 days') returning id into v_round;
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.peer_rounds where project_id = v_sched;
  perform pg_temp.must_be('a member cannot see a round on an unreleased project', n = 0);
  perform pg_temp.must_be('and gets no form', public.peer_form(v_sched) is null);
  perform pg_temp.must_refuse('and cannot rate on it',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)));
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.peer_rounds where project_id = v_sched;
  perform pg_temp.must_be('control: the professor still sees it', n = 1);
  perform pg_temp.act_as_service();
  delete from public.peer_rounds where id = v_round;
end $$;

-- ------------------------------------------------------------ saving ratings

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_prof uuid := (select v from fx where k='prof');
  v_round uuid := (select v from fx where k='round');
  n int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a half-filled form is refused',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      jsonb_build_array(jsonb_build_object('ratee_id', v_a, 'contributes', 5, 'interacts', 5,
        'on_track', 5, 'quality', 5, 'skills', 5))));
  perform pg_temp.must_refuse('a score outside 1 to 5 is refused',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 6, v_b, 4, v_c, 2)));
  perform pg_temp.must_allow('a rates everyone, themselves included',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 5, v_b, 4, v_c, 2, 'zz-quiet in meetings')));

  perform pg_temp.must_refuse('a rating with a dimension missing is refused',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      (select jsonb_agg(e - 'skills') from jsonb_array_elements(
         pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)) e)));
  perform pg_temp.must_refuse('a student cannot send a reminder',
    format('select public.remind_peer_round(%L)', v_round));
  perform pg_temp.must_refuse('a student cannot move the close date',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));

  perform pg_temp.act_as(v_d);
  perform pg_temp.must_refuse('someone outside the group cannot rate it',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)));

  -- Reminders reach only the two who have not answered.
  perform pg_temp.act_as(v_prof);
  select public.remind_peer_round(v_round) into n;
  perform pg_temp.must_be('a reminder reaches only those who have not rated everyone', n = 2);
  perform pg_temp.must_refuse('one reminder a day',
    format('select public.remind_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_b);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));

  -- Saving again replaces, it does not duplicate.
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));
  perform pg_temp.act_as_service();
  select count(*) into n from public.peer_ratings where round_id = v_round;
  perform pg_temp.must_be('nine ratings, one per pair', n = 9);
end $$;

-- ---------------------------------------------------------------- who sees what

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid := (select v from fx where k='round');
  n int;
begin
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.peer_ratings where round_id = v_round;
  perform pg_temp.must_be('a rater reads their own three ratings and no others', n = 3);

  perform pg_temp.act_as(v_b);
  select count(*) into n from public.peer_ratings
   where round_id = v_round and ratee_id = v_b and rater_id <> v_b;
  perform pg_temp.must_be('nobody reads what teammates said about them', n = 0);
  select count(*) into n from public.peer_results where round_id = v_round;
  perform pg_temp.must_be('a student reads no results', n = 0);
  select count(*) into n from public.peer_comments where round_id = v_round;
  perform pg_temp.must_be('a student reads no comments', n = 0);
  select count(*) into n from public.peer_round_status where id = v_round;
  perform pg_temp.must_be('a student reads no round progress', n = 0);
  select count(*) into n from public.peer_rounds where project_id = v_proj;
  perform pg_temp.must_be('a group member can see the round exists', n = 1);

  perform pg_temp.act_as(v_d);
  select count(*) into n from public.peer_rounds where project_id = v_proj;
  perform pg_temp.must_be('someone outside the group cannot see the round', n = 0);
  perform pg_temp.must_be('and gets no form', public.peer_form(v_proj) is null);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a member gets their form with the whole team',
    jsonb_array_length(public.peer_form(v_proj) -> 'team') = 3);
  perform pg_temp.must_be('and their own saved ratings',
    jsonb_array_length(public.peer_form(v_proj) -> 'ratings') = 3);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ the arithmetic

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_round uuid := (select v from fx where k='round');
  ra public.peer_results%rowtype; rb public.peer_results%rowtype; rc public.peer_results%rowtype;
  st public.peer_round_status%rowtype;
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select * into ra from public.peer_results where round_id = v_round and student_id = v_a;
  select * into rb from public.peer_results where round_id = v_round and student_id = v_b;
  select * into rc from public.peer_results where round_id = v_round and student_id = v_c;

  perform pg_temp.must_be('a received 4.0 from two raters', ra.received_avg = 4.0 and ra.raters = 2);
  perform pg_temp.must_be('b received 3.5', rb.received_avg = 3.5);
  perform pg_temp.must_be('c received 2.0', rc.received_avg = 2.0);
  perform pg_temp.must_be('c rated themselves 5', rc.self_avg = 5.0);
  perform pg_temp.must_be('c gave others 3.5 on average', rc.given_avg = 3.5);
  perform pg_temp.must_be('raters disagree about b by a full point', rb.received_spread = 1.0);
  perform pg_temp.must_be('and agree about a', ra.received_spread = 0);
  perform pg_temp.must_be('per-dimension averages follow', rc.contributes_avg = 2.0);
  perform pg_temp.must_be('everyone answered', ra.rated_all and rb.rated_all and rc.rated_all);
  perform pg_temp.must_be('team of three', ra.team_size = 3);

  select * into st from public.peer_round_status where id = v_round;
  perform pg_temp.must_be('progress reads 3 of 3', st.expected = 3 and st.answered = 3 and st.is_open);

  select count(*) into n from public.peer_comments where round_id = v_round;
  perform pg_temp.must_be('the professor reads the one comment, with its rater', n = 1
    and (select rater_id from public.peer_comments where round_id = v_round) = v_a);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- the audience stays put

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_err text;
  n int;
begin
  perform pg_temp.act_as(v_prof);
  begin
    perform public.set_project_audience(v_proj, 'individual', null);
  exception when others then v_err := sqlerrm;
  end;
  perform pg_temp.must_be('a project with peer ratings cannot change its audience',
    v_err = 'This project has a peer evaluation. Its audience can''t change now.');
  perform pg_temp.act_as_service();
  select count(*) into n from public.peer_ratings pr
    join public.project_boards b on b.id = pr.board_id where b.project_id = v_proj;
  perform pg_temp.must_be('and its ratings are all still there', n = 9);
end $$;

-- ---------------------------------------------------------------- closing

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid := (select v from fx where k='round');
  v_final uuid;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot close a round',
    format('select public.close_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can move the close date',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));
  perform pg_temp.must_allow('the professor closes it early',
    format('select public.close_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a closed round takes no more ratings',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)));
  perform pg_temp.must_be('and offers no form', public.peer_form(v_proj) is null);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a closed round cannot be moved',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));

  -- A closed project still takes a final round: that is when it usually runs.
  perform pg_temp.act_as_service();
  update public.projects set locked_at = now() where id = v_proj;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('a closed project can still open its final round',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''3 days'')', v_proj));
  select id into v_final from public.peer_rounds where project_id = v_proj and kind = 'final';
  perform public.close_peer_round(v_final);
  perform pg_temp.must_refuse('a project has one final round',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''3 days'')', v_proj));

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived project opens no round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''3 days'')', v_proj));
  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_proj;
end $$;

-- ----------------------------------------------------------- someone leaves

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  v_g uuid := (select v from fx where k='group');
  v_round uuid := (select v from fx where k='round');
  ra public.peer_results%rowtype; rb public.peer_results%rowtype;
  v_b uuid := (select v from fx where k='b');
  n int;
begin
  delete from public.group_members where group_id = v_g and student_id = v_c;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.peer_results where round_id = v_round and student_id = v_c;
  perform pg_temp.must_be('someone who left drops out of the results', n = 0);
  select * into ra from public.peer_results where round_id = v_round and student_id = v_a;
  perform pg_temp.must_be('and their ratings of others no longer count',
    ra.raters = 1 and ra.received_avg = 4.0 and ra.team_size = 2);
  select * into rb from public.peer_results where round_id = v_round and student_id = v_b;
  perform pg_temp.must_be('and the others recompute: b keeps only the rating of 4 from a',
    rb.raters = 1 and rb.received_avg = 4.0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ a group of one

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_g uuid := (select v from fx where k='group');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid;
begin
  delete from public.group_members where group_id = v_g and student_id = v_b;
  perform pg_temp.act_as(v_prof);
  perform public.open_peer_round(v_proj, 'check_in', now() + interval '2 days');
  select id into v_round from public.peer_rounds
   where project_id = v_proj and kind = 'check_in' and closed_at is null;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('alone in a group there is nobody to rate',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      jsonb_build_array(jsonb_build_object('ratee_id', v_a, 'contributes', 3, 'interacts', 3,
        'on_track', 3, 'quality', 3, 'skills', 3, 'comment', ''))));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ an archived project

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_g uuid := (select v from fx where k='group');
  v_set uuid;
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid;
  v_ok jsonb;
begin
  -- Put b back so the open round has a team of two and a can rate.
  select set_id into v_set from public.groups where id = v_g;
  insert into public.group_members (group_id, set_id, student_id) values (v_g, v_set, v_b);
  select id into v_round from public.peer_rounds
   where project_id = v_proj and kind = 'check_in' and closed_at is null;
  v_ok := jsonb_build_array(
    jsonb_build_object('ratee_id', v_a, 'contributes', 3, 'interacts', 3, 'on_track', 3,
                       'quality', 3, 'skills', 3, 'comment', ''),
    jsonb_build_object('ratee_id', v_b, 'contributes', 4, 'interacts', 4, 'on_track', 4,
                       'quality', 4, 'skills', 4, 'comment', ''));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('control: a member rates on the open round',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round, v_ok));
  perform pg_temp.must_be('control: the form is offered', public.peer_form(v_proj) is not null);

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('an archived project takes no ratings',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round, v_ok));
  perform pg_temp.must_be('and offers no form', public.peer_form(v_proj) is null);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived project cannot be reminded',
    format('select public.remind_peer_round(%L)', v_round));
  perform pg_temp.must_refuse('an archived project cannot move its close date',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));
  perform pg_temp.must_refuse('an archived project cannot close its round',
    format('select public.close_peer_round(%L)', v_round));

  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_proj;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('restored, the form is back', public.peer_form(v_proj) is not null);

  -- An archived group drops out: no board, no form.
  perform pg_temp.act_as_service();
  update public.groups set archived_at = now() where id = v_g;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a member of an archived group gets no form', public.peer_form(v_proj) is null);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('and the group leaves the results',
    not exists (select 1 from public.peer_results where round_id = v_round));
  perform pg_temp.act_as_service();
  update public.groups set archived_at = null where id = v_g;
  perform pg_temp.act_as_service();
end $$;

rollback;
