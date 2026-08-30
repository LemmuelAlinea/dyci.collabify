-- One project across several sections — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/series.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- The rule this suite exists for: acting on one section must leave the others
-- exactly as they were, so every scoped change asserts BOTH halves.

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$fn$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$fn$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $fn$
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
$fn$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $fn$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$fn$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $fn$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$fn$;

create temp table fx (k text primary key, v uuid);

-- ---------------------------------------------------------------- fixture

/**
 * Four sections, built rather than borrowed, so the suite does not break the
 * next time the live data changes shape:
 *
 *   A, B  — the same professor, the same 18-week syllabus. The real case: one
 *           course, two sections, one published outline.
 *   C     — the same professor, a SHORTER syllabus. Exists to prove a fan-out
 *           that one section cannot honour writes nothing anywhere.
 *   D     — a different professor. Exists to prove the target list cannot be
 *           used to reach a class that is not yours.
 */
do $do$
declare
  v_prof uuid; v_other uuid; v_syl_long uuid; v_syl_short uuid;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_sa uuid; v_sb uuid; v_ga uuid; v_gb uuid;
  v_stu uuid; v_tag text := substr(gen_random_uuid()::text, 1, 6);
begin
  select r.id into v_syl_long from public.teaching_resources r
   where r.kind = 'syllabus'
     and (select count(*) from public.syllabus_weeks w where w.resource_id = r.id) >= 17
   limit 1;
  select r.id into v_syl_short from public.teaching_resources r
   where r.kind = 'syllabus'
     and (select count(*) from public.syllabus_weeks w where w.resource_id = r.id) between 10 and 16
   limit 1;
  if v_syl_long is null or v_syl_short is null then
    raise exception 'fixture needs one syllabus of 17+ weeks and one of 10-16';
  end if;

  select id into v_prof  from public.profiles where role = 'professor'
   and exists (select 1 from public.classes c where c.professor_id = profiles.id) limit 1;
  select id into v_other from public.profiles where role = 'professor' and id <> v_prof limit 1;
  select id into v_stu   from public.profiles where role = 'student' limit 1;
  if v_other is null then raise exception 'fixture needs a second professor'; end if;

  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id)
  values (v_prof, 'zz-series course', 'ZZS', 'zzs-a-'||v_tag, 'BSIT-9A', '4th',
          '1st', '2026-2027', v_syl_long) returning id into v_a;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id)
  values (v_prof, 'zz-series course', 'ZZS', 'zzs-b-'||v_tag, 'BSIT-9B', '4th',
          '1st', '2026-2027', v_syl_long) returning id into v_b;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id)
  values (v_prof, 'zz-series course', 'ZZS', 'zzs-c-'||v_tag, 'BSIT-9C', '4th',
          '1st', '2026-2027', v_syl_short) returning id into v_c;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id)
  values (v_other, 'zz-series elsewhere', 'ZZX', 'zzx-d-'||v_tag, 'BSIT-9D', '4th',
          '1st', '2026-2027', v_syl_long) returning id into v_d;

  -- A group set per class, because a set belongs to one class and a group
  -- project therefore cannot share one across sections.
  insert into public.group_sets (class_id, name, mode)
  values (v_a, 'zz-set-A', 'manual') returning id into v_sa;
  insert into public.group_sets (class_id, name, mode)
  values (v_b, 'zz-set-B', 'manual') returning id into v_sb;
  insert into public.groups (set_id, name) values (v_sa, 'A1') returning id into v_ga;
  insert into public.groups (set_id, name) values (v_sb, 'B1') returning id into v_gb;

  if v_stu is not null then
    insert into public.class_members (class_id, student_id) values (v_a, v_stu);
    insert into public.group_members (group_id, set_id, student_id) values (v_ga, v_sa, v_stu);
  end if;

  insert into fx (k, v) values
    ('prof', v_prof), ('other', v_other), ('stu', v_stu),
    ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('sa', v_sa), ('sb', v_sb);
end $do$;

-- -------------------------------------------------------- creating a series

do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_a uuid := (select v from fx where k = 'a');
  v_b uuid := (select v from fx where k = 'b');
  ids uuid[]; n int; v_series uuid;
