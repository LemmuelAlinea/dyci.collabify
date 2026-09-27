-- Deactivated professors, restoring into a full class, and borrowed syllabi. Rolls back.
--
--   node scripts/db.mjs supabase/tests/teaching-guards.test.sql

begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.svc() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_other uuid; v_a uuid; v_b uuid;
  r_mine uuid; r_theirs uuid; r_program uuid;
  res jsonb;
  n int;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
    join public.profiles p on p.id = c.professor_id and p.status = 'active'
   where c.archived_at is null
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select id into v_other from public.profiles where role = 'faculty' and id <> v_prof order by created_at limit 1;

  ------------------------------------------------------------------ 3. syllabus
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_prof, 'syllabus', 'Mine', v_prof || '/mine.pdf', 'mine.pdf') returning id into r_mine;
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_other, 'syllabus', 'Theirs', v_other || '/theirs.pdf', 'theirs.pdf') returning id into r_theirs;
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name, program_wide)
  values (v_other, 'syllabus', 'Program', v_other || '/program.pdf', 'program.pdf', true) returning id into r_program;

  perform pg_temp.act_as(v_prof);
  begin
    update public.classes set syllabus_id = r_theirs where id = v_class;
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a professor cannot attach another professor''s syllabus', refused);

  update public.classes set syllabus_id = r_mine where id = v_class;
  perform pg_temp.ok('...but attaches their own',
    (select syllabus_id from public.classes where id = v_class) = r_mine);

  update public.classes set syllabus_id = r_program where id = v_class;
  perform pg_temp.ok('...and one the program office published',
    (select syllabus_id from public.classes where id = v_class) = r_program);

  update public.classes set name = name where id = v_class;
  perform pg_temp.ok('re-saving a class with an unchanged syllabus still works', true);

  ------------------------------------------------------------------ 2. restoring into a full class
  perform pg_temp.svc();
  update public.class_members set status = 'removed', removed_at = now(), removed_by = v_prof
   where class_id = v_class and student_id = v_a;
  select count(*) into n from public.class_members where class_id = v_class and status = 'active';
  update public.classes set student_cap = n where id = v_class;

  perform pg_temp.act_as(v_prof);
  res := public.restore_class_member(v_class, v_a);
  perform pg_temp.ok('a full class refuses to take a removed student back', res ->> 'result' = 'full');
  perform pg_temp.svc();
  perform pg_temp.ok('...and they stay removed',
    (select status from public.class_members where class_id = v_class and student_id = v_a) = 'removed');

  update public.classes set student_cap = n + 1 where id = v_class;
  perform pg_temp.act_as(v_prof);
  res := public.restore_class_member(v_class, v_a);
  perform pg_temp.ok('with a seat free, they come back', res ->> 'result' = 'restored');

  ------------------------------------------------------------------ 1. a deactivated professor
  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('an active professor teaches their class', public.is_class_professor(v_class));

  perform pg_temp.svc();
  update public.profiles set status = 'rejected' where id = v_prof;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('a deactivated professor no longer teaches it', not public.is_class_professor(v_class));
  perform pg_temp.ok('...cannot see it', not exists (select 1 from public.classes where id = v_class));
  update public.classes set name = 'Taken over' where id = v_class;
  perform pg_temp.svc();
  perform pg_temp.ok('...cannot rename it', (select name from public.classes where id = v_class) <> 'Taken over');

  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('...cannot read their own resources', not exists (select 1 from public.teaching_resources where id = r_mine));
  res := public.restore_class_member(v_class, v_b);
  perform pg_temp.ok('...and cannot restore students', res ->> 'result' = 'not_allowed');

  perform pg_temp.svc();
  update public.profiles set status = 'active' where id = v_prof;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('reactivated, they teach it again', public.is_class_professor(v_class));
  perform pg_temp.svc();
end $$;

rollback;
