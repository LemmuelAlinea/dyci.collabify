-- The Archive page and Trash for archived items — rolled back at the end.
--
--   node scripts/db.mjs supabase/tests/archive-page.test.sql

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.svc() returns void
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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.ok(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.listed(p_kind text, p_id uuid) returns boolean
language sql as $$
  select exists (select 1 from public.list_my_archive() a where a.kind = p_kind and a.id = p_id);
$$;

create or replace function pg_temp.trashed(p_kind text, p_id uuid) returns boolean
language sql as $$
  select exists (select 1 from public.list_my_trash() t where t.kind = p_kind and t.id = p_id);
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  prof uuid := gen_random_uuid();
  s1   uuid := gen_random_uuid();
  s2   uuid := gen_random_uuid();
  res uuid; cls uuid; st uuid; grp uuid; empty_grp uuid; proj uuid; proj2 uuid; board uuid;
  mine uuid; other uuid;
  sp public.general_spaces; wp public.general_projects; wp2 public.general_projects;
  team public.general_space_teams; wt uuid;
begin
  perform pg_temp.svc();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (s1), (s2)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (prof, prof::text || '@test.invalid', 'Arc', 'Prof', 'faculty', 'active', true),
         (s1,   s1::text   || '@test.invalid', 'Arc', 'One',  'student', 'active', false),
         (s2,   s2::text   || '@test.invalid', 'Arc', 'Two',  'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Arc syllabus', 'x/a.pdf', 'a.pdf') returning id into res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, n, 'Week ' || n from generate_series(1, 4) as n;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Arc', 'ZZAP', 'ZZ-AP-1', 'BSIT 9B', '3rd', '1st', '2026-2027',
          res, date '2026-07-20', date '2026-08-16')
  returning id into cls;
  insert into public.class_members (class_id, student_id, status) values (cls, s1, 'active'), (cls, s2, 'active');
  insert into public.group_sets (class_id, name, mode) values (cls, 'Set A', 'manual') returning id into st;
  insert into public.groups (set_id, name, position) values (st, 'Workers', 1) returning id into grp;
  insert into public.groups (set_id, name, position) values (st, 'Nobody yet', 2) returning id into empty_grp;
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (grp, st, s1, prof), (grp, st, s2, prof);
  insert into public.projects (class_id, created_by, title, type, audience, group_set_id, start_week, end_week)
  values (cls, prof, 'zz Arc project', 'activity', 'group', st, 1, 2) returning id into proj;
  insert into public.projects (class_id, created_by, title, type, audience, group_set_id, start_week, end_week)
  values (cls, prof, 'zz Arc project two', 'activity', 'group', st, 1, 2) returning id into proj2;
  select id into board from public.project_boards where project_id = proj and group_id = grp;

  perform pg_temp.act_as(s1);
  insert into public.project_tasks (board_id, title, created_by) values (board, 'Mine', s1) returning id into mine;
  insert into public.project_tasks (board_id, title, created_by) values (board, 'Still live', s1);
  perform pg_temp.act_as(s2);
  insert into public.project_tasks (board_id, title, created_by) values (board, 'Other', s2) returning id into other;

  -- Work: the professor owns a space; s1 is a member of it and of a project.
  perform pg_temp.act_as(prof);
  sp := public.create_general_space('zz Arc space', '');
  wp := public.create_general_project('zz Arc work', '', null, null, null, null, sp.id);
  wp2 := public.create_general_project('zz Arc work two', '', null, null, null, null, sp.id);
  team := public.create_general_space_team(sp.id, 'zz Arc team', '', '{}');
  perform pg_temp.svc();
  insert into public.general_space_members (space_id, user_id, level) values (sp.id, s1, 'member')
  on conflict do nothing;
  insert into public.general_members (project_id, user_id, level) values (wp.id, s1, 'member')
  on conflict do nothing;
  perform pg_temp.act_as(s1);
  insert into public.general_tasks (project_id, title, created_by) values (wp.id, 'Work task', s1)
  returning id into wt;

  perform pg_temp.svc();
  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select on fx to authenticated;
  insert into fx values ('prof', prof), ('s1', s1), ('s2', s2), ('cls', cls), ('grp', grp),
    ('empty_grp', empty_grp), ('proj', proj), ('proj2', proj2), ('mine', mine), ('other', other),
    ('space', sp.id), ('wp', wp.id), ('wp2', wp2.id), ('team', team.id), ('wt', wt), ('res', res);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ a student's class task

do $$
declare
  s1 uuid := (select v from fx where k = 's1');
  s2 uuid := (select v from fx where k = 's2');
  mine uuid := (select v from fx where k = 'mine');