begin
  perform pg_temp.act_as(v_prof);

  ids := public.create_project_series(
    jsonb_build_array(
      jsonb_build_object('class_id', v_a, 'group_set_id', null),
      jsonb_build_object('class_id', v_b, 'group_set_id', null)),
    'zz two sections', 'activity', null, 'The brief.', 1, 2, 'individual',
    100, now() + interval '7 days', null,
    jsonb_build_array(jsonb_build_object('label','Correctness','description','','max_points',50))
  );

  perform pg_temp.must_be('one project per section', array_length(ids, 1) = 2);

  select count(distinct series_id) into n from public.projects where id = any(ids);
  perform pg_temp.must_be('both carry the same series', n = 1);

  select series_id into v_series from public.projects where id = ids[1];
  perform pg_temp.must_be('the series is set, not null', v_series is not null);

  select count(*) into n from public.projects
   where id = any(ids) and class_id in (v_a, v_b);
  perform pg_temp.must_be('one lands in each class, not two in one', n = 2);

  select count(*) into n from public.project_criteria where project_id = any(ids);
  perform pg_temp.must_be('the rubric is written to both', n = 2);

  -- The boards trigger still runs: these are ordinary inserts, not a bypass.
  select count(*) into n from public.project_boards where project_id = any(ids);
  perform pg_temp.must_be('each section got its boards', n > 0);

  perform pg_temp.act_as_service();
  insert into fx (k, v) values ('p_a', ids[1]), ('p_b', ids[2]), ('series', v_series);
end $do$;

-- A lone section is not a series: marking it as one would put a scope picker
-- in front of a professor with nothing to scope.
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_a uuid := (select v from fx where k = 'a');
  ids uuid[]; v_series uuid;
begin
  perform pg_temp.act_as(v_prof);
  ids := public.create_project_series(
    jsonb_build_array(jsonb_build_object('class_id', v_a, 'group_set_id', null)),
    'zz one section', 'activity', null, 'Brief.', 1, 1, 'individual',
    100, null, null,
    jsonb_build_array(jsonb_build_object('label','Done','description','','max_points',10)));
  select series_id into v_series from public.projects where id = ids[1];
  perform pg_temp.must_be('one section alone carries no series', v_series is null);
  perform pg_temp.act_as_service();
  insert into fx (k, v) values ('p_solo', ids[1]);
end $do$;

-- --------------------------------------------- the target list is not a way in

do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_a uuid := (select v from fx where k = 'a');
  v_b uuid := (select v from fx where k = 'b');
  v_d uuid := (select v from fx where k = 'd');
  n int;
begin
  perform pg_temp.act_as(v_prof);

  -- The control: the same call, without the class that is not theirs, works.
  perform pg_temp.must_allow('a professor may fan out across their own sections',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', null),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', null)),
      'zz control ok', 'activity', null, 'Brief.', 1, 1, 'individual',
      100, null, null, null)$sql$, v_a, v_b));

  perform pg_temp.must_refuse('but not into a class that is not theirs',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', null),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', null)),
      'zz reach', 'activity', null, 'Brief.', 1, 1, 'individual',
      100, null, null, null)$sql$, v_a, v_d));

  select count(*) into n from public.projects where title = 'zz reach';
  perform pg_temp.must_be('and the section that would have worked wrote nothing', n = 0);
  perform pg_temp.act_as_service();
end $do$;

-- ------------------------------------------------------ all sections, or none

do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_a uuid := (select v from fx where k = 'a');
  v_b uuid := (select v from fx where k = 'b');
  v_c uuid := (select v from fx where k = 'c');
  n int;
begin
  perform pg_temp.act_as(v_prof);

  -- Control: weeks 16-17 across the two long syllabi is fine.
  perform pg_temp.must_allow('weeks the syllabus has are accepted',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', null),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', null)),
      'zz late weeks ok', 'activity', null, 'Brief.', 16, 17, 'individual',
      100, null, null, null)$sql$, v_a, v_b));

  -- Section C's syllabus stops short, so the same span cannot exist there.
  perform pg_temp.must_refuse('a section whose syllabus is shorter refuses',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', null),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', null)),
      'zz partial', 'activity', null, 'Brief.', 16, 17, 'individual',
      100, null, null, null)$sql$, v_a, v_c));

  select count(*) into n from public.projects where title = 'zz partial';
  perform pg_temp.must_be('and no section is left holding half a fan-out', n = 0);
  perform pg_temp.act_as_service();
end $do$;

-- A group set belongs to a class, so it cannot be shared across sections.
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_a uuid := (select v from fx where k = 'a');
  v_b uuid := (select v from fx where k = 'b');
  v_sa uuid := (select v from fx where k = 'sa');
  v_sb uuid := (select v from fx where k = 'sb');
  n int;
