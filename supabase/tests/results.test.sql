-- Answering what was handed in — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/results.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.

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

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_g1 uuid; v_proj uuid; v_board uuid; t1 uuid;
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
   where class_id=v_class and status='active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id=v_class and status='active' and student_id<>v_a order by student_id limit 1;

  insert into public.group_sets (class_id,name,mode)
  values (v_class,'zz-result-fixture','manual') returning id into v_set;
  insert into public.groups (set_id,name) values (v_set,'Result group') returning id into v_g1;
  insert into public.group_members (group_id,set_id,student_id) values (v_g1,v_set,v_a);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-result-proj','activity',1,2,'group',v_set, now()+interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id=v_proj limit 1;

  insert into public.project_tasks (board_id,title,weight,created_by,author_role)
  values (v_board,'zz-result-task',10,v_prof,'professor') returning id into t1;

  -- Only the people on a task move it, so the member has to hold it before the
  -- assertions below can tell a freeze apart from that older rule.
  perform pg_temp.act_as(v_a);
  insert into public.task_assignees (task_id, student_id) values (t1, v_a);
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof',v_prof),('a',v_a),('b',v_b),('proj',v_proj),('board',v_board),('task',t1);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------- nothing to answer before hand-in

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('cannot answer work that was never handed in',
    format('select public.record_board_result(%L, ''accepted''::public.result_verdict, '''')',
           v_board));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ who may

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);

  -- The group cannot mark its own work.
  perform pg_temp.must_refuse('a member cannot answer their own board',
    format('select public.record_board_result(%L, ''accepted''::public.result_verdict, '''')',
           v_board));

  perform pg_temp.act_as(v_b);
  perform pg_temp.must_refuse('nor can somebody from another class group',
    format('select public.record_board_result(%L, ''accepted''::public.result_verdict, '''')',
           v_board));
  perform pg_temp.act_as_service();
end $$;

-- A return has to say why; an acceptance does not have to.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a return with no reason is refused',
    format('select public.record_board_result(%L, ''returned''::public.result_verdict, ''  '')',
           v_board));

  perform pg_temp.must_allow('the professor returns it, with a reason',
    format('select public.record_board_result(%L, ''returned''::public.result_verdict, %L)',
           v_board, 'Chapter 3 is missing its sampling method. Add it and hand in again.'));
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------- returning gives the board back

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_board uuid := (select v from fx where k='board');
  t1 uuid := (select v from fx where k='task');
begin
  perform pg_temp.must_be('returning un-submits the board',
    (select submitted_at is null from public.project_boards where id = v_board));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('...so the group can work on it again',
    format('update public.project_tasks set status = ''in_progress'' where id = %L', t1));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('the group was told',
    exists (select 1 from public.notifications
             where user_id = v_a and type = 'result_recorded'));
end $$;

-- ------------------------------------------------- accepting leaves it frozen

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
  t1 uuid := (select v from fx where k='task');
begin
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor accepts it, no words needed',
    format('select public.record_board_result(%L, ''accepted''::public.result_verdict, '''')',
           v_board));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('accepting leaves it handed in',
    (select submitted_at is not null from public.project_boards where id = v_board));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('...so the work stays frozen',
    format('update public.project_tasks set status = ''done'' where id = %L', t1));
  perform pg_temp.act_as_service();
end $$;

-- -------------------------------------------------------- reading the answer

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
  n int; v text;
begin
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.board_results where board_id = v_board;
  perform pg_temp.must_be('the group reads its own answers', n = 2);

  select verdict into v from public.board_result_overview where board_id = v_board;
  perform pg_temp.must_be('the standing answer is the newest one', v = 'accepted');

  select answer_count into n from public.board_result_overview where board_id = v_board;
  perform pg_temp.must_be('...and the earlier one is still on the record', n = 2);

  perform pg_temp.act_as(v_b);
  select count(*) into n from public.board_results where board_id = v_board;
  perform pg_temp.must_be('somebody else''s group reads nothing', n = 0);

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.board_results where board_id = v_board;
  perform pg_temp.must_be('the professor reads them', n = 2);
  perform pg_temp.act_as_service();
end $$;

-- Results are never written by hand, only through the function.
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_board uuid := (select v from fx where k='board');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot insert an answer directly',
    format('insert into public.board_results (board_id, verdict, feedback)
            values (%L, ''accepted''::public.result_verdict, '''')', v_board));

  -- Not even the professor: the function keeps the board in step with the row.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('nor the professor, outside the function',
    format('insert into public.board_results (board_id, verdict, feedback)
            values (%L, ''accepted''::public.result_verdict, '''')', v_board));
  perform pg_temp.act_as_service();
end $$;

rollback;
