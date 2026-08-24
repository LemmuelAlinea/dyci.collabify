-- What the program office owns — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/program-office.test.sql
--
-- Three features, one claim between them: the chair may write for the whole
-- program and nobody else may. Every refusal below is paired with the admin
-- doing the same thing successfully, on the same statement seconds later.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 56);
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

do $$
declare v_admin uuid; v_prof uuid; v_stud uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  select c.professor_id into v_prof from public.classes c
   where c.archived_at is null order by c.created_at limit 1;
  select student_id into v_stud from public.class_members
   where status = 'active' order by student_id limit 1;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values ('admin', v_admin), ('prof', v_prof), ('stud', v_stud);
  raise notice 'fixture ready';
end $$;

-- ---------------------------------------------------------------- notices

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  n int; before_notifs int;
begin
  select count(*) into before_notifs from public.notifications where user_id = v_stud;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a professor cannot speak for the program',
    format('insert into public.program_announcements (author_id, title, body)
            values (%L, %L, %L)', v_prof, 'zz from a professor', 'should not land'));

  -- The control: the same statement from the chair goes through.
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the chair can',
    format('insert into public.program_announcements (author_id, title, body)
            values (%L, %L, %L)', v_admin, 'zz classes suspended', 'No classes on Friday.'));
  perform pg_temp.act_as_service();

  -- Everybody reads it, which is the point of a program notice.
  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.program_notices where title = 'zz classes suspended';
  perform pg_temp.must_be('a student reads the notice', n = 1);
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.program_notices where title = 'zz classes suspended';
  perform pg_temp.must_be('...and so does a professor', n = 1);

  -- ...and cannot change it. A policy filters an update rather than raising, so
  -- the assertion is on the value afterwards: the statement runs and does
  -- nothing, which is what "cannot" looks like from the client.
  update public.program_announcements set title = 'zz hijacked'
   where title = 'zz classes suspended';
  perform pg_temp.act_as_service();

  select count(*) into n from public.program_announcements where title = 'zz hijacked';
  perform pg_temp.must_be('a professor editing it changes nothing', n = 0);
  select count(*) into n from public.program_announcements where title = 'zz classes suspended';
  perform pg_temp.must_be('...and the notice still says what the chair wrote', n = 1);

  select count(*) into n from public.notifications where user_id = v_stud;
  perform pg_temp.must_be('everybody who allows announcements was told',
    n = before_notifs + 1);
end $$;

-- One pinned notice at a time: two things at the top of a dashboard is neither.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
begin
  -- The live database may already have a pinned notice — somebody pinned one
  -- through the page. Clear it inside this transaction so the assertion is
  -- about the constraint rather than about what happens to be pinned today.
  update public.program_announcements set pinned = false where pinned;

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('one notice can be pinned',
    format('insert into public.program_announcements (author_id, title, body, pinned)
            values (%L, %L, %L, true)', v_admin, 'zz pinned one', 'body'));
  perform pg_temp.must_refuse('...and a second one cannot',
    format('insert into public.program_announcements (author_id, title, body, pinned)
            values (%L, %L, %L, true)', v_admin, 'zz pinned two', 'body'));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------- the twenty-four hours

/**
 * A notice is for a day. The paired control is what makes this worth
 * asserting: a window that hid everything would pass the first half alone, so
 * a notice from two hours ago has to still be there in the same breath.
 *
 * Ages are set explicitly rather than waited for. A test that sleeps for a day
 * is a test nobody runs.
 */
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_stud uuid := (select v from fx where k='stud');
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  insert into public.program_announcements (author_id, title, body, created_at)
  values (v_admin, 'zz two hours old', 'inside the window', now() - interval '2 hours'),
         (v_admin, 'zz two days old',  'outside the window', now() - interval '2 days'),
         -- Exactly on the line, to pin down which side it falls on.
         (v_admin, 'zz just inside',   'one minute to spare', now() - interval '23 hours 59 minutes'),
         (v_admin, 'zz just outside',  'one minute too late', now() - interval '24 hours 1 minute');

  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.program_notices where title = 'zz two hours old';
  perform pg_temp.must_be('a notice from this morning is on the dashboard', n = 1);
  select count(*) into n from public.program_notices where title = 'zz two days old';
  perform pg_temp.must_be('...and one from two days ago is not', n = 0);
  select count(*) into n from public.program_notices where title = 'zz just inside';
  perform pg_temp.must_be('23h59m still counts as today', n = 1);
  select count(*) into n from public.program_notices where title = 'zz just outside';
  perform pg_temp.must_be('24h01m does not', n = 0);

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.program_notices where title = 'zz two days old';
  perform pg_temp.must_be('a professor is held to the same window', n = 0);

  -- The record view is the chair's alone, and it keeps what the window drops.
  select count(*) into n from public.program_notices_all;
  perform pg_temp.must_be('a professor gets nothing from the record view', n = 0);
  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.program_notices_all;
  perform pg_temp.must_be('...and neither does a student', n = 0);

  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.program_notices_all where title = 'zz two days old';
  perform pg_temp.must_be('the chair still has the expired notice', n = 1);
  select count(*) into n from public.program_notices_all
   where title = 'zz two days old' and expired;
  perform pg_temp.must_be('...flagged as expired', n = 1);
  select count(*) into n from public.program_notices_all
   where title = 'zz two hours old' and not expired;
  perform pg_temp.must_be('...and the fresh one flagged as live', n = 1);

  -- Editing corrects the record; it does not put a notice back on a dashboard.
  update public.program_announcements
     set body = 'corrected', edited_at = now()
   where title = 'zz two days old';
  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.program_notices where title = 'zz two days old';
  perform pg_temp.must_be('editing an expired notice does not re-announce it', n = 0);
  perform pg_temp.act_as_service();

  delete from public.program_announcements where title like 'zz %old' or title like 'zz just %';
end $$;

-- --------------------------------------------------------------- sections

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a professor cannot invent a section',
    'insert into public.program_sections (name, year_level, school_year)
      values (''zz BSIT 9Z'', ''3rd'', ''2026-2027'')');

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the chair keeps the list',
    'insert into public.program_sections (name, year_level, school_year)
      values (''zz BSIT 9Z'', ''3rd'', ''2026-2027'')');

  -- The fold is the whole point: one cohort cannot be entered twice under two
  -- spellings of the same name.
  perform pg_temp.must_refuse('the same section spelled differently is refused',
    'insert into public.program_sections (name, year_level, school_year)
      values (''zz-bsit9z'', ''3rd'', ''2026-2027'')');

  -- ...but the same name in another school year is a different cohort.
  perform pg_temp.must_allow('the same name next year is a new section',
    'insert into public.program_sections (name, year_level, school_year)
      values (''zz BSIT 9Z'', ''3rd'', ''2027-2028'')');
  perform pg_temp.act_as_service();

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.program_sections where name like 'zz%';
  perform pg_temp.must_be('a professor reads the list, to pick from it', n = 2);
  select count(*) into n from public.program_section_overview;
  perform pg_temp.must_be('...but not the console view over it', n = 0);
  perform pg_temp.act_as(v_admin);
  select count(*) into n from public.program_section_overview where name like 'zz%';
  perform pg_temp.must_be('...which the chair reads', n = 2);
  perform pg_temp.act_as_service();
end $$;

-- A class already using a name lands in that section however it was spelled.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid;
  r public.program_section_overview%rowtype;
begin
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_prof, 'zz Section Fold', 'ZZSF', 'ZZ-SF-1', 'zz-bsit9z', '3rd', '1st', '2026-2027')
  returning id into v_class;

  perform pg_temp.act_as(v_admin);
  select * into r from public.program_section_overview
   where name = 'zz BSIT 9Z' and school_year = '2026-2027';
  perform pg_temp.must_be('a class written "zz-bsit9z" counts under "zz BSIT 9Z"',
    r.classes = 1);
  perform pg_temp.act_as_service();

  delete from public.classes where id = v_class;
end $$;

-- ---------------------------------------------------------------- library

do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_stud uuid := (select v from fx where k='stud');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  -- A professor may upload for themselves — the control that proves the refusal
  -- below is about publishing, not about uploading.
  perform pg_temp.must_allow('a professor uploads their own syllabus',
    format('insert into public.teaching_resources
              (professor_id, kind, title, file_path, file_name)
            values (%L, ''syllabus'', ''zz mine'', ''x/mine.pdf'', ''mine.pdf'')', v_prof));

  perform pg_temp.must_refuse('...and cannot publish it to the program',
    format('insert into public.teaching_resources
              (professor_id, kind, title, file_path, file_name, program_wide)
            values (%L, ''syllabus'', ''zz sneaky'', ''x/s.pdf'', ''s.pdf'', true)', v_prof));

  perform pg_temp.must_refuse('...nor promote the one they already own',
    'update public.teaching_resources set program_wide = true where title = ''zz mine''');

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('the chair publishes one',
    format('insert into public.teaching_resources
              (professor_id, kind, title, file_path, file_name, program_wide)
            values (%L, ''syllabus'', ''zz published'', ''y/p.pdf'', ''p.pdf'', true)', v_admin));
  perform pg_temp.act_as_service();

  -- Published means readable by the people it was published for.
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.teaching_resources where title = 'zz published';
  perform pg_temp.must_be('a professor reads what the program published', n = 1);
  select count(*) into n from public.teaching_resources
   where professor_id = (select v from fx where k='admin') and not program_wide;
  perform pg_temp.must_be('...and nothing of the chair''s unpublished shelf', n = 0);

  perform pg_temp.act_as(v_stud);
  select count(*) into n from public.teaching_resources where title = 'zz published';
  perform pg_temp.must_be('a student reads it too — it is the course outline', n = 1);
  perform pg_temp.act_as_service();
end $$;

-- A published syllabus is an ordinary row, which is why a class can attach it.
do $$
declare
  v_admin uuid := (select v from fx where k='admin');
  v_prof uuid := (select v from fx where k='prof');
  v_res uuid; v_class uuid; n int;
begin
  select id into v_res from public.teaching_resources where title = 'zz published';

  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_prof, 'zz Attach', 'ZZA', 'ZZ-A-1', 'BSIT 9Z', '3rd', '1st', '2026-2027', v_res)
  returning id into v_class;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.classes
   where id = v_class and syllabus_id = v_res;
  perform pg_temp.must_be('a class can hold the program''s syllabus as its own', n = 1);
  perform pg_temp.act_as_service();

  delete from public.classes where id = v_class;
end $$;

rollback;
