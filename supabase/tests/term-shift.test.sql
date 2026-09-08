-- Moving a term's weeks — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/term-shift.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- Without that the suite lies: a refusal can come from a guard that was already
-- there, and would still "pass" with this whole feature deleted.
--
-- The claims worth holding here are the ones a comment cannot prove: that two
-- shifts compose, that weeks before the shift do not move, that the impact
-- boundary is exactly the old start of `from_week`, that a sibling class
-- sharing the syllabus is untouched, and that `class_gaps` and
-- `class_week_map` still agree once dates can move.

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
  prof     uuid := gen_random_uuid();
  other    uuid := gen_random_uuid();
  student  uuid := gen_random_uuid();
  res      uuid;
  cls      uuid;
  sibling  uuid;
  proj     uuid;
  board    uuid;
  task     uuid;
  early    uuid;
  shift1   uuid;
  shift2   uuid;
  start    date := date '2026-07-20';   -- a Monday
  w4_start date;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (other), (student)) as u(id);

  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (prof,    prof::text    || '@test.invalid', 'Term', 'Prof',  'professor', 'active'),
         (other,   other::text   || '@test.invalid', 'Other','Prof',  'professor', 'active'),
         (student, student::text || '@test.invalid', 'Term', 'Student','student',  'active');

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'Test syllabus', 'x/y.pdf', 'y.pdf')
  returning id into res;

  -- Sixteen weeks, with something to hand in in week 11 so class_gaps has a row.
  insert into public.syllabus_weeks (resource_id, week_no, title, assessments)
  select res, n, 'Week ' || n, case when n = 11 then 'Lab 6' else '' end
    from generate_series(1, 16) as n;

  -- Two classes on the same syllabus and the same term start. The sibling
  -- exists to prove a shift does not leak across the shared resource.
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'Database Management', 'DBM', 'DBM101', 'A', '3rd', '1st', '2026-2027',
          res, start, start + 111)
  returning id into cls;

  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'Database Management', 'DBM', 'DBM101B', 'B', '3rd', '1st', '2026-2027',
          res, start, start + 111)
  returning id into sibling;

  insert into public.class_members (class_id, student_id, status)
  values (cls, student, 'active');

  -- Week 4 starts on start + 21. One project due inside it, one due the day
  -- before it — the pair that pins the impact boundary.
  w4_start := start + 21;

  insert into public.projects (class_id, created_by, title, type, audience,
                               start_week, end_week, due_at, release_at)
  values (cls, prof, 'Midterm Project', 'exam', 'individual', 4, 6,
          (w4_start + 2)::timestamptz, (w4_start)::timestamptz)
  returning id into proj;

  insert into public.projects (class_id, created_by, title, type, audience,
                               start_week, end_week, due_at)
  values (cls, prof, 'Week 3 quiz', 'quiz', 'individual', 3, 3,
          (w4_start - 1)::timestamptz)
  returning id into early;

  -- An individual project already has a board per member, created by the
  -- trigger on release. Insert one and the unique key refuses it.
  select id into board from public.project_boards
   where project_id = proj and student_id = student;

  if board is null then
    insert into public.project_boards (project_id, student_id)
    values (proj, student) returning id into board;
  end if;

  insert into public.project_tasks (board_id, title, due_at, created_by, author_role)
  values (board, 'Write the ERD', (w4_start + 3)::timestamptz, prof, 'professor')
  returning id into task;

  -- solo-auto-claim.sql already claims a task on a one-person board.
  insert into public.task_assignees (task_id, student_id, claimed_by)
  values (task, student, student)
  on conflict do nothing;

  -- ------------------------------------------------------------- who may shift

  perform pg_temp.act_as(other);
  perform pg_temp.must_refuse(
    'a professor who does not teach the class cannot shift it',
    format('select public.shift_class_weeks(%L, 4, 7, %L)', cls, 'typhoon'));

  perform pg_temp.act_as(student);
  perform pg_temp.must_refuse(
    'a student cannot shift it',
    format('select public.shift_class_weeks(%L, 4, 7, %L)', cls, 'typhoon'));

  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse(
    'a week the syllabus does not have is refused',
    format('select public.shift_class_weeks(%L, 40, 7, %L)', cls, 'typhoon'));

  perform pg_temp.must_refuse(
    'moving a week to the date it already starts on is refused',
    format('select public.shift_class_weeks(%L, 4, 0, %L)', cls, 'typhoon'));

  perform pg_temp.must_allow(
    'the professor of the class can shift it',
    format('select public.shift_class_weeks(%L, 4, 7, %L)', cls, 'Typhoon Kristine'));

  select id into shift1 from public.class_week_shifts
   where class_id = cls order by created_at desc limit 1;

  -- ------------------------------------------------------------ what moved

  perform pg_temp.must_be(
    'week 4 moved seven days later',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 4) = w4_start + 7);

  perform pg_temp.must_be(
    'week 16 moved with it',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 16) = start + (15 * 7) + 7);

  -- The whole point of shifting from a week rather than moving term_start.
  perform pg_temp.must_be(
    'week 3 did not move',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 3) = start + 14);

  perform pg_temp.must_be(
    'term_end moved by the same seven days',
    (select term_end from public.classes where id = cls) = start + 111 + 7);

  perform pg_temp.must_be(
    'the sibling class on the same syllabus did not move',
    (select week_start from public.class_week_map
      where class_id = sibling and week_no = 4) = w4_start);

  perform pg_temp.must_be(
    'the offset is reported on the week itself',
    (select offset_days from public.class_week_map
      where class_id = cls and week_no = 4) = 7);

  -- ------------------------------------------------------------- composition

  perform pg_temp.must_allow(
    'a second disruption is a second shift',
    format('select public.shift_class_weeks(%L, 8, 3, %L)', cls, 'Brownout'));

  perform pg_temp.must_be(
    'week 9 carries both shifts',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 9) = start + (8 * 7) + 10);

  perform pg_temp.must_be(
    'week 4 still carries only the first',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 4) = w4_start + 7);

  perform pg_temp.must_be(
    'term_end carries both',
    (select term_end from public.classes where id = cls) = start + 111 + 10);

  -- Shifting back is a second shift with the opposite sign, not an undo. This
  -- is what makes the absence of an undo button defensible.
  perform pg_temp.must_allow(
    'a shift can be reversed by shifting the other way',
    format('select public.shift_class_weeks(%L, 8, -3, %L)', cls, 'Brownout called off'));

  perform pg_temp.must_be(
    'week 9 is back where the first shift left it',
    (select week_start from public.class_week_map
      where class_id = cls and week_no = 9) = start + (8 * 7) + 7);

  -- ------------------------------------------------------------ the boundary

  perform pg_temp.must_be(
    'a deadline inside the moved range is listed',
    exists (select 1 from public.class_shift_impact(shift1) where ref_id = proj));

  -- The day before the old start of week 4. If this appears, the boundary is
  -- wrong and the professor would be offered a deadline that never moved.
  perform pg_temp.must_be(
    'a deadline the day before the old start is not listed',
    not exists (select 1 from public.class_shift_impact(shift1) where ref_id = early));

  perform pg_temp.must_be(
    'a task inside the range is listed with its project named',
    exists (select 1 from public.class_shift_impact(shift1)
             where ref_id = task and parent = 'Midterm Project'));

  perform pg_temp.must_be(
    'the proposed new date is the old one plus the shift',
    (select new_due from public.class_shift_impact(shift1) where ref_id = proj)
      = (w4_start + 2)::timestamptz + interval '7 days');

  perform pg_temp.act_as(other);
  perform pg_temp.must_refuse(
    'another professor cannot read what the shift affected',
    format('select * from public.class_shift_impact(%L)', shift1));
  perform pg_temp.act_as(prof);

  -- --------------------------------------------------------- moving deadlines

  perform pg_temp.must_be(
    'only the ids passed are moved',
    public.apply_shift_to_deadlines(shift1, array[proj], array[]::uuid[]) = 1);

  perform pg_temp.must_be(
    'the project deadline moved seven days',
    (select due_at from public.projects where id = proj)
      = (w4_start + 2)::timestamptz + interval '7 days');

  -- Moving due_at without release_at can put a release after its own deadline.
  perform pg_temp.must_be(
    'release_at moved with it',
    (select release_at from public.projects where id = proj)
      = (w4_start)::timestamptz + interval '7 days');

  perform pg_temp.must_be(
    'the deadline that was not ticked stayed put',
    (select due_at from public.projects where id = early) = (w4_start - 1)::timestamptz);

  perform pg_temp.must_be(
    'the task that was not ticked stayed put',
    (select due_at from public.project_tasks where id = task) = (w4_start + 3)::timestamptz);

  -- Read as the service role: notifications are visible only to their
  -- recipient, so asking as the professor would test RLS, not the insert.
  perform pg_temp.act_as_service();
  perform pg_temp.must_be(
    'the student was told the project moved',
    exists (select 1 from public.notifications
             where user_id = student and type = 'term_shifted'
               and title = 'Midterm Project moved'));

  perform pg_temp.must_be(
    'the reason is carried into the notification',
    (select preview from public.notifications
      where user_id = student and type = 'term_shifted' limit 1)
      like '%Typhoon Kristine%');

  perform pg_temp.act_as(prof);

  -- A task whose project also moved gets no second notification.
  perform pg_temp.must_be(
    'ticking a task under a moved project moves it',
    public.apply_shift_to_deadlines(shift1, array[proj], array[task]) = 2);

  perform pg_temp.act_as_service();
  perform pg_temp.must_be(
    'and does not notify twice about the same project',
    (select count(*) from public.notifications
      where user_id = student and type = 'term_shifted'
        and title = 'Write the ERD moved') = 0);
  perform pg_temp.act_as(prof);

  -- ------------------------------------------------------- views still agree

  perform pg_temp.must_be(
    'class_gaps and class_week_map report the same start for week 11',
    (select g.week_start from public.class_gaps g
      where g.class_id = cls and g.week_no = 11)
    = (select m.week_start from public.class_week_map m
        where m.class_id = cls and m.week_no = 11));

  -- ------------------------------------------------------------- who may read

  perform pg_temp.act_as(student);
  perform pg_temp.must_be(
    'a student in the class can read why the term moved',
    (select count(*) from public.class_week_shifts where class_id = cls) = 3);

  perform pg_temp.must_refuse(
    'but cannot write one',
    format('insert into public.class_week_shifts (class_id, from_week, days)
            values (%L, 2, 5)', cls));

  perform pg_temp.act_as(other);
  perform pg_temp.must_be(
    'somebody outside the class sees none of them',
    (select count(*) from public.class_week_shifts where class_id = cls) = 0);

  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse(
    'even the professor cannot edit a shift directly',
    format('update public.class_week_shifts set days = 99 where id = %L', shift1));

  raise notice 'ALL PASS';
end $$;

rollback;
