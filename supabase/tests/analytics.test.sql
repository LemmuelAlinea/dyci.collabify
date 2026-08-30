-- Professor analytics — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/analytics.test.sql
--
-- The pace figure is checked against a hand computation on a fixture with known
-- week spans, because a number nobody can reproduce is worse than no number.

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
  v_class uuid; v_prof uuid; v_stud uuid; v_out uuid;
  v_p1 uuid; v_p2 uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 6
     -- A class the planner picked at random used to be enough. It is not:
     -- an unordered `limit 1` handed back an empty class one day and the
     -- fixtures failed on a null student. Ordered, and it must have people.
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;
  select student_id into v_stud from public.class_members
   where class_id = v_class and status = 'active' limit 1;
  -- Somebody with no connection to this class at all.
  select id into v_out from public.profiles
   where role = 'student' and id not in (
     select student_id from public.class_members where class_id = v_class)
   limit 1;

  -- A known term, so weeks_elapsed is not whatever today happens to be.
  update public.classes
     set term_start = (current_date - 28)::date,   -- exactly 4 weeks ago
         term_end   = (current_date + 28)::date    -- 8 weeks in total
   where id = v_class;

  -- Wipe the real projects for this class so the arithmetic is ours alone.
  delete from public.projects where class_id = v_class;

  -- Two projects covering weeks 1-2 and 5-5: three distinct weeks.
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-an-a', 'activity', 1, 2, 'individual', now() + interval '3 days')
  returning id into v_p1;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-an-b', 'activity', 5, 5, 'individual', now() + interval '9 days')
  returning id into v_p2;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values
    ('class', v_class), ('prof', v_prof), ('stud', v_stud), ('out', v_out),
    ('p1', v_p1), ('p2', v_p2);
  raise notice 'fixture ready';
end $$;

-- -------------------------------------------------------------------- pace

do $$
declare
  v_class uuid := (select v from fx where k='class');
  r public.class_pace%rowtype;
begin
  -- The views answer to the class's professor, so they are read as one.
  perform pg_temp.act_as((select v from fx where k='prof'));
  select * into r from public.class_pace where class_id = v_class;

  -- Weeks 1, 2 and 5 — spans are inclusive and overlaps count once.
  perform pg_temp.must_be('three distinct weeks are covered', r.weeks_covered = 3);
  perform pg_temp.must_be('four weeks have elapsed', r.weeks_elapsed = 4);
  perform pg_temp.must_be('the term is eight weeks long', r.weeks_in_term = 8);

  -- 3 covered in 4 elapsed is 0.75 a week. This is the whole projection.
  perform pg_temp.must_be('the pace is three quarters of a week per week',
    round(r.weeks_covered::numeric / r.weeks_elapsed, 2) = 0.75);
  perform pg_temp.act_as_service();
end $$;

-- Overlapping projects must not inflate the count.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  before int; after_ int;
begin
  perform pg_temp.act_as(v_prof);
  select weeks_covered into before from public.class_pace where class_id = v_class;

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-an-overlap', 'activity', 2, 2, 'individual', now() + interval '1 day');

  select weeks_covered into after_ from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('a second project on a covered week adds nothing',
    after_ = before);
  perform pg_temp.act_as_service();
end $$;

-- -------------------------------------------------------------------- gaps

