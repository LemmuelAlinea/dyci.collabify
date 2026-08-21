-- Why the work is behind, and what to do about it — rolled back, touches
-- nothing permanently.
--
--   node scripts/db.mjs supabase/tests/insight.test.sql
--
-- Every "the rule fires" assertion is paired with a control on the same fixture
-- seconds later, where the condition is taken away and the rule stops firing.
-- Without the pair the suite lies: a rule that never fires at all would pass a
-- one-sided "it is not firing now" check with the whole feature deleted.

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

/** Does this rule fire for the fixture board, and with what number. */
create or replace function pg_temp.fires(p_kind text, p_board uuid) returns int
language sql as $$
  select coalesce(max(n), -1)::int from public.class_actions
   where kind = p_kind and board_id = p_board;
$$;

/** The same, for a rule whose subject is a person rather than a board. */
create or replace function pg_temp.fires_for(p_kind text, p_student uuid) returns int
language sql as $$
  select coalesce(max(n), -1)::int from public.class_actions
   where kind = p_kind and student_id = p_student;
$$;

/**
 * Age everything on a board, the way a fortnight of nobody touching it would.
 *
 * The touch trigger rewrites updated_at on every update, so a plain backdate is
 * a silent no-op — the same trap that made `late` impossible to backfill.
 */
create or replace function pg_temp.age_board(p_board uuid, p_days int) returns void
language plpgsql as $$
begin
  alter table public.project_tasks disable trigger project_tasks_touch;
  update public.project_tasks
     set updated_at = now() - (p_days || ' days')::interval
   where board_id = p_board;
  alter table public.project_tasks enable trigger project_tasks_touch;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_class uuid; v_prof uuid;
  v_a uuid; v_b uuid; v_c uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and c.term_start is not null
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 4
   limit 1;

  -- Three on the board, one deliberately left off every group in the class.
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a
   order by student_id limit 1;
  select student_id into v_c from public.class_members
   where class_id = v_class and status = 'active' and student_id not in (v_a, v_b)
   order by student_id limit 1;
  select student_id into v_out from public.class_members
   where class_id = v_class and status = 'active' and student_id not in (v_a, v_b, v_c)
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-insight-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Insight group')
  returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b), (v_group, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience,
     group_set_id, due_at)
  values (v_class, v_prof, 'zz-insight-fixture', 'activity', 1, 2, 'group',
          v_set, now() + interval '10 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values
    ('class', v_class), ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c),
    ('out', v_out), ('set', v_set), ('group', v_group), ('proj', v_proj),
    ('board', v_board);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------- an empty board, then work

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a released board with no tasks asks for work',
    pg_temp.fires('empty_board', v_board) >= 0);
  perform pg_temp.must_be('...and cannot also be short of claims',
    pg_temp.fires('unclaimed_work', v_board) = -1);
  perform pg_temp.act_as_service();

  -- Six tasks of ten, so the board totals sixty and a half of it is three.
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_board, 'zz task ' || g, 10, v_prof, 'professor' from generate_series(1, 6) g;

  perform pg_temp.act_as(v_prof);
  -- The control: the same rule, on the same board, once the condition is gone.
  perform pg_temp.must_be('putting tasks on it stops the empty-board notice',
    pg_temp.fires('empty_board', v_board) = -1);
  perform pg_temp.must_be('...and six unclaimed tasks are now the finding',
    pg_temp.fires('unclaimed_work', v_board) = 6);
  perform pg_temp.must_be('nothing has been started on it',
    (select never_started from public.board_diagnosis where board_id = v_board));
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- claiming

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  t uuid[];
begin
  select array_agg(id order by title) into t
    from public.project_tasks where board_id = v_board;

  -- A takes three, B two, C one: everything held, nobody empty-handed.
  insert into public.task_assignees (task_id, student_id)
  values (t[1], v_a), (t[2], v_a), (t[3], v_a), (t[4], v_b), (t[5], v_b), (t[6], v_c);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('claiming every task clears the unclaimed finding',
    pg_temp.fires('unclaimed_work', v_board) = -1);
  perform pg_temp.must_be('...and nobody is carrying the group',
    pg_temp.fires_for('carrying_alone', v_a) = -1);
  perform pg_temp.act_as_service();

  -- C hands their one back: A now holds half the board and C holds nothing.
  delete from public.task_assignees where task_id = t[6] and student_id = v_c;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('half a board held while a groupmate holds nothing is a finding',
    pg_temp.fires_for('carrying_alone', v_a) = 50);
  perform pg_temp.must_be('...and the diagnosis names the holder',
    (select top_holder_id = v_a and members_holding_nothing = 1
       from public.board_diagnosis where board_id = v_board));
  perform pg_temp.act_as_service();

  -- The control: give C work back and the same board stops being a finding,
  -- even though A still holds exactly half of it.
  insert into public.task_assignees (task_id, student_id) values (t[6], v_c);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a full board is not carrying-alone at the same 50%',
    pg_temp.fires_for('carrying_alone', v_a) = -1);
  perform pg_temp.must_be('...and holding nothing is nobody now',
    pg_temp.fires_for('holding_nothing', v_c) = -1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ overdue work

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
  t1 uuid;
begin
  select id into t1 from public.project_tasks where board_id = v_board order by title limit 1;
  update public.project_tasks set due_at = now() - interval '2 days' where id = t1;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a task past its date and still open is a finding',
    pg_temp.fires('overdue_work', v_board) = 1);
  perform pg_temp.act_as_service();

  update public.project_tasks set status = 'done', done_at = now() where id = t1;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('finishing it clears the finding, late or not',
    pg_temp.fires('overdue_work', v_board) = -1);
  perform pg_temp.act_as_service();

  -- Put it back for the rules below, which are about a board still in flight.
  update public.project_tasks set status = 'todo', done_at = null, due_at = null where id = t1;
