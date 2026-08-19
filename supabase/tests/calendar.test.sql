-- The calendar view — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/calendar.test.sql
--
-- calendar_events is security_invoker with no role logic of its own, so what
-- each person sees is entirely their own policies. These assertions are about
-- that: the same query, run as four different people, coming back different.
-- Each "cannot see" is paired with somebody who can, on the same row.

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
  v_class uuid; v_prof uuid;
  v_a uuid; v_b uuid; v_out uuid;
  v_set uuid; v_g1 uuid; v_g2 uuid;
  v_live uuid; v_sched uuid;
  b1 uuid; b2 uuid;
  t_a uuid; t_b uuid;
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
  -- Somebody with no place on either board.
  select student_id into v_out from public.class_members
   where class_id = v_class and status = 'active' and student_id not in (v_a, v_b)
   order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-calendar-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Cal group A') returning id into v_g1;
  insert into public.groups (set_id, name) values (v_set, 'Cal group B') returning id into v_g2;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g1, v_set, v_a), (v_g2, v_set, v_b);

  -- One live project, and one still scheduled to open later.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-cal-live', 'activity', 1, 2, 'group', v_set,
          now() + interval '5 days')
  returning id into v_live;

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id,
     due_at, release_at)
  values (v_class, v_prof, 'zz-cal-scheduled', 'activity', 1, 2, 'group', v_set,
          now() + interval '20 days', now() + interval '10 days')
  returning id into v_sched;

  perform public.ensure_project_boards(v_live);
  select id into b1 from public.project_boards where project_id = v_live and group_id = v_g1;
  select id into b2 from public.project_boards where project_id = v_live and group_id = v_g2;

  insert into public.project_tasks (board_id, title, weight, created_by, author_role, due_at)
  values (b1, 'zz-cal-task-A', 10, v_prof, 'professor', now() + interval '2 days')
  returning id into t_a;
  insert into public.project_tasks (board_id, title, weight, created_by, author_role, due_at)
  values (b2, 'zz-cal-task-B', 10, v_prof, 'professor', now() + interval '2 days')
  returning id into t_b;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('out', v_out),
    ('live', v_live), ('sched', v_sched), ('b1', b1), ('ta', t_a), ('tb', t_b);

  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ student

do $$
declare
  v_a uuid := (select v from fx where k='a');
  n int;
begin
  perform pg_temp.act_as(v_a);

  select count(*) into n from public.calendar_events
   where kind = 'task_due' and ref_id = (select v from fx where k='ta');
  perform pg_temp.must_be('a student sees their own board''s task', n = 1);

  select count(*) into n from public.calendar_events
   where kind = 'task_due' and ref_id = (select v from fx where k='tb');
  perform pg_temp.must_be('...and not another group''s task', n = 0);

  select count(*) into n from public.calendar_events
   where kind = 'project_due' and ref_id = (select v from fx where k='live');
  perform pg_temp.must_be('a student sees a live project deadline', n = 1);

  -- The whole reason the view carries no role logic: this falls out of the
  -- project policies, which already hide anything not yet released.
  select count(*) into n from public.calendar_events
   where ref_id = (select v from fx where k='sched');
  perform pg_temp.must_be('a student sees nothing of a scheduled project', n = 0);

  select count(*) into n from public.calendar_events where kind = 'project_release';
  perform pg_temp.must_be('...so no release dates reach a student at all', n = 0);

  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- professor

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  perform pg_temp.act_as(v_prof);

  select count(*) into n from public.calendar_events
   where kind = 'project_release' and ref_id = (select v from fx where k='sched');
  perform pg_temp.must_be('the professor sees the release date', n = 1);

  select count(*) into n from public.calendar_events
   where kind = 'task_due' and ref_id in (
     (select v from fx where k='ta'), (select v from fx where k='tb'));
  perform pg_temp.must_be('the professor can reach every group''s tasks', n = 2);

  select count(*) into n from public.calendar_events
   where kind = 'project_due' and ref_id = (select v from fx where k='sched');
  perform pg_temp.must_be('...and the deadline of a project not yet open', n = 1);

  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------------------- an outsider

do $$
declare
  v_out uuid := (select v from fx where k='out');
  n int;
begin
  perform pg_temp.act_as(v_out);

  select count(*) into n from public.calendar_events
   where kind = 'task_due' and ref_id in (
     (select v from fx where k='ta'), (select v from fx where k='tb'));
  perform pg_temp.must_be('a classmate on neither board sees neither task', n = 0);

  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------- submissions appear

do $$
declare
  v_a uuid := (select v from fx where k='a');
  b1 uuid := (select v from fx where k='b1');
  n int;
begin
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(b1, true);

  select count(*) into n from public.calendar_events
   where kind = 'submitted' and ref_id = b1;
  perform pg_temp.must_be('handing in puts a marker on the calendar', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------- archived work drops off it

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  update public.projects set archived_at = now() where id = (select v from fx where k='live');

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.calendar_events
   where project_id = (select v from fx where k='live');
  perform pg_temp.must_be('an archived project leaves the calendar entirely', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