begin
  perform pg_temp.act_as(s1);
  perform public.archive_class_task(mine, true);
  perform pg_temp.ok('a student''s archived task is on their Archive page', pg_temp.listed('class_task', mine));
  perform pg_temp.ok('...restorable and trashable by them',
    exists (select 1 from public.list_my_archive() where id = mine and restore_block is null and trash_block is null));

  perform pg_temp.act_as(s2);
  perform pg_temp.ok('a groupmate does not see it', not pg_temp.listed('class_task', mine));
  perform pg_temp.must_refuse('a groupmate cannot trash it',
    format('select public.trash_archived_item(''class_task'', %L)', mine));

  perform pg_temp.act_as(s1);
  perform public.trash_archived_item('class_task', mine);
  perform pg_temp.ok('trashed, it leaves the Archive page', not pg_temp.listed('class_task', mine));
  perform pg_temp.ok('...and shows in Trash', pg_temp.trashed('class_task', mine));
  perform pg_temp.ok('...and leaves My tasks → Archived tasks',
    not exists (select 1 from public.list_my_archived_class_tasks() where id = mine));
  begin
    update public.project_tasks set trashed_at = null, trashed_by = null where id = mine;
  exception when others then null;
  end;
  perform pg_temp.svc();
  perform pg_temp.ok('trash columns cannot be written directly',
    exists (select 1 from public.project_tasks where id = mine and trashed_at is not null));
  perform pg_temp.act_as(s1);

  perform pg_temp.act_as(s2);
  perform pg_temp.must_refuse('nobody else restores it from Trash',
    format('select public.restore_trashed_item(''class_task'', %L)', mine));

  perform pg_temp.act_as(s1);
  perform public.restore_trashed_item('class_task', mine);
  perform pg_temp.ok('restored from Trash, it is back in Archive', pg_temp.listed('class_task', mine));
  perform public.trash_archived_item('class_task', mine);
  perform public.delete_trashed_item('class_task', mine);
  perform pg_temp.svc();
  perform pg_temp.ok('deleted from Trash, it is gone', not exists (select 1 from public.project_tasks where id = mine));
end $$;

-- ------------------------------------------------------------------ the professor's class side

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  s1 uuid := (select v from fx where k = 's1');
  cls uuid := (select v from fx where k = 'cls');
  grp uuid := (select v from fx where k = 'grp');
  empty_grp uuid := (select v from fx where k = 'empty_grp');
  proj uuid := (select v from fx where k = 'proj');
  proj2 uuid := (select v from fx where k = 'proj2');
  other uuid := (select v from fx where k = 'other');
  space_of uuid;
begin
  -- A task a student archived shows to the professor too.
  perform pg_temp.act_as((select v from fx where k = 's2'));
  perform public.archive_class_task(other, true);
  perform pg_temp.act_as(prof);
  perform pg_temp.ok('the professor sees a task a student archived', pg_temp.listed('class_task', other));

  update public.groups set archived_at = now() where id in (grp, empty_grp);
  perform pg_temp.ok('archived groups are listed', pg_temp.listed('group', grp) and pg_temp.listed('group', empty_grp));
  perform pg_temp.ok('a group with work cannot go to Trash, and says why',
    (select trash_block from public.list_my_archive() where id = grp) like 'Workers has %');
  perform pg_temp.must_refuse('...and the function refuses it',
    format('select public.trash_archived_item(''group'', %L)', grp));
  perform public.trash_archived_item('group', empty_grp);
  perform pg_temp.ok('an empty group goes to Trash', pg_temp.trashed('group', empty_grp));
  perform pg_temp.ok('...and is hidden from the groups list',
    not exists (select 1 from public.groups where id = empty_grp));
  perform public.delete_trashed_item('group', empty_grp);

  update public.projects set archived_at = now() where id = proj2;
  perform pg_temp.ok('an archived class project is listed', pg_temp.listed('class_project', proj2));
  perform public.trash_archived_item('class_project', proj2);
  perform pg_temp.ok('a trashed class project is hidden', not exists (select 1 from public.projects where id = proj2));
  perform public.restore_trashed_item('class_project', proj2);
  perform pg_temp.ok('...and back once restored from Trash',
    exists (select 1 from public.projects where id = proj2 and archived_at is not null));
  update public.projects set archived_at = null where id = proj2;
  perform pg_temp.ok('restoring it from Archive takes it live', exists (select 1 from public.projects where id = proj2 and archived_at is null));

  perform pg_temp.act_as(s1);
  perform pg_temp.must_refuse('a student cannot trash a class project',
    format('select public.trash_archived_item(''class_project'', %L)', proj2));

  -- The whole class.
  perform pg_temp.act_as(prof);
  update public.classes set archived_at = now() where id = cls;
  perform pg_temp.ok('an archived class is listed', pg_temp.listed('class', cls));
  perform pg_temp.ok('...and its groups and projects are not', not pg_temp.listed('class_task', other));
  select space_id into space_of from public.classes where id = cls;
  perform public.trash_archived_item('class', cls);
  perform pg_temp.ok('a trashed class is hidden', not exists (select 1 from public.classes where id = cls));
  perform pg_temp.ok('...and so is its space', not exists (select 1 from public.general_spaces where id = space_of));
  perform pg_temp.ok('...and it shows in Trash', pg_temp.trashed('class', cls));
  perform public.delete_trashed_item('class', cls);
  perform pg_temp.svc();
  perform pg_temp.ok('deleted from Trash, the class and everything in it are gone',
    not exists (select 1 from public.classes where id = cls)
    and not exists (select 1 from public.projects where id = proj)
    and not exists (select 1 from public.general_spaces where id = space_of));
