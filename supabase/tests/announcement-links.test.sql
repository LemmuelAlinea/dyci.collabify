-- Announcement links — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/announcement-links.test.sql

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  prof  uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  st    uuid := gen_random_uuid();
  cls   uuid; cls2 uuid; theirs uuid;
  proj  uuid; proj2 uuid; board uuid; origin uuid := gen_random_uuid();
  ann   uuid;
  res   uuid;
  ok    jsonb;
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (other), (st)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (prof,  prof::text  || '@test.invalid', 'Link', 'Prof',  'faculty', 'active', true),
         (other, other::text || '@test.invalid', 'Link', 'Other', 'faculty', 'active', true),
         (st,    st::text    || '@test.invalid', 'Link', 'Stud',  'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Links syllabus', 'x/l.pdf', 'l.pdf') returning id into res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, n, 'Week ' || n from generate_series(1, 4) as n;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester,
                              school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Links A', 'ZZLA', 'ZZ-LK-1', 'BSIT 9L', '3rd', '1st', '2099-2100',
          res, date '2026-07-20', date '2026-08-16') returning id into cls;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester,
                              school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Links B', 'ZZLB', 'ZZ-LK-2', 'BSIT 9M', '3rd', '1st', '2099-2100',
          res, date '2026-07-20', date '2026-08-16') returning id into cls2;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (other, 'zz Links C', 'ZZLC', 'ZZ-LK-3', 'BSIT 9N', '3rd', '1st', '2099-2100') returning id into theirs;
  insert into public.class_members (class_id, student_id, status) values (cls, st, 'active');

  insert into public.projects (class_id, created_by, title, type, audience, start_week, end_week)
  values (cls, prof, 'zz Linked project', 'activity', 'individual', 1, 2) returning id into proj;
  insert into public.projects (class_id, created_by, title, type, audience, start_week, end_week)
  values (cls2, prof, 'zz Other class project', 'activity', 'individual', 1, 2) returning id into proj2;
  select id into board from public.project_boards where project_id = proj and student_id = st;
  if board is null then
    insert into public.project_boards (project_id, student_id) values (proj, st) returning id into board;
  end if;
  insert into public.project_tasks (board_id, origin_id, title, created_by, author_role, weight)
  values (board, origin, 'zz Set task', prof, 'professor', 1);

  -- The author links a class they teach, a project here and a task here.
  perform pg_temp.act_as(prof);
  ok := jsonb_build_array(
    jsonb_build_object('kind', 'class', 'id', cls2, 'label', 'zz Links B'),
    jsonb_build_object('kind', 'project', 'id', proj, 'label', 'zz Linked project'),
    jsonb_build_object('kind', 'task', 'id', origin, 'project_id', proj, 'label', 'zz Set task'));
  insert into public.announcements (class_id, author_id, title, body, links)
  values (cls, prof, 'zz With links', 'See these.', ok) returning id into ann;
  perform pg_temp.must_be('a professor posts an announcement with three links',
    (select jsonb_array_length(links) from public.announcements where id = ann) = 3);
  insert into public.announcements (class_id, author_id, title, body)
  values (cls, prof, 'zz No links', 'Plain.');
  perform pg_temp.must_be('links default to an empty list',
    (select links = '[]'::jsonb from public.announcements where title = 'zz No links' and class_id = cls));

  -- What the trigger refuses.
  perform pg_temp.must_refuse('a class the author does not teach',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'class', 'id', theirs, 'label', 'C'))));
  perform pg_temp.must_refuse('a project from another class',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'project', 'id', proj2, 'label', 'P'))));
  perform pg_temp.must_refuse('a task named under the wrong project',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'task', 'id', origin, 'project_id', proj2, 'label', 'T'))));
  perform pg_temp.must_refuse('a task with no project',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'task', 'id', origin, 'label', 'T'))));
  perform pg_temp.must_refuse('an unknown kind',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'url', 'id', proj, 'label', 'U'))));
  perform pg_temp.must_refuse('an id that is not a uuid',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'project', 'id', 'javascript:alert(1)', 'label', 'X'))));
  perform pg_temp.must_refuse('a link with no name',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_array(jsonb_build_object('kind', 'project', 'id', proj, 'label', '  '))));
  perform pg_temp.must_refuse('more than eight links',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           (select jsonb_agg(jsonb_build_object('kind', 'project', 'id', proj, 'label', 'P'))
              from generate_series(1, 9))));
  perform pg_temp.must_refuse('links that are not a list',
    format($q$insert into public.announcements (class_id, author_id, title, body, links)
              values (%L, %L, 'x', 'x', %L)$q$, cls, prof,
           jsonb_build_object('kind', 'project', 'id', proj, 'label', 'P')));

  -- Editing: a bad link is refused, removing them all is fine.
  perform pg_temp.must_refuse('editing in a project from another class',
    format($q$update public.announcements set links = %L where id = %L$q$,
           jsonb_build_array(jsonb_build_object('kind', 'project', 'id', proj2, 'label', 'P')), ann));
  update public.announcements set links = '[]'::jsonb where id = ann;
  perform pg_temp.must_be('the author removes every link',
    (select links = '[]'::jsonb from public.announcements where id = ann));
  update public.announcements set links = ok where id = ann;
  update public.announcements set title = 'zz With links, renamed' where id = ann;
  perform pg_temp.must_be('editing the title keeps the links',
    (select jsonb_array_length(links) from public.announcements where id = ann) = 3);

  -- The student reads the links with the announcement, and cannot write them.
  perform pg_temp.act_as(st);
  perform pg_temp.must_be('a student in the class reads the links',
    (select jsonb_array_length(links) from public.announcements where id = ann) = 3);
  perform pg_temp.must_be('a student resolves the task link to their own copy',
    (select count(*) from public.project_tasks where origin_id = origin) = 1);
  update public.announcements set links = '[]'::jsonb where id = ann;
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('a student cannot change the links',
    (select jsonb_array_length(links) from public.announcements where id = ann) = 3);
end $$;

rollback;
