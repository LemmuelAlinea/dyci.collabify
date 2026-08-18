-- Deadline enforcement — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs <this file>
--
-- Every assertion prints PASS or aborts the whole run.

begin;

-- ------------------------------------------------------------------ fixture

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
  -- reset role does not clear the claims, so blank them explicitly
  perform set_config('request.jwt.claims', '', true);
end;
$$;

/** Runs a statement and asserts it is refused. */
create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/** Runs a statement and asserts it is allowed. */
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

do $$
declare
  v_class uuid;
  v_prof  uuid;
  v_a     uuid;
  v_b     uuid;
  v_set   uuid;
  v_group uuid;
  v_proj  uuid;
  v_board uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
   limit 1;

  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-deadline-fixture', 'manual') returning id into v_set;

  insert into public.groups (set_id, name) values (v_set, 'Fixture group')
  returning id into v_group;

  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  -- Deadline in the future to begin with; individual tests move it.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience,
     group_set_id, due_at)
  values (v_class, v_prof, 'zz-deadline-fixture', 'activity', 1, 2, 'group',
          v_set, now() + interval '7 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Late one',   10, v_prof, 'professor') returning id into t1;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'On time',    10, v_prof, 'professor') returning id into t2;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Locked one', 10, v_prof, 'professor') returning id into t3;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Unclaimed',  10, v_prof, 'professor') returning id into t4;

  -- Filler, so the board totals 80 and the fair share is 40 each. Without it
  -- the cap is 20 and student A cannot hold the three tasks these tests need.
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_board, 'Filler ' || g, 10, v_prof, 'professor'
    from generate_series(1, 4) g;

  -- Student A claims three of them. A professor cannot insert task_assignees,
  -- so the claims are made as the student.
  perform pg_temp.act_as(v_a);
  insert into public.task_assignees (task_id, student_id) values (t1, v_a);
  insert into public.task_assignees (task_id, student_id) values (t2, v_a);
  insert into public.task_assignees (task_id, student_id) values (t3, v_a);
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('class', v_class), ('prof', v_prof), ('a', v_a), ('b', v_b),
    ('proj', v_proj), ('board', v_board),
    ('t1', t1), ('t2', t2), ('t3', t3), ('t4', t4);

  raise notice 'fixture ready — project % board %', v_proj, v_board;
end $$;

-- ------------------------------------------------------- a passed deadline

-- The whole point of the design: past due does not stop the work.
update public.projects set due_at = now() - interval '1 day'
 where id = (select v from fx where k = 'proj');

do $$
declare v_a uuid := (select v from fx where k='a');
        t1 uuid := (select v from fx where k='t1');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow(
    'student finishes a task after the deadline',
    format('update public.project_tasks set status = ''done'' where id = %L', t1));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and it is stamped late',
    (select late from public.project_tasks where id = t1));
end $$;

-- An extension afterwards must not launder the record.
update public.projects set due_at = now() + interval '30 days'
 where id = (select v from fx where k = 'proj');

do $$
begin
  perform pg_temp.must_be('a later extension leaves the stamp alone',
    (select late from public.project_tasks where id = (select v from fx where k='t1')));
end $$;

-- Finishing inside the (now extended) deadline is not late.
do $$
declare v_a uuid := (select v from fx where k='a');
        t2 uuid := (select v from fx where k='t2');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('student finishes a task on time',
    format('update public.project_tasks set status = ''done'' where id = %L', t2));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and it is not late',
    (select not late from public.project_tasks where id = t2));
end $$;

-- Reopening clears the verdict; there is nothing finished to judge.
do $$
declare v_a uuid := (select v from fx where k='a');
        t1 uuid := (select v from fx where k='t1');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('student reopens the late task',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t1));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and the late stamp is cleared',
    (select not late from public.project_tasks where id = t1));
end $$;

-- Claiming still works while merely past deadline.
update public.projects set due_at = now() - interval '1 day'
 where id = (select v from fx where k = 'proj');

do $$
declare v_b uuid := (select v from fx where k='b');
        t4 uuid := (select v from fx where k='t4');
begin
  perform pg_temp.act_as(v_b);
  perform pg_temp.must_allow('a claim past the deadline is still allowed',
    format('insert into public.task_assignees (task_id, student_id) values (%L, %L)',
           t4, v_b));
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- the lock

