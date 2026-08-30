-- Handing in a whole project — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/submissions.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement
-- before the board is submitted. Without that the suite proves nothing: most of
-- these statements can also be refused by guards that were already there.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  t_open uuid; t_free uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     -- A class the planner picked at random used to be enough. It is not:
     -- an unordered `limit 1` handed back an empty class one day and the
     -- fixtures failed on a null student. Ordered, and it must have people.
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;

  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a
   order by student_id limit 1;
  select student_id into v_out from public.class_members
   where class_id = v_class and status = 'active' and student_id not in (v_a, v_b)
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-submit-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Fixture group')
  returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience,
     group_set_id, due_at)
  values (v_class, v_prof, 'zz-submit-fixture', 'activity', 1, 2, 'group',
          v_set, now() + interval '7 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Held by A', 10, v_prof, 'professor') returning id into t_open;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Nobody has this', 10, v_prof, 'professor') returning id into t_free;

  -- Filler so the fair share is wide enough for the claims below.
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_board, 'Filler ' || g, 10, v_prof, 'professor' from generate_series(1, 6) g;

  perform pg_temp.act_as(v_a);
  insert into public.task_assignees (task_id, student_id) values (t_open, v_a);
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('out', v_out),
    ('proj', v_proj), ('board', v_board), ('open', t_open), ('free', t_free);

  raise notice 'fixture ready — board %', v_board;
end $$;

-- ------------------------------------------- controls, before handing in

do $$
declare
  v_a uuid := (select v from fx where k='a');
  t_open uuid := (select v from fx where k='open');
  t_free uuid := (select v from fx where k='free');
begin
  perform pg_temp.act_as(v_a);

  perform pg_temp.must_allow('control: a member starts a task',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t_open));
  perform pg_temp.must_allow('control: a member attaches a file',
    format('insert into public.task_files (task_id, uploaded_by, file_path, file_name)
            values (%L, %L, ''x/before.pdf'', ''before.pdf'')', t_open, v_a));
  perform pg_temp.must_allow('control: a member logs work',
    format('insert into public.task_worklog (task_id, student_id, minutes)
            values (%L, %L, 20)', t_open, v_a));
  perform pg_temp.must_allow('control: a member claims a free task',
    format('insert into public.task_assignees (task_id, student_id) values (%L, %L)',
           t_free, v_a));
  perform pg_temp.must_allow('control: a member adds a task',
    format('insert into public.project_tasks (board_id, title, weight, created_by, author_role)
            values (%L, ''added while open'', 5, %L, ''student'')',
           (select v from fx where k='board'), v_a));
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- handing in

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_out uuid := (select v from fx where k='out');
  v_board uuid := (select v from fx where k='board');
begin
  -- Somebody not on the board cannot hand its work in.
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse('a non-member cannot submit',
    format('select public.set_board_submitted(%L, true)', v_board));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('a member submits the board',
    format('select public.set_board_submitted(%L, true)', v_board));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('it is marked submitted',
    (select submitted_at is not null from public.project_boards where id = v_board));
  perform pg_temp.must_be('...and records who pressed it',
    (select submitted_by = v_a from public.project_boards where id = v_board));
  perform pg_temp.must_be('...and the console view carries it',
    (select submitted_at is not null and submitted_by_name is not null
       from public.task_board_overview where id = v_board));
end $$;

-- --------------------------------------------------- what a submission freezes

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
  t_open uuid := (select v from fx where k='open');
  t_free uuid := (select v from fx where k='free');
begin
  perform pg_temp.act_as(v_a);

  perform pg_temp.must_refuse('submitted: cannot move a task',
    format('update public.project_tasks set status = ''done'' where id = %L', t_open));
  perform pg_temp.must_refuse('submitted: cannot attach a file',
    format('insert into public.task_files (task_id, uploaded_by, file_path, file_name)
            values (%L, %L, ''x/after.pdf'', ''after.pdf'')', t_open, v_a));
  perform pg_temp.must_refuse('submitted: cannot log work',
    format('insert into public.task_worklog (task_id, student_id, minutes)
            values (%L, %L, 30)', t_open, v_a));
  perform pg_temp.must_refuse('submitted: cannot add a task',
    format('insert into public.project_tasks (board_id, title, weight, created_by, author_role)
            values (%L, ''sneaked in'', 5, %L, ''student'')', v_board, v_a));
  perform pg_temp.must_refuse('submitted: cannot hand a task back',
    format('delete from public.task_assignees where task_id = %L and student_id = %L',
           t_free, v_a));
  perform pg_temp.must_refuse('submitted: cannot ask for a reassignment',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''release'', ''too late now'')', t_open));

  perform pg_temp.act_as(v_b);
  perform pg_temp.must_refuse('submitted: another member cannot claim',
    format('insert into public.task_assignees (task_id, student_id) values (%L, %L)',
           (select id from public.project_tasks
             where board_id = v_board and title like 'Filler %' limit 1), v_b));

  -- The whole point of the exception: handing in is when feedback starts.
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('submitted: a member can still comment',
    format('insert into public.task_comments (task_id, author_id, body)
            values (%L, %L, ''Submitted — happy to explain any of this'')', t_open, v_a));

  -- The professor is never frozen out by the group's own word.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('submitted: the professor can still move a task',
    format('update public.project_tasks set status = ''done'' where id = %L', t_open));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ taking it back

do $$
declare
  v_b uuid := (select v from fx where k='b');
  v_a uuid := (select v from fx where k='a');
  v_board uuid := (select v from fx where k='board');
  t_open uuid := (select v from fx where k='open');
begin
  -- Any member, not only whoever pressed it.
  perform pg_temp.act_as(v_b);
  perform pg_temp.must_allow('another member takes the submission back',
    format('select public.set_board_submitted(%L, false)', v_board));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('the board is open again',
    (select submitted_at is null and submitted_by is null
       from public.project_boards where id = v_board));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('and the work moves again',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t_open));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------- the professor's close outranks it

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('control: a member can submit while the project is open',
    format('select public.set_board_submitted(%L, true)', v_board));
  perform pg_temp.act_as_service();

  update public.projects set locked_at = now() where id = (select v from fx where k='proj');

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('closed: a member cannot take the submission back',
    format('select public.set_board_submitted(%L, false)', v_board));

  -- But the professor can free one board without reopening the whole project.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('closed: the professor can still unsubmit a board',
    format('select public.set_board_submitted(%L, false)', v_board));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and that board really is open again',
    (select submitted_at is null from public.project_boards where id = v_board));

  update public.projects set locked_at = null where id = (select v from fx where k='proj');
end $$;

-- Pressing submit twice is not an error, and does not rewrite when it happened.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_board uuid := (select v from fx where k='board');
  first_at timestamptz;
begin
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.act_as_service();
  select submitted_at into first_at from public.project_boards where id = v_board;

  perform pg_temp.act_as(v_b);
  perform pg_temp.must_allow('submitting an already-submitted board is a no-op',
    format('select public.set_board_submitted(%L, true)', v_board));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and the original time and name stand',
    (select submitted_at = first_at and submitted_by = v_a
       from public.project_boards where id = v_board));
end $$;

rollback;
