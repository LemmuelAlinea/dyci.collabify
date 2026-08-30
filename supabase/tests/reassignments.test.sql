-- Reassignment requests — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/reassignments.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- Without that the suite lies: a refusal can come from a guard that was already
-- there, and would still "pass" with this whole feature deleted.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
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
  v_class uuid; v_prof uuid;
  v_a uuid; v_b uuid; v_c uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  t_neglected uuid; t_done uuid; t_spare uuid; t_cap uuid;
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

  -- Three on the board, one deliberately left off it.
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
  values (v_class, 'zz-reassign-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Fixture group')
  returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b), (v_group, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience,
     group_set_id, due_at)
  values (v_class, v_prof, 'zz-reassign-fixture', 'activity', 1, 2, 'group',
          v_set, now() + interval '7 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'The neglected one', 10, v_prof, 'professor') returning id into t_neglected;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Already finished',  10, v_prof, 'professor') returning id into t_done;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Spare',             10, v_prof, 'professor') returning id into t_spare;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Cap filler',        10, v_prof, 'professor') returning id into t_cap;

  -- Filler so the board totals 90 and each of three carries 30 — enough for the
  -- claims below without the fair-share cap refusing the fixture.
  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  select v_board, 'Filler ' || g, 10, v_prof, 'professor' from generate_series(1, 5) g;

  -- B holds the neglected task and has started it: the case nothing could fix.
  perform pg_temp.act_as(v_b);
  insert into public.task_assignees (task_id, student_id) values (t_neglected, v_b);
  update public.project_tasks set status = 'in_progress' where id = t_neglected;

  -- B also finished one, to prove a done task is not reassignable.
  insert into public.task_assignees (task_id, student_id) values (t_done, v_b);
  update public.project_tasks set status = 'done' where id = t_done;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('out', v_out),
    ('proj', v_proj), ('board', v_board),
    ('neglected', t_neglected), ('done', t_done), ('spare', t_spare), ('cap', t_cap);

  raise notice 'fixture ready — project %', v_proj;
end $$;

-- --------------------------------------------------------------- requesting

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_out uuid := (select v from fx where k='out');
  t_neg uuid := (select v from fx where k='neglected');
  t_done uuid := (select v from fx where k='done');
begin
  -- Someone not on the board cannot ask about its work.
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse('a non-member cannot request',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''take_over'', ''not mine to ask about'')', t_neg));

  perform pg_temp.act_as(v_a);

  -- A finished task has nothing to hand over.
  perform pg_temp.must_refuse('cannot request on a finished task',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''take_over'', ''already done'')', t_done));

  -- The case the whole feature exists for: a started task held by someone else.
  perform pg_temp.must_allow('a member requests on a started task',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''take_over'', ''B has not touched this in two weeks and we cannot submit without it'')',
           t_neg));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and it recorded who held it',
    (select from_student = (select v from fx where k='b')
       from public.task_reassignments where task_id = t_neg));
  perform pg_temp.must_be('...and it is pending, whatever was sent',
    (select status = 'pending' from public.task_reassignments where task_id = t_neg));
end $$;

-- A student cannot smuggle an approval in through the insert.
do $$
declare v_a uuid := (select v from fx where k='a');
        t_spare uuid := (select v from fx where k='spare');
begin
  perform pg_temp.act_as(v_a);
  insert into public.task_reassignments (task_id, wants, reason, status)
  values (t_spare, 'take_over', 'trying it on', 'approved');
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('an insert claiming to be approved lands pending',
    (select status = 'pending' from public.task_reassignments where task_id = t_spare));

  delete from public.task_reassignments where task_id = t_spare;
end $$;

-- Only one live request per task.
do $$
declare v_c uuid := (select v from fx where k='c');
        t_neg uuid := (select v from fx where k='neglected');
begin
  perform pg_temp.act_as(v_c);
  perform pg_temp.must_refuse('a second pending request on the same task',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''release'', ''same problem'')', t_neg));
  perform pg_temp.act_as_service();
end $$;

-- A closed project takes no new requests; reopening lets them through again.
do $$
declare v_a uuid := (select v from fx where k='a');
        t_spare uuid := (select v from fx where k='spare');
