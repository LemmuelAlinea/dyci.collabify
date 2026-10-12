-- Analytics over time — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/analytics-trends.test.sql
--
-- Each figure is checked against the base tables it is counted from, so a view
-- that drifts from what is really there fails here, not on a professor's screen.

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
  v_task uuid; v_board uuid; v_class uuid; v_prof uuid; v_stud uuid; v_out uuid;
begin
  -- A live task held by an active member, in a live class: the smallest
  -- fixture every view below has something to say about.
  select t.id, t.board_id, p.class_id, c.professor_id, a.student_id
    into v_task, v_board, v_class, v_prof, v_stud
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.classes c on c.id = p.class_id
    join public.class_members m
      on m.class_id = c.id and m.student_id = a.student_id and m.status = 'active'
   where t.archived_at is null and p.archived_at is null and c.archived_at is null
   order by t.created_at
   limit 1;

  select id into v_out from public.profiles
   where role = 'student' and id not in (
     select student_id from public.class_members where class_id = v_class)
   limit 1;

  -- No term floor, so the fixed-date event below is inside the window.
  update public.classes set term_start = null where id = v_class;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('task', v_task), ('board', v_board), ('class', v_class),
    ('prof', v_prof), ('stud', v_stud), ('out', v_out);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------- activity

-- 17:30 UTC is 01:30 the next morning in Manila. The day is the Manila day.
do $$
declare
  n int;
begin
  insert into public.task_events (task_id, actor_id, kind, at)
  values ((select v from fx where k='task'), (select v from fx where k='stud'),
          'commented', '2026-03-01 17:30:00+00');

  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(a.n), 0) into n from public.analytics_daily_activity a
   where a.board_id = (select v from fx where k='board')
     and a.actor_id = (select v from fx where k='stud')
     and a.kind = 'commented' and a.day = date '2026-03-02';
  perform pg_temp.must_be('an event at 01:30 Manila lands on the Manila day', n >= 1);
  perform pg_temp.act_as_service();
end $$;

-- Every event an active student made on a live task in the class is counted
-- exactly once.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  got int; want int;
begin
  select count(*) into want
    from public.task_events e
    join public.project_tasks t on t.id = e.task_id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.class_members cm on cm.class_id = p.class_id
                                and cm.student_id = e.actor_id
                                and cm.status = 'active'
   where p.class_id = v_class and t.archived_at is null and p.archived_at is null;

  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(n), 0) into got
    from public.analytics_daily_activity where class_id = v_class;
  perform pg_temp.must_be('daily activity adds up to the events it is built from', got = want);
  perform pg_temp.act_as_service();
end $$;

-- The professor's own actions are not group activity.
do $$
declare
  v_board uuid := (select v from fx where k='board');
  before_n int; after_n int;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(n), 0) into before_n from public.analytics_daily_activity
   where board_id = v_board and kind = 'commented' and day = date '2026-03-05';
  perform pg_temp.act_as_service();

  insert into public.task_events (task_id, actor_id, kind, at)
  values ((select v from fx where k='task'), (select v from fx where k='prof'),
          'commented', '2026-03-05 04:00:00+00');

  perform pg_temp.act_as((select v from fx where k='prof'));
  select coalesce(sum(n), 0) into after_n from public.analytics_daily_activity
   where board_id = v_board and kind = 'commented' and day = date '2026-03-05';
  perform pg_temp.must_be('a professor event is not counted as group activity',
    after_n = before_n);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- roster

do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_stud uuid := (select v from fx where k='stud');
  want int; r public.analytics_student_roster%rowtype;
  v_at timestamptz := clock_timestamp();
begin
  select count(*) into want
    from public.task_assignees a
    join public.project_tasks t on t.id = a.task_id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where p.class_id = v_class and a.student_id = v_stud
     and t.archived_at is null and p.archived_at is null;

  insert into public.task_events (task_id, actor_id, kind, at)
  values ((select v from fx where k='task'), v_stud, 'started', v_at);

  perform pg_temp.act_as((select v from fx where k='prof'));
  select * into r from public.analytics_student_roster
   where class_id = v_class and student_id = v_stud;
  perform pg_temp.must_be('the roster counts every live task a student holds', r.held = want);
  perform pg_temp.must_be('...never more done than held', r.done <= r.held);
  perform pg_temp.must_be('...never more late than done', r.late <= r.done);
  perform pg_temp.must_be('group_names is never null', r.group_names is not null);
  perform pg_temp.must_be('last active is their latest event', r.last_active_at >= v_at);
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- cycles

do $$
declare
  v_board uuid := (select v from fx where k='board');
  want int; got int;
begin
  select count(*) into want from public.board_results
   where board_id = v_board and verdict = 'returned';
  perform pg_temp.act_as((select v from fx where k='prof'));
  select returns into got from public.analytics_board_cycles where board_id = v_board;
  perform pg_temp.must_be('returns count every return in the history, not just the latest',
    got = want);
  select count(*) into got from public.analytics_board_cycles where decision_hours < 0;
  perform pg_temp.must_be('a decision never comes before its hand-in', got = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- milestones and sprints

do $$
declare
  n int;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.analytics_milestones where done > tasks;
  perform pg_temp.must_be('a milestone never has more done than it has', n = 0);
  select count(*) into n from public.analytics_sprints
   where done > tasks or done_in_window > done;
  perform pg_temp.must_be('a sprint never finishes more in its window than it finished', n = 0);
  select count(*) into n from public.task_state where created_at is null;
  perform pg_temp.must_be('every task in task_state carries when it was created', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- who sees

do $$
declare
  v_class uuid := (select v from fx where k='class');
  who text; v_user uuid; n int;
begin
  foreach who in array array['stud', 'out'] loop
    v_user := (select v from fx where k = who);
    perform pg_temp.act_as(v_user);
    select (select count(*) from public.analytics_daily_activity where class_id = v_class)
         + (select count(*) from public.analytics_student_roster where class_id = v_class)
         + (select count(*) from public.analytics_board_cycles where class_id = v_class)
         + (select count(*) from public.analytics_milestones where class_id = v_class)
         + (select count(*) from public.analytics_sprints where class_id = v_class)
      into n;
    perform pg_temp.must_be(format('%s reads no trend analytics of the class', who), n = 0);
    perform pg_temp.act_as_service();
  end loop;
end $$;

-- An archived class leaves every trend view.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select (select count(*) from public.analytics_daily_activity where class_id = v_class)
       + (select count(*) from public.analytics_student_roster where class_id = v_class)
       + (select count(*) from public.analytics_board_cycles where class_id = v_class)
       + (select count(*) from public.analytics_milestones where class_id = v_class)
       + (select count(*) from public.analytics_sprints where class_id = v_class)
    into n;
  perform pg_temp.must_be('an archived class leaves every trend view', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