-- Controls first. Each of these is attempted again once the project is locked,
-- so a refusal below is provably the lock and not some pre-existing guard —
-- a worklog entry on a `todo` task, for instance, is refused either way.
do $$
declare v_a uuid := (select v from fx where k='a');
        t3 uuid := (select v from fx where k='t3');
begin
  perform pg_temp.act_as(v_a);

  perform pg_temp.must_allow('control: student starts the task',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t3));

  perform pg_temp.must_allow('control: student attaches a file while open',
    format('insert into public.task_files (task_id, uploaded_by, file_path, file_name)
            values (%L, %L, ''x/before.pdf'', ''before.pdf'')', t3, v_a));

  perform pg_temp.must_allow('control: student logs work while open',
    format('insert into public.task_worklog (task_id, student_id, minutes)
            values (%L, %L, 15)', t3, v_a));

  perform pg_temp.must_allow('control: student adds a task while open',
    format('insert into public.project_tasks (board_id, title, weight, created_by, author_role)
            values (%L, ''added while open'', 5, %L, ''student'')',
           (select v from fx where k='board'), v_a));

  perform pg_temp.act_as_service();
end $$;

update public.projects set locked_at = now()
 where id = (select v from fx where k = 'proj');

do $$
declare v_a uuid := (select v from fx where k='a');
        v_b uuid := (select v from fx where k='b');
        v_prof uuid := (select v from fx where k='prof');
        t2 uuid := (select v from fx where k='t2');
        t3 uuid := (select v from fx where k='t3');
        t4 uuid := (select v from fx where k='t4');
begin
  perform pg_temp.act_as(v_a);

  perform pg_temp.must_refuse('locked: student cannot move a task',
    format('update public.project_tasks set status = ''done'' where id = %L', t3));

  perform pg_temp.must_refuse('locked: student cannot retitle a task',
    format('update public.project_tasks set title = ''nope'' where id = %L', t3));

  perform pg_temp.must_refuse('locked: student cannot attach a file',
    format('insert into public.task_files (task_id, uploaded_by, file_path, file_name)
            values (%L, %L, ''x/y.pdf'', ''y.pdf'')', t3, v_a));

  perform pg_temp.must_refuse('locked: student cannot log work',
    format('insert into public.task_worklog (task_id, student_id, minutes)
            values (%L, %L, 30)', t3, v_a));

  perform pg_temp.must_refuse('locked: student cannot add a task',
    format('insert into public.project_tasks (board_id, title, weight, created_by, author_role)
            values (%L, ''sneaked in'', 5, %L, ''student'')',
           (select v from fx where k='board'), v_a));

  perform pg_temp.must_refuse('locked: student cannot hand a task back',
    format('delete from public.task_assignees where task_id = %L and student_id = %L',
           t3, v_a));

  -- Discussion is deliberately left open.
  perform pg_temp.must_allow('locked: student can still comment',
    format('insert into public.task_comments (task_id, author_id, body)
            values (%L, %L, ''Handing this in late, sorry'')', t3, v_a));

  perform pg_temp.act_as(v_b);
  perform pg_temp.must_refuse('locked: another student cannot claim',
    format('insert into public.task_assignees (task_id, student_id) values (%L, %L)',
           t2, v_b));

  -- The professor is exempt: closing has to be undoable from the inside.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('locked: the professor can still move a task',
    format('update public.project_tasks set status = ''done'' where id = %L', t3));

  perform pg_temp.act_as_service();
end $$;

-- Reopening gives the board back.
update public.projects set locked_at = null
 where id = (select v from fx where k = 'proj');

do $$
declare v_a uuid := (select v from fx where k='a');
        t3 uuid := (select v from fx where k='t3');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('reopened: the student can work again',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t3));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ views

do $$
declare v_board uuid := (select v from fx where k='board');
        v_late int;
begin
  perform pg_temp.act_as_service();
  update public.projects set due_at = now() - interval '1 day'
   where id = (select v from fx where k = 'proj');

  perform pg_temp.act_as((select v from fx where k='a'));
  update public.project_tasks set status = 'done'
   where id = (select v from fx where k='t1');
  perform pg_temp.act_as_service();

  select late_count into v_late from public.task_board_overview where id = v_board;
  perform pg_temp.must_be('task_board_overview counts the late task', v_late >= 1);

  select late_count into v_late from public.task_member_progress
   where board_id = v_board and student_id = (select v from fx where k='a');
  perform pg_temp.must_be('task_member_progress counts it for the student', v_late >= 1);
end $$;

rollback;