end $$;

-- ------------------------------------------------------------------ work

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  s1 uuid := (select v from fx where k = 's1');
  sp uuid := (select v from fx where k = 'space');
  wp uuid := (select v from fx where k = 'wp');
  wp2 uuid := (select v from fx where k = 'wp2');
  team uuid := (select v from fx where k = 'team');
  wt uuid := (select v from fx where k = 'wt');
begin
  perform pg_temp.act_as(s1);
  perform public.archive_general_task(wt, true);
  perform pg_temp.ok('a work task the student archived is listed', pg_temp.listed('work_task', wt));
  perform public.trash_archived_item('work_task', wt);
  perform pg_temp.ok('...goes to Trash and out of the project archive',
    pg_temp.trashed('work_task', wt) and not exists (select 1 from public.general_tasks where id = wt));
  perform public.restore_trashed_item('work_task', wt);
  perform pg_temp.ok('...and comes back to Archive', pg_temp.listed('work_task', wt));

  perform pg_temp.act_as(prof);
  perform public.archive_general_project(wp2, true);
  perform pg_temp.ok('the Owner sees the archived project', pg_temp.listed('project', wp2));
  perform public.trash_archived_item('project', wp2);
  perform pg_temp.ok('a trashed project leaves the space''s list',
    not exists (select 1 from public.general_project_overview where id = wp2));
  perform public.delete_trashed_item('project', wp2);
  perform pg_temp.svc();
  perform pg_temp.ok('...and is deleted from Trash', not exists (select 1 from public.general_projects where id = wp2));

  perform pg_temp.act_as(prof);
  perform public.archive_general_space_team(team, true);
  perform pg_temp.ok('an archived team is listed for its manager', pg_temp.listed('team', team));
  perform public.trash_archived_item('team', team);
  perform pg_temp.ok('...and leaves the space''s team archive',
    not exists (select 1 from public.list_general_space_teams(sp, true) where id = team));
  perform public.restore_trashed_item('team', team);

  perform public.archive_general_space(sp, true);
  perform pg_temp.ok('the Owner sees the archived space', pg_temp.listed('space', sp));
  perform pg_temp.ok('...and not the team inside it', not pg_temp.listed('team', team));
  perform pg_temp.act_as(s1);
  perform pg_temp.ok('a plain member does not', not pg_temp.listed('space', sp));
  perform pg_temp.must_refuse('...and cannot trash it',
    format('select public.trash_archived_item(''space'', %L)', sp));

  -- 30 days on, as whoever trashed it.
  perform pg_temp.act_as(prof);
  perform public.trash_archived_item('space', sp);
  perform pg_temp.svc();
  update public.general_spaces set trashed_at = now() - interval '31 days' where id = sp;
  perform public.purge_trash();
  perform pg_temp.ok('the purge deletes a space after 30 days', not exists (select 1 from public.general_spaces where id = sp));
  perform pg_temp.ok('...with the projects in it', not exists (select 1 from public.general_projects where id = wp));
end $$;

-- ------------------------------------------------------------------ what may not go comes back

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  t uuid;
  b uuid;
  cls uuid;
  p uuid;
begin
  -- A fresh class whose project the professor trashes, then loses.
  perform pg_temp.svc();
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Arc two', 'ZZAQ', 'ZZ-AQ-1', 'BSIT 9C', '3rd', '1st', '2026-2027',
          (select v from fx where k = 'res'), date '2026-07-20', date '2026-08-16')
  returning id into cls;
  insert into public.projects (class_id, created_by, title, type, audience, start_week, end_week, archived_at)
  values (cls, prof, 'zz Arc lost', 'activity', 'individual', 1, 2, now()) returning id into p;
  perform pg_temp.act_as(prof);
  perform public.trash_archived_item('class_project', p);
  perform pg_temp.svc();
  update public.profiles set can_teach = false, status = 'rejected' where id = prof;
  update public.projects set trashed_at = now() - interval '31 days' where id = p;
  perform public.purge_trash();
  perform pg_temp.ok('an item its trasher may no longer delete goes back to Archive',
    exists (select 1 from public.projects where id = p and archived_at is not null and trashed_at is null));
end $$;

rollback;