begin
  perform pg_temp.act_as(v_prof);

  perform pg_temp.must_allow('each section may name its own arrangement',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', %L::uuid),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', %L::uuid)),
      'zz group ok', 'group_programming', null, 'Brief.', 1, 1, 'group',
      100, null, null, null)$sql$, v_a, v_sa, v_b, v_sb));

  perform pg_temp.must_refuse('one section cannot be given another''s groups',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', %L::uuid),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', %L::uuid)),
      'zz group wrong', 'group_programming', null, 'Brief.', 1, 1, 'group',
      100, null, null, null)$sql$, v_a, v_sa, v_b, v_sa));

  select count(*) into n from public.projects where title = 'zz group wrong';
  perform pg_temp.must_be('and that fan-out wrote nothing either', n = 0);

  select count(*) into n from public.projects p
   where p.title = 'zz group ok' and p.group_set_id is not null;
  perform pg_temp.must_be('both group projects kept their own set', n = 2);
  perform pg_temp.act_as_service();
end $do$;

-- ------------------------------------------------- one section, not the rest

/**
 * The reason the feature exists. A professor grants 9A an extension; 9B asked
 * for nothing and must be untouched.
 */
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_pa uuid := (select v from fx where k = 'p_a');
  v_pb uuid := (select v from fx where k = 'p_b');
  before_b timestamptz; after_a timestamptz; after_b timestamptz;
begin
  perform pg_temp.act_as(v_prof);
  select due_at into before_b from public.projects where id = v_pb;

  perform public.set_series_due(array[v_pa], now() + interval '21 days');

  select due_at into after_a from public.projects where id = v_pa;
  select due_at into after_b from public.projects where id = v_pb;

  perform pg_temp.must_be('the section given the extension moved',
    after_a > now() + interval '20 days');
  perform pg_temp.must_be('the section that asked for nothing did not',
    after_b is not distinct from before_b);
  perform pg_temp.act_as_service();
end $do$;

-- Closing, the same way: named sections only.
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_pa uuid := (select v from fx where k = 'p_a');
  v_pb uuid := (select v from fx where k = 'p_b');
  a timestamptz; b timestamptz; n int;
begin
  perform pg_temp.act_as(v_prof);
  perform public.set_series_locked(array[v_pb], true);

  select locked_at into a from public.projects where id = v_pa;
  select locked_at into b from public.projects where id = v_pb;
  perform pg_temp.must_be('the named section closed', b is not null);
  perform pg_temp.must_be('the other stayed open', a is null);

  perform public.set_series_locked(array[v_pa, v_pb], false);
  select count(*) into n from public.projects
   where id in (v_pa, v_pb) and locked_at is null;
  perform pg_temp.must_be('and both reopen when both are named', n = 2);
  perform pg_temp.act_as_service();
end $do$;

-- Editing the shared half, scoped the same way.
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_pa uuid := (select v from fx where k = 'p_a');
  v_pb uuid := (select v from fx where k = 'p_b');
  ta text; tb text; n int;
begin
  perform pg_temp.act_as(v_prof);

  perform public.update_project_series(
    array[v_pa], 'zz renamed for 9A', 'activity', null, 'A new brief.',
    1, 2, 100, null, null,
    jsonb_build_array(
      jsonb_build_object('label','One','description','','max_points',10),
      jsonb_build_object('label','Two','description','','max_points',10)));

  select title into ta from public.projects where id = v_pa;
  select title into tb from public.projects where id = v_pb;
  perform pg_temp.must_be('the named section was renamed', ta = 'zz renamed for 9A');
  perform pg_temp.must_be('the other kept its title', tb = 'zz two sections');

  select count(*) into n from public.project_criteria where project_id = v_pa;
  perform pg_temp.must_be('its rubric was replaced', n = 2);
  select count(*) into n from public.project_criteria where project_id = v_pb;
  perform pg_temp.must_be('the other rubric was left alone', n = 1);

  -- Both sections, and now they agree again.
  perform public.update_project_series(
    array[v_pa, v_pb], 'zz renamed for both', 'activity', null, 'Shared brief.',
    1, 2, 100, null, null, null);
  select count(*) into n from public.projects
   where id in (v_pa, v_pb) and title = 'zz renamed for both';
  perform pg_temp.must_be('naming both changes both', n = 2);

  select count(*) into n from public.project_criteria where project_id = v_pb;
  perform pg_temp.must_be('a null rubric leaves each section''s own alone', n = 1);
  perform pg_temp.act_as_service();
end $do$;

-- The group set is per section and is not part of the shared half.
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_sa uuid := (select v from fx where k = 'sa');
  v_sb uuid := (select v from fx where k = 'sb');
  ids uuid[]; n int;
begin
  perform pg_temp.act_as(v_prof);
  select array_agg(p.id order by c.section) into ids
    from public.projects p join public.classes c on c.id = p.class_id
   where p.title = 'zz group ok';

  perform public.update_project_series(
    ids, 'zz group renamed', 'group_programming', null, 'Brief.',
    1, 1, 100, null, null, null);

  select count(*) into n from public.projects
   where id = ids[1] and group_set_id = v_sa;
  perform pg_temp.must_be('9A still has its own groups after a shared edit', n = 1);
  select count(*) into n from public.projects
   where id = ids[2] and group_set_id = v_sb;
  perform pg_temp.must_be('9B still has its own groups after a shared edit', n = 1);
  perform pg_temp.act_as_service();