end $$;

-- ---------------------------------------------------------- going quiet

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
  t1 uuid;
begin
  perform pg_temp.age_board(v_board, 10);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('ten days with nothing moving is a stall',
    pg_temp.fires('stalled_board', v_board) = 10);
  perform pg_temp.must_be('...and the diagnosis counts the same days',
    (select idle_days = 10 from public.board_diagnosis where board_id = v_board));
  perform pg_temp.act_as_service();

  -- The control: one touch, and the same board is not stalled.
  select id into t1 from public.project_tasks where board_id = v_board order by title limit 1;
  update public.project_tasks set title = title || ' (edited)' where id = t1;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('one edit takes it off the stalled list',
    pg_temp.fires('stalled_board', v_board) = -1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- a return nobody acted on

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
  t1 uuid;
begin
  perform pg_temp.age_board(v_board, 10);
  insert into public.board_results (board_id, verdict, feedback, decided_by, decided_at)
  values (v_board, 'returned', 'The second half is missing', v_prof,
          clock_timestamp() - interval '5 days');

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a return nothing has moved on since is a finding',
    pg_temp.fires('returned_untouched', v_board) = 5);
  perform pg_temp.must_be('...and the diagnosis says so too',
    (select returned_untouched from public.board_diagnosis where board_id = v_board));
  perform pg_temp.act_as_service();

  -- The control: the group starts fixing it, and the finding goes.
  select id into t1 from public.project_tasks where board_id = v_board order by title limit 1;
  update public.project_tasks set details = 'reworked' where id = t1;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('touching the work clears the returned finding',
    pg_temp.fires('returned_untouched', v_board) = -1);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------- what happens when somebody leaves

/**
 * There is no "orphaned work" rule, and this is why.
 *
 * Removing a class member drops their group memberships, and that fires
 * `group_members_release_tasks`, which puts everything they held back to
 * unclaimed. Work cannot be stranded with somebody who has gone — it reappears
 * as unclaimed, which is where a professor would look for it anyway.
 *
 * A rule for a state the product cannot reach is dead code that reads like a
 * safety net, so the chain is asserted here instead.
 */
do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  v_c uuid := (select v from fx where k='c');
  held int;
begin
  select count(*) into held from public.task_assignees a
    join public.project_tasks t on t.id = a.task_id
   where t.board_id = v_board and a.student_id = v_c;
  perform pg_temp.must_be('the member about to leave is holding work', held = 1);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('and nothing on the board is unclaimed yet',
    pg_temp.fires('unclaimed_work', v_board) = -1);
  perform pg_temp.act_as_service();

  update public.class_members set status = 'removed', removed_at = now()
   where class_id = v_class and student_id = v_c;

  select count(*) into held from public.task_assignees a
    join public.project_tasks t on t.id = a.task_id
   where t.board_id = v_board and a.student_id = v_c;
  perform pg_temp.must_be('removing them takes their claims with them', held = 0);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('their work comes back as unclaimed, not stranded',
    pg_temp.fires('unclaimed_work', v_board) = 1);
  perform pg_temp.act_as_service();

  -- Put them back so the rules below see a whole group again.
  update public.class_members set status = 'active', removed_at = null
   where class_id = v_class and student_id = v_c;
end $$;

-- ------------------------------------------------ a request nobody ruled on

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  t1 uuid; req uuid;
begin
  select t.id into t1 from public.project_tasks t
    join public.task_assignees x on x.task_id = t.id and x.student_id = v_a
   where t.board_id = v_board limit 1;

  insert into public.task_reassignments
    (task_id, requested_by, from_student, wants, reason, created_at)
  values (t1, v_b, v_a, 'take_over', 'A has not started it and I have time',
          now() - interval '3 days')
  returning id into req;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a request waiting three days is a finding',
    pg_temp.fires('pending_reassignment', v_board) = 3);
  perform pg_temp.must_be('...and the board diagnosis counts it as pending',
    (select reassignments_pending = 1 from public.board_diagnosis where board_id = v_board));
  perform pg_temp.act_as_service();

  -- The control: the same request, asked this morning, is not yet a finding.
  update public.task_reassignments set created_at = now() where id = req;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a request asked today is not yet late',
    pg_temp.fires('pending_reassignment', v_board) = -1);
  perform pg_temp.act_as_service();

  update public.task_reassignments set status = 'withdrawn' where id = req;
