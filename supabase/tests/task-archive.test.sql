-- Task archive — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/task-archive.test.sql

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  prof uuid := gen_random_uuid();
  s1   uuid := gen_random_uuid();
  s2   uuid := gen_random_uuid();
  res uuid; cls uuid; st uuid; grp uuid; proj uuid; board uuid;
  mine uuid; theirs uuid; set_task uuid;
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (s1), (s2)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (prof, prof::text || '@test.invalid', 'Arch', 'Prof', 'faculty', 'active', true),
         (s1,   s1::text   || '@test.invalid', 'Arch', 'One',  'student', 'active', false),
         (s2,   s2::text   || '@test.invalid', 'Arch', 'Two',  'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Archive syllabus', 'x/a.pdf', 'a.pdf') returning id into res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, n, 'Week ' || n from generate_series(1, 4) as n;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Archive', 'ZZAR', 'ZZ-AR-1', 'BSIT 9A', '3rd', '1st', '2026-2027',
          res, date '2026-07-20', date '2026-08-16')
  returning id into cls;
  insert into public.class_members (class_id, student_id, status) values (cls, s1, 'active'), (cls, s2, 'active');
  insert into public.group_sets (class_id, name, mode) values (cls, 'Set A', 'manual') returning id into st;
  insert into public.groups (set_id, name, position) values (st, 'Archivers', 1) returning id into grp;
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (grp, st, s1, prof), (grp, st, s2, prof);
  insert into public.projects (class_id, created_by, title, type, audience, group_set_id, start_week, end_week)
  values (cls, prof, 'zz Archive project', 'activity', 'group', st, 1, 2) returning id into proj;
  select id into board from public.project_boards where project_id = proj and group_id = grp;
  if board is null then
    insert into public.project_boards (project_id, group_id) values (proj, grp) returning id into board;
  end if;

  insert into public.project_tasks (board_id, title, created_by, author_role, weight)
  values (board, 'Set by the professor', prof, 'professor', 2) returning id into set_task;

  perform pg_temp.act_as(s1);
  insert into public.project_tasks (board_id, title, created_by, weight)
  values (board, 'Mine to archive', s1, 3) returning id into mine;
  perform pg_temp.act_as(s2);
  insert into public.project_tasks (board_id, title, created_by, weight)
  values (board, 'Somebody else''s', s2, 1) returning id into theirs;

  perform pg_temp.act_as_service();
  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values ('prof', prof), ('s1', s1), ('s2', s2), ('board', board),
                        ('mine', mine), ('theirs', theirs), ('set_task', set_task);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ class tasks

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  s1 uuid := (select v from fx where k = 's1');
  s2 uuid := (select v from fx where k = 's2');
  board uuid := (select v from fx where k = 'board');
  mine uuid := (select v from fx where k = 'mine');
  theirs uuid := (select v from fx where k = 'theirs');
  set_task uuid := (select v from fx where k = 'set_task');
  cap_before numeric; cap_after numeric;