end $do$;

-- --------------------------------------------- what the target list refuses

do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_other uuid := (select v from fx where k = 'other');
  v_stu uuid := (select v from fx where k = 'stu');
  v_pa uuid := (select v from fx where k = 'p_a');
  v_pb uuid := (select v from fx where k = 'p_b');
  v_solo uuid := (select v from fx where k = 'p_solo');
  t text;
begin
  perform pg_temp.act_as(v_prof);

  -- Control first: the same statement, with both from one series, works.
  perform pg_temp.must_allow('two sections of one series may be named together',
    format('select public.set_series_due(array[%L::uuid, %L::uuid], null)', v_pa, v_pb));

  perform pg_temp.must_refuse('a project from outside the series may not join them',
    format('select public.set_series_due(array[%L::uuid, %L::uuid], null)', v_pa, v_solo));

  perform pg_temp.must_refuse('an empty list is refused rather than doing nothing quietly',
    'select public.set_series_due(array[]::uuid[], null)');

  -- Another professor holds no target here at all.
  perform pg_temp.act_as(v_other);
  perform pg_temp.must_refuse('another professor cannot move this deadline',
    format('select public.set_series_due(array[%L::uuid], now())', v_pa));

  if v_stu is not null then
    perform pg_temp.act_as(v_stu);
    perform pg_temp.must_refuse('nor can a student in the class',
      format('select public.set_series_due(array[%L::uuid], now())', v_pa));
    perform pg_temp.must_refuse('nor close it',
      format('select public.set_series_locked(array[%L::uuid], true)', v_pa));
    perform pg_temp.must_refuse('nor rewrite the brief',
      format($sql$select public.update_project_series(
        array[%L::uuid], 'hijacked', 'activity', null, 'x', 1, 1, 100, null, null, null)$sql$,
        v_pa));
  end if;

  perform pg_temp.act_as(v_prof);
  select title into t from public.projects where id = v_pa;
  perform pg_temp.must_be('so the project still says what its professor wrote',
    t = 'zz renamed for both');
  perform pg_temp.act_as_service();
end $do$;

-- A student may not open a series of their own, in their own class or any other.
do $do$
declare
  v_stu uuid := (select v from fx where k = 'stu');
  v_a uuid := (select v from fx where k = 'a');
  v_b uuid := (select v from fx where k = 'b');
begin
  if v_stu is null then return; end if;
  perform pg_temp.act_as(v_stu);
  perform pg_temp.must_refuse('a student cannot create a project series',
    format($sql$select public.create_project_series(
      jsonb_build_array(jsonb_build_object('class_id', %L::uuid, 'group_set_id', null),
                        jsonb_build_object('class_id', %L::uuid, 'group_set_id', null)),
      'zz student', 'activity', null, 'Brief.', 1, 1, 'individual',
      100, null, null, null)$sql$, v_a, v_b));
  perform pg_temp.act_as_service();
end $do$;

-- ------------------------------------------------------------ what is seen

/**
 * `project_series_members` is security_invoker and carries no rule of its own,
 * so this asks the same question as three different people.
 */
do $do$
declare
  v_prof uuid := (select v from fx where k = 'prof');
  v_other uuid := (select v from fx where k = 'other');
  v_stu uuid := (select v from fx where k = 'stu');
  v_series uuid := (select v from fx where k = 'series');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.project_series_members where series_id = v_series;
  perform pg_temp.must_be('the professor sees both sections of their series', n = 2);

  perform pg_temp.act_as(v_other);
  select count(*) into n from public.project_series_members where series_id = v_series;
  perform pg_temp.must_be('another professor sees none of it', n = 0);

  if v_stu is not null then
    perform pg_temp.act_as(v_stu);
    select count(*) into n from public.project_series_members where series_id = v_series;
    -- Enrolled in 9A only: the sibling in 9B is somebody else's class.
    perform pg_temp.must_be('a student sees only the section they are in', n = 1);
  end if;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.project_series_members
   where series_id = v_series and section = 'BSIT-9A';
  perform pg_temp.must_be('and the view names the section', n = 1);
  perform pg_temp.act_as_service();
end $do$;

-- Every project that already existed is untouched by any of this.
do $do$
declare n int;
begin
  select count(*) into n from public.projects
   where series_id is not null and title not like 'zz%';
  perform pg_temp.must_be('no project outside this suite was put in a series', n = 0);
end $do$;

rollback;