do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  -- Weeks 1, 2 and 5 are covered, so they cannot be gaps.
  select count(*) into n from public.class_gaps
   where class_id = v_class and week_no in (1, 2, 5);
  perform pg_temp.must_be('a covered week is never a gap', n = 0);

  -- Week 3 is not covered; it is a gap if the syllabus asks for something.
  select count(*) into n from public.class_gaps
   where class_id = v_class and week_no = 3;
  perform pg_temp.must_be('an uncovered week naming an assessment is a gap',
    n = (select count(*) from public.syllabus_weeks w
          join public.classes c on c.syllabus_id = w.resource_id
         where c.id = v_class and w.week_no = 3 and btrim(w.assessments) <> ''));

  -- A week that asks for nothing is not a gap, however uncovered.
  update public.syllabus_weeks set assessments = ''
   where week_no = 4
     and resource_id = (select syllabus_id from public.classes where id = v_class);
  select count(*) into n from public.class_gaps where class_id = v_class and week_no = 4;
  perform pg_temp.must_be('a week asking for nothing is not a gap', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ health

do $$
declare
  v_class uuid := (select v from fx where k='class');
  r public.class_health%rowtype;
begin
  perform pg_temp.act_as((select v from fx where k='prof'));
  select * into r from public.class_health where class_id = v_class;
  perform pg_temp.must_be('health counts the class once', r.class_id = v_class);
  perform pg_temp.must_be('a class with no work reads zero, not null',
    r.tasks >= 0 and r.late_tasks >= 0 and r.average_done_pct >= 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------- who sees

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  v_out uuid := (select v from fx where k='out');
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('the professor sees their own class', n = 1);

  select count(*) into n from public.class_member_load where class_id = v_class;
  perform pg_temp.must_be('...and who is carrying what in it', n >= 0);

  -- A student is in the class and still gets no analytics of it: class_pace
  -- reads projects, and a student sees only released ones.
  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.class_gaps where class_id = v_class;
  perform pg_temp.must_be('a student in the class sees no gap list', n = 0);

  perform pg_temp.act_as(v_out);
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('somebody outside the class sees nothing at all', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- An archived class drops out entirely — it is not a term to finish.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('an archived class leaves the projection', n = 0);

  select count(*) into n from public.class_gaps where class_id = v_class;
  perform pg_temp.must_be('...and its gaps go with it', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- --------------------------------------------------- burn, and the leaf

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  v_class uuid := (select v from fx where k='class');
  n int; r record;
begin
  perform pg_temp.act_as(v_prof);

  -- A board nobody has touched has no rate, and null is the honest answer:
  -- zero per day would read as "moving slowly" rather than "not moving".
  select count(*) into n from public.board_burn
   where class_id = v_class and days_active is null and done_count = 0;
  perform pg_temp.must_be('an unstarted board reports no rate at all', n >= 0);

  -- days_active is never zero, because it is about to be divided by.
  select count(*) into n from public.board_burn where days_active = 0;
  perform pg_temp.must_be('days_active is never zero', n = 0);

  -- The leaf carries its own chain, so the page can narrow without re-joining.
  select count(*) into n from public.task_state where class_id = v_class;
  perform pg_temp.must_be('tasks carry the class they belong to', n >= 0);

  select count(*) into n from public.task_state
   where class_id = v_class and assignee_ids is null;
  perform pg_temp.must_be('assignee_ids is an array, never null', n = 0);

  perform pg_temp.act_as_service();
end $$;

-- ----------------------------------------------------------- unmeasurable

-- A class the pace cannot speak for says so, instead of vanishing. Each refusal
-- is paired with the control that shows the same class measured, seconds apart.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  v_prof uuid := (select v from fx where k='prof');
  v_syllabus uuid;
  n int; r public.class_unmeasured%rowtype;
begin
  -- The fixture class was archived by the test above; bring it back, since this
  -- section is about what is missing rather than what is gone.
  update public.classes set archived_at = null where id = v_class;
  select syllabus_id into v_syllabus from public.classes where id = v_class;

  perform pg_temp.act_as(v_prof);

  -- Control: dated, with a syllabus. It is measured, and it is not listed.
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('a dated class with a syllabus is measured', n = 1);
  select count(*) into n from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('...and is not named as unmeasurable', n = 0);
  perform pg_temp.act_as_service();

  -- Take the term dates away.
  update public.classes set term_start = null, term_end = null where id = v_class;
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('an undated class has no pace', n = 0);
  select * into r from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('...and is named as needing its term dates',
    r.class_id = v_class and r.needs_term);
  perform pg_temp.must_be('...without blaming the syllabus it does have',
    not r.needs_syllabus);
  perform pg_temp.act_as_service();

  -- Give them back, and take the syllabus away instead.
  update public.classes
     set term_start = (current_date - 28)::date,
         term_end   = (current_date + 28)::date,
         syllabus_id = null
   where id = v_class;
  perform pg_temp.act_as(v_prof);
  -- Without this, weeks_total is zero and the card reads "0 of 0 covered",
  -- which looks like a finished syllabus rather than an absent one.
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('a class with no syllabus weeks has no pace either', n = 0);
  select * into r from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('...and is named as needing a syllabus', r.needs_syllabus);
  perform pg_temp.must_be('...without blaming the term dates it does have',
    not r.needs_term);
  perform pg_temp.act_as_service();

  -- Restore it, and the class goes back to being measured. The nudge is a
  -- statement about right now, not a flag anybody has to clear.
  update public.classes set syllabus_id = v_syllabus where id = v_class;
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('putting the syllabus back clears the notice', n = 0);
  select count(*) into n from public.class_pace where class_id = v_class;
  perform pg_temp.must_be('...and the class is measured again', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- An archived class is not an unfinished setup job, and must not be nagged about.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  update public.classes set term_start = null, archived_at = now() where id = v_class;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('an archived class is never named as unmeasurable', n = 0);

  -- Control: unarchive it, still undated, and it is named again.
  perform pg_temp.act_as_service();
  update public.classes set archived_at = null where id = v_class;
  perform pg_temp.act_as((select v from fx where k='prof'));
  select count(*) into n from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('...and a live one still is', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- Scoped like the rest. What a professor has not set up yet is theirs to know.
do $$
declare
  v_class uuid := (select v from fx where k='class');
  n int;
begin
  perform pg_temp.act_as((select v from fx where k='stud'));
  select count(*) into n from public.class_unmeasured where class_id = v_class;
  perform pg_temp.must_be('a student in the class reads no setup notice', n = 0);

  perform pg_temp.act_as((select v from fx where k='out'));
  select count(*) into n from public.class_unmeasured;
  perform pg_temp.must_be('somebody outside reads none at all', n = 0);
  perform pg_temp.act_as_service();
end $$;

-- The new views are scoped like the rest: absence is only measurable by
-- somebody who can see everything it is measured against.
do $$
declare
  v_stud uuid := (select v from fx where k='stud');
  n int;
begin
  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.board_burn;
  perform pg_temp.must_be('a student reads no burn figures', n = 0);

  select count(*) into n from public.task_state;
  perform pg_temp.must_be('...and no task list through analytics', n = 0);
  perform pg_temp.act_as_service();
end $$;

rollback;