begin
  update public.projects set locked_at = now() where id = (select v from fx where k='proj');
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('locked project refuses a request',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''take_over'', ''let me in'')', t_spare));
  perform pg_temp.act_as_service();

  update public.projects set locked_at = null where id = (select v from fx where k='proj');
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('reopened, the same request is allowed',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''take_over'', ''let me in'')', t_spare));
  perform pg_temp.act_as_service();
  delete from public.task_reassignments where task_id = t_spare;
end $$;

-- An individual project has one owner and nobody to hand anything to.
do $$
declare
  v_class uuid; v_prof uuid; v_a uuid;
  v_proj uuid; v_board uuid; t_solo uuid;
begin
  perform pg_temp.act_as_service();
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
  v_a := (select v from fx where k='a');

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-reassign-solo', 'activity', 1, 2, 'individual',
          now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);

  select id into v_board from public.project_boards
   where project_id = v_proj and student_id = v_a;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role)
  values (v_board, 'Solo work', 10, v_prof, 'professor') returning id into t_solo;

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('an individual board cannot ask for a hand-over',
    format('insert into public.task_reassignments (task_id, wants, reason)
            values (%L, ''release'', ''i cannot finish this'')', t_solo));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ reading

do $$
declare
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_a uuid := (select v from fx where k='a');
  v_prof uuid := (select v from fx where k='prof');
  t_neg uuid := (select v from fx where k='neglected');
  n int;
begin
  -- The person it is about cannot read what was written about them.
  perform pg_temp.act_as(v_b);
  select count(*) into n from public.task_reassignments where task_id = t_neg;
  perform pg_temp.must_be('the current holder cannot read the request', n = 0);

  -- Nor can an uninvolved groupmate.
  perform pg_temp.act_as(v_c);
  select count(*) into n from public.task_reassignments where task_id = t_neg;
  perform pg_temp.must_be('another groupmate cannot read it', n = 0);

  -- The person who wrote it can.
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.task_reassignments where task_id = t_neg;
  perform pg_temp.must_be('the requester reads their own', n = 1);

  -- And the professor, who has to decide.
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.task_reassignments where task_id = t_neg;
  perform pg_temp.must_be('the professor reads it', n = 1);

  select count(*) into n from public.reassignment_overview where task_id = t_neg;
  perform pg_temp.must_be('...and it comes through the console view', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- ----------------------------------------------------------------- deciding

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_prof uuid := (select v from fx where k='prof');
  t_neg uuid := (select v from fx where k='neglected');
  req uuid;
begin
  select id into req from public.task_reassignments where task_id = t_neg;

  -- The requester cannot approve their own.
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot decide',
    format('select public.decide_reassignment(%L, true)', req));

  -- Nor can the holder decline it to save themselves.
  perform pg_temp.act_as(v_b);
  perform pg_temp.must_refuse('the holder cannot decide either',
    format('select public.decide_reassignment(%L, false)', req));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor approves',
    format('select public.decide_reassignment(%L, true)', req));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('the old holder is off it',
    not exists (select 1 from public.task_assignees
                 where task_id = t_neg and student_id = v_b));
  perform pg_temp.must_be('the requester is on it',
    exists (select 1 from public.task_assignees
             where task_id = t_neg and student_id = v_a));
  perform pg_temp.must_be('a started task comes back to To do',
    (select status = 'todo' from public.project_tasks where id = t_neg));
  perform pg_temp.must_be('...and its start time was cleared with it',
    (select started_at is null from public.project_tasks where id = t_neg));
  perform pg_temp.must_be('the trail records the hand-off',
    exists (select 1 from public.task_events
             where task_id = t_neg and kind = 'unclaimed')
    and exists (select 1 from public.task_events
                 where task_id = t_neg and kind in ('assigned', 'claimed')));
  perform pg_temp.must_be('the request is approved, naming who got it',
    (select status = 'approved' and to_student = v_a
       from public.task_reassignments where id = req));
  perform pg_temp.must_be('the requester was told',
    exists (select 1 from public.notifications
             where user_id = v_a and task_id = t_neg and type = 'reassign_decided'));
  perform pg_temp.must_be('so was the person it came off',
    exists (select 1 from public.notifications
             where user_id = v_b and task_id = t_neg and type = 'reassign_decided'));

  -- Answering twice is not a thing.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('the same request cannot be decided twice',
    format('select public.decide_reassignment(%L, false)', req));
  perform pg_temp.act_as_service();
end $$;

-- A release leaves the task with nobody, which is the point of asking for one.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  v_prof uuid := (select v from fx where k='prof');
  t_cap uuid := (select v from fx where k='cap');
  req uuid;
begin
  perform pg_temp.act_as(v_c);
  insert into public.task_assignees (task_id, student_id) values (t_cap, v_c);
  perform pg_temp.act_as(v_a);
  insert into public.task_reassignments (task_id, wants, reason)
  values (t_cap, 'release', 'C is off sick, put it back so anyone can take it')
  returning id into req;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor approves a release',
    format('select public.decide_reassignment(%L, true)', req));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('nobody holds it now',
    not exists (select 1 from public.task_assignees where task_id = t_cap));
  perform pg_temp.must_be('and it is recorded as going to nobody',
    (select to_student is null from public.task_reassignments where id = req));