begin
  perform pg_temp.act_as(s1);
  perform pg_temp.must_refuse('a student cannot archive a groupmate''s task',
    format('select public.archive_class_task(%L, true)', theirs));
  perform pg_temp.must_refuse('a student cannot archive a task the professor set',
    format('select public.archive_class_task(%L, true)', set_task));

  -- The archive columns only move through the archive function: hiding a row
  -- by hand fails the select policy, and archived_by is pinned by the guard.
  -- Refused or pinned, depending on how the statement is planned — either way
  -- the row must come out unarchived.
  begin
    update public.project_tasks set archived_at = now(), archived_by = s1 where id = theirs;
  exception when others then null;
  end;
  begin
    execute format('update public.project_tasks set archived_at = now() where id = %L', theirs);
  exception when others then null;
  end;
  update public.project_tasks set archived_by = s1 where id = theirs;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student cannot archive by writing the archive columns directly',
    (select archived_at is null and archived_by is null from public.project_tasks where id = theirs));
  perform pg_temp.act_as(s1);

  perform pg_temp.act_as_service();
  cap_before := public.board_member_cap(board);

  perform pg_temp.act_as(s1);
  perform public.archive_class_task(mine, true);
  perform pg_temp.must_be('a student archives a task they added', true);
  perform pg_temp.must_be('...and it leaves their board',
    not exists (select 1 from public.project_tasks where id = mine));
  perform pg_temp.must_be('...and lists under their archived tasks',
    exists (select 1 from public.list_my_archived_class_tasks() where id = mine));

  perform pg_temp.act_as(s2);
  perform pg_temp.must_be('a groupmate no longer sees it',
    not exists (select 1 from public.project_tasks where id = mine));
  perform pg_temp.must_be('...nor in their own archive',
    not exists (select 1 from public.list_my_archived_class_tasks() where id = mine));
  perform pg_temp.must_refuse('a groupmate cannot restore it',
    format('select public.archive_class_task(%L, false)', mine));
  perform pg_temp.must_refuse('a groupmate cannot delete it',
    format('select public.delete_archived_class_task(%L)', mine));

  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('the professor''s board leaves it out too',
    not exists (select 1 from public.project_tasks where id = mine));

  perform pg_temp.act_as_service();
  cap_after := public.board_member_cap(board);
  perform pg_temp.must_be('its weight stops counting toward claim limits', cap_after < cap_before);

  perform pg_temp.act_as(s1);
  update public.project_tasks set title = 'Renamed while archived' where id = mine;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an archived task cannot be edited',
    (select title from public.project_tasks where id = mine) = 'Mine to archive');

  perform pg_temp.act_as(s1);
  perform public.archive_class_task(mine, false);
  perform pg_temp.must_be('restoring puts it back on the board',
    exists (select 1 from public.project_tasks where id = mine and archived_at is null));

  perform public.archive_class_task(mine, true);
  perform pg_temp.act_as(prof);
  perform public.archive_class_task(mine, false);
  perform pg_temp.act_as(s1);
  perform pg_temp.must_be('the professor can restore it as well',
    exists (select 1 from public.project_tasks where id = mine));

  perform public.archive_class_task(mine, true);
  perform public.delete_archived_class_task(mine);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting from the archive removes it for good',
    not exists (select 1 from public.project_tasks where id = mine));
end $$;

-- ------------------------------------------------------------------ work tasks

do $$
declare
  ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  owner uuid; maker uuid; other uuid;
  v_project uuid; v_inv uuid; t uuid; i int;
begin
  perform pg_temp.act_as_service();
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-tarch-' || i || '@example.test', '',
            jsonb_build_object('first_name', 'Zztarch', 'last_name', 'P' || i, 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set status = 'active' where id = any(ids);
  owner := ids[1]; maker := ids[2]; other := ids[3];

  perform pg_temp.act_as(owner);
  select (public.create_general_project('Zz Archive work')).id into v_project;
  for i in 2..3 loop
    perform pg_temp.act_as(owner);
    select id into v_inv from public.invite_to_general_project(v_project, ids[i]);
    perform pg_temp.act_as(ids[i]);
    perform public.respond_general_invitation(v_inv, true);
  end loop;

  perform pg_temp.act_as(maker);
  insert into public.general_tasks (project_id, title) values (v_project, 'Maker''s task') returning id into t;
  perform pg_temp.act_as(owner);
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t, v_project, other);

  perform pg_temp.act_as(other);
  perform pg_temp.must_refuse('a member cannot archive a work task somebody else added',
    format('select public.archive_general_task(%L, true)', t));

  perform pg_temp.act_as(maker);
  perform public.archive_general_task(t, true);
  perform pg_temp.must_be('its creator archives it even after somebody took it',
    (select archived_by = maker from public.general_tasks where id = t));
end $$;

do $$ begin raise notice 'task archive: all passed'; end $$;

rollback;