end $$;

-- ------------------------------------------------------------- a pile-up

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  v_week date := date_trunc('week', (current_date + 14)::timestamptz)::date;
  v_n int; t uuid[];
begin
  select array_agg(id order by title) into t
    from public.project_tasks where board_id = v_board;

  -- Four in one week: heavy, but not the threshold.
  update public.project_tasks
     set due_at = (v_week + 2)::timestamptz
   where id = any (array[t[1], t[2], t[3], t[4]]);

  perform pg_temp.act_as(v_prof);
  select coalesce(max(a.n), -1) into v_n from public.class_actions a
   where a.kind = 'deadline_pile_up' and a.class_id = v_class and a.at::date = v_week;
  perform pg_temp.must_be('four tasks in a week is not yet a pile-up', v_n = -1);

  select due_count into v_n from public.deadline_pressure
   where class_id = v_class and week_start = v_week;
  perform pg_temp.must_be('...though the week still counts them', v_n = 4);
  perform pg_temp.act_as_service();

  update public.project_tasks set due_at = (v_week + 2)::timestamptz where id = t[5];

  perform pg_temp.act_as(v_prof);
  select coalesce(max(a.n), -1) into v_n from public.class_actions a
   where a.kind = 'deadline_pile_up' and a.class_id = v_class and a.at::date = v_week;
  perform pg_temp.must_be('the fifth makes it one', v_n = 5);
  perform pg_temp.act_as_service();

  update public.project_tasks set due_at = null where board_id = v_board;
end $$;

-- ---------------------------------------------------------- participation

do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  v_group uuid := (select v from fx where k='group');
  v_set uuid := (select v from fx where k='set');
  v_a uuid := (select v from fx where k='a');
  v_out uuid := (select v from fx where k='out');
  r public.class_participation%rowtype;
begin
  perform pg_temp.act_as(v_prof);
  select * into r from public.class_participation
   where class_id = v_class and student_id = v_a;
  perform pg_temp.must_be('a working member is counted holding work', r.tasks_held >= 3);
  perform pg_temp.must_be('...and is in a group', r.in_any_group);
  perform pg_temp.act_as_service();

  -- Take the outsider out of every group this class runs.
  delete from public.group_members gm
   using public.groups g, public.group_sets gs
   where gm.group_id = g.id and g.set_id = gs.id
     and gs.class_id = v_class and gm.student_id = v_out;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a student in no group of the class is a finding',
    pg_temp.fires_for('not_in_a_group', v_out) = 0);
  perform pg_temp.act_as_service();

  -- The control: put them in a group, and the finding goes.
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_out);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('putting them in a group clears it',
    pg_temp.fires_for('not_in_a_group', v_out) = -1);
  perform pg_temp.must_be('...and they now show as holding nothing instead',
    pg_temp.fires_for('holding_nothing', v_out) = 0);
  perform pg_temp.act_as_service();
end $$;

-- -------------------------------------------------------------- who sees

-- The same rule as analytics.sql, and the reason is the same: nearly everything
-- here counts what is missing, and a student cannot see what they are not shown.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_out uuid := (select v from fx where k='out');
  v_board uuid := (select v from fx where k='board');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.board_diagnosis where board_id = v_board;
  perform pg_temp.must_be('the professor reads the diagnosis of their own board', n = 1);
  select count(*) into n from public.class_actions;
  perform pg_temp.must_be('...and has recommendations to read', n > 0);

  perform pg_temp.act_as(v_a);
  select count(*) into n from public.board_diagnosis;
  perform pg_temp.must_be('a student on the board reads no diagnosis of it', n = 0);
  select count(*) into n from public.class_participation;
  perform pg_temp.must_be('...nor who else is holding nothing', n = 0);
  select count(*) into n from public.deadline_pressure;
  perform pg_temp.must_be('...nor the class deadline pile', n = 0);
  select count(*) into n from public.class_actions;
  perform pg_temp.must_be('...nor a single recommendation', n = 0);

  perform pg_temp.act_as(v_out);
  select count(*) into n from public.class_actions;
  perform pg_temp.must_be('somebody outside the work reads none of it either', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- An archived project drops out of the diagnosis: it is not work to chase.
do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_proj uuid := (select v from fx where k='proj');
  n int;
begin
  update public.projects set archived_at = now() where id = v_proj;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.board_diagnosis where board_id = v_board;
  perform pg_temp.must_be('an archived project leaves the diagnosis', n = 0);
  select count(*) into n from public.class_actions where board_id = v_board;
  perform pg_temp.must_be('...and takes its recommendations with it', n = 0);

  -- The control: bring it back, and both return.
  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_proj;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.board_diagnosis where board_id = v_board;
  perform pg_temp.must_be('restoring it brings the board back', n = 1);
  perform pg_temp.act_as_service();
end $$;

rollback;