end $$;

-- Declining changes nothing about who holds the work.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  v_prof uuid := (select v from fx where k='prof');
  t_spare uuid := (select v from fx where k='spare');
  req uuid;
begin
  perform pg_temp.act_as(v_c);
  insert into public.task_assignees (task_id, student_id) values (t_spare, v_c);
  perform pg_temp.act_as(v_a);
  insert into public.task_reassignments (task_id, wants, reason)
  values (t_spare, 'take_over', 'i would rather do this one')
  returning id into req;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor declines',
    format('select public.decide_reassignment(%L, false, null, %L)',
           req, 'Talk to C first.'));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('the holder keeps it',
    exists (select 1 from public.task_assignees
             where task_id = t_spare and student_id = v_c));
  perform pg_temp.must_be('the decline carries its note back',
    (select status = 'declined' and decision_note = 'Talk to C first.'
       from public.task_reassignments where id = req));
end $$;

-- Withdrawing is the requester's alone.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  t_cap uuid := (select v from fx where k='cap');
  req uuid;
begin
  perform pg_temp.act_as(v_a);
  insert into public.task_reassignments (task_id, wants, reason)
  values (t_cap, 'take_over', 'i can pick this up')
  returning id into req;

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_refuse('somebody else cannot withdraw it',
    format('select public.withdraw_reassignment(%L)', req));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_allow('the requester withdraws it',
    format('select public.withdraw_reassignment(%L)', req));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('and the task is now free to ask about again',
    not exists (select 1 from public.task_reassignments
                 where task_id = t_cap and status = 'pending'));
end $$;

-- The fair-share cap is deliberately not enforced against a professor's ruling.
do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_prof uuid := (select v from fx where k='prof');
  t_cap uuid := (select v from fx where k='cap');
  v_board uuid := (select v from fx where k='board');
  cap numeric; held numeric;
  req uuid;
  filler record;
begin
  -- Load A up to their share first, so the next one would normally be refused.
  -- One at a time, stopping at the cap: a set-based insert trips the guard
  -- partway through and takes the fixture down with it.
  perform pg_temp.act_as(v_a);
  for filler in
    select t.id from public.project_tasks t
     where t.board_id = v_board and t.title like 'Filler %'
       and not exists (select 1 from public.task_assignees x where x.task_id = t.id)
  loop
    begin
      insert into public.task_assignees (task_id, student_id) values (filler.id, v_a);
    exception when others then exit;
    end;
  end loop;
  perform pg_temp.act_as_service();

  cap := public.board_member_cap(v_board);
  held := public.board_member_held(v_board, v_a);
  perform pg_temp.must_be('fixture: A is at or over their fair share', held >= cap);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a normal claim past the cap is refused',
    format('insert into public.task_assignees (task_id, student_id) values (%L, %L)',
           t_cap, v_a));

  insert into public.task_reassignments (task_id, wants, reason)
  values (t_cap, 'take_over', 'nobody has taken this and it is blocking us')
  returning id into req;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can still hand it over the cap',
    format('select public.decide_reassignment(%L, true)', req));
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('...and A really has it',
    exists (select 1 from public.task_assignees
             where task_id = t_cap and student_id = v_a));
end $$;

rollback;
