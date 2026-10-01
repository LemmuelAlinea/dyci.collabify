-- Meetings — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/meetings.test.sql

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
  prof    uuid := gen_random_uuid();   -- teaches the class, owns the work space
  s1      uuid := gen_random_uuid();   -- in the class, group A
  s2      uuid := gen_random_uuid();   -- in the class, group B
  s3      uuid := gen_random_uuid();   -- in the class, group A
  worker  uuid := gen_random_uuid();   -- in the work space and its team
  outsider uuid := gen_random_uuid();  -- in nothing
  cls uuid; st uuid; ga uuid; gb uuid;
  space public.general_spaces%rowtype;
  team  public.general_space_teams%rowtype;
  project public.general_projects%rowtype;
  pteam uuid;
  code text;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (s1), (s2), (s3), (worker), (outsider)) as u(id);

  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (prof,     prof::text     || '@test.invalid', 'Meet', 'Prof',     'faculty', 'active', true),
         (s1,       s1::text       || '@test.invalid', 'Meet', 'One',      'student', 'active', false),
         (s2,       s2::text       || '@test.invalid', 'Meet', 'Two',      'student', 'active', false),
         (s3,       s3::text       || '@test.invalid', 'Meet', 'Three',    'student', 'active', false),
         (worker,   worker::text   || '@test.invalid', 'Meet', 'Worker',   'faculty', 'active', false),
         (outsider, outsider::text || '@test.invalid', 'Meet', 'Outsider', 'faculty', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status,
                                 can_teach = excluded.can_teach,
                                 first_name = excluded.first_name, last_name = excluded.last_name;

  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (prof, 'zz Meetings', 'ZZMT', 'ZZ-MT-1', 'BSIT 9M', '3rd', '1st', '2026-2027')
  returning id into cls;
  insert into public.class_members (class_id, student_id, status)
  values (cls, s1, 'active'), (cls, s2, 'active'), (cls, s3, 'active');
  insert into public.group_sets (class_id, name, mode) values (cls, 'Set M', 'manual') returning id into st;
  insert into public.groups (set_id, name, position) values (st, 'Group A', 1) returning id into ga;
  insert into public.groups (set_id, name, position) values (st, 'Group B', 2) returning id into gb;
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (ga, st, s1, prof), (ga, st, s3, prof), (gb, st, s2, prof);

  perform pg_temp.act_as(prof);
  space := public.create_general_space('zz Meeting space', '');
  code := public.set_general_space_join_code(space.id, true);
  perform pg_temp.act_as(worker);
  perform public.join_general_space(code);
  perform pg_temp.act_as(prof);
  team := public.create_general_space_team(space.id, 'zz Crew', '', array[worker]);
  project := public.create_general_project('zz Meeting project', '', null, null, null, null, space.id, team.id);
  select id into pteam from public.general_teams where project_id = project.id and space_team_id = team.id;

  perform pg_temp.act_as_service();
  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('prof', prof), ('s1', s1), ('s2', s2), ('s3', s3), ('worker', worker),
                        ('outsider', outsider), ('class', cls), ('ga', ga), ('gb', gb),
                        ('space', space.id), ('team', team.id), ('project', project.id),
                        ('pteam', pteam);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ classes and groups

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  s1 uuid := (select v from fx where k = 's1');
  s2 uuid := (select v from fx where k = 's2');
  outsider uuid := (select v from fx where k = 'outsider');
  cls uuid := (select v from fx where k = 'class');
  ga uuid := (select v from fx where k = 'ga');
  gb uuid := (select v from fx where k = 'gb');
  mc public.meetings;
  mg public.meetings;
  meet text := 'https://meet.google.com/abc-defg-hij';
begin
  perform pg_temp.act_as(s1);
  perform pg_temp.must_refuse('a student cannot schedule for the whole class',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'class', cls, 'Sync', '', meet));

  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse('a link that is not Zoom or Meet is refused',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'class', cls, 'Sync', '', 'https://example.com/meet'));
  perform pg_temp.must_refuse('a start time already past is refused',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() - interval ''2 hours'', 60)',
           'class', cls, 'Sync', '', meet));

  mc := public.create_meeting('class', cls, 'Class sync', '', meet, now() + interval '1 day', 60);
  perform pg_temp.must_be('the class faculty can schedule for the whole class', mc.id is not null);
  perform pg_temp.must_be('the platform is read from the link', mc.platform = 'google_meet');
  perform pg_temp.must_be('a Google Calendar invite link is taken, as Meet',
    (public.create_meeting('class', cls, 'Invite link', '', 'https://calendar.app.google/kBjhWJM22H7yeauq5',
                           now() + interval '1 day', 60)).platform = 'google_meet');
  perform pg_temp.must_refuse('a Google Calendar address that is not an invite is refused',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'class', cls, 'Sync', '', 'https://calendar.google.com/settings'));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('every student in the class is notified',
    (select count(*) from public.notifications where meeting_id = mc.id
       and type = 'meeting_scheduled' and user_id in (s1, s2, (select v from fx where k = 's3'))) = 3);
  perform pg_temp.must_be('...but not whoever scheduled it',
    not exists (select 1 from public.notifications where meeting_id = mc.id and user_id = prof));

  perform pg_temp.act_as(s1);
  perform pg_temp.must_be('a student sees the class meeting',
    exists (select 1 from public.meetings where id = mc.id));
  perform pg_temp.must_refuse('a student cannot cancel a class meeting',
    format('select public.cancel_meeting(%L)', mc.id));

  mg := public.create_meeting('group', ga, 'Group A huddle', '', 'https://us05web.zoom.us/j/123456789',
                              now(), 30);
  perform pg_temp.must_be('a student schedules for their own group', mg.id is not null);
  perform pg_temp.must_be('...and the class is filled in from the group', mg.class_id = cls);
  perform pg_temp.must_be('a Zoom link reads as Zoom', mg.platform = 'zoom');
  perform pg_temp.must_refuse('a student cannot schedule for another group',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'group', gb, 'Gatecrash', '', meet));
  perform pg_temp.must_be('the scheduler''s audiences hold their class, unschedulable, and their own group only',
    (select count(*) from public.meeting_audiences() where scope = 'class' and not can_create) = 1
    and (select array_agg(audience_id) from public.meeting_audiences() where scope = 'group') = array[ga]);

  perform pg_temp.act_as(s2);
  perform pg_temp.must_be('another group cannot see a group''s meeting',
    not exists (select 1 from public.meetings where id = mg.id));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a meeting started now tells the rest of the group it has started',
    exists (select 1 from public.notifications where meeting_id = mg.id
             and user_id = (select v from fx where k = 's3') and title like 'Meeting started:%'));
  perform pg_temp.must_be('...and not the student who started it',
    not exists (select 1 from public.notifications where meeting_id = mg.id and user_id = s1));

  perform pg_temp.act_as(prof);
  perform public.update_meeting(mc.id, 'Class sync', '', meet, now() + interval '2 days', 60);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('moving the time notifies the class',
    exists (select 1 from public.notifications where meeting_id = mc.id and user_id = s1 and type = 'meeting_changed'));

  perform pg_temp.act_as(prof);
  perform public.cancel_meeting(mc.id);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('cancelling notifies the class',
    (select count(*) from public.notifications where meeting_id = mc.id and type = 'meeting_cancelled') = 3);

  perform pg_temp.act_as(outsider);
  perform pg_temp.must_be('an outsider sees no class or group meeting',
    not exists (select 1 from public.list_my_meetings(now() - interval '1 day')));
end $$;

-- ------------------------------------------------------------------ work

do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  worker uuid := (select v from fx where k = 'worker');
  outsider uuid := (select v from fx where k = 'outsider');
  space uuid := (select v from fx where k = 'space');
  team uuid := (select v from fx where k = 'team');
  project uuid := (select v from fx where k = 'project');
  pteam uuid := (select v from fx where k = 'pteam');
  ms public.meetings; mp public.meetings; mt public.meetings; mpt public.meetings;
  zoom text := 'https://zoom.us/j/987654321';
begin
  perform pg_temp.act_as(worker);
  ms := public.create_meeting('space', space, 'All hands', '', zoom, now() + interval '3 hours', 45);
  mp := public.create_meeting('project', project, 'Project check-in', '', zoom, now() + interval '4 hours', 30);
  mt := public.create_meeting('space_team', team, 'Crew sync', '', zoom, now() + interval '5 hours', 30);
  mpt := public.create_meeting('project_team', pteam, 'Project crew', '', zoom, now() + interval '6 hours', 30);
  perform pg_temp.must_be('any member schedules for a space, project and both kinds of team',
    ms.id is not null and mp.id is not null and mt.id is not null and mpt.id is not null);
  perform pg_temp.must_be('a project meeting carries its space', mp.space_id = space);
  perform pg_temp.must_be('a project team meeting carries its project and space',
    mpt.project_id = project and mpt.space_id = space);

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the space owner is notified of a space meeting',
    exists (select 1 from public.notifications where meeting_id = ms.id and user_id = prof));

  perform pg_temp.act_as(outsider);
  perform pg_temp.must_be('an outsider sees none of the work meetings',
    not exists (select 1 from public.meetings where id in (ms.id, mp.id, mt.id, mpt.id)));
  perform pg_temp.must_refuse('an outsider cannot schedule in a space they are not in',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'space', space, 'Intrude', '', zoom));

  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('the space owner can cancel a member''s space meeting',
    (select can_manage from public.list_my_meetings(now()) where id = ms.id));
end $$;

-- ------------------------------------------------------------------ class board Files

/**
 * Opening a board's Files makes a hidden work project, in a hidden space, with
 * the board's students on it (class-files.sql). It must not turn up as a
 * meeting audience — the students meet as their group.
 */
do $$
declare
  prof uuid := (select v from fx where k = 'prof');
  s1 uuid := (select v from fx where k = 's1');
  res uuid; cls uuid; st uuid; grp uuid; proj uuid; board uuid; files uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Meetings syllabus', 'x/m.pdf', 'm.pdf') returning id into res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, n, 'Week ' || n from generate_series(1, 4) as n;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Meetings boards', 'ZZMB', 'ZZ-MB-1', 'BSIT 9B', '3rd', '1st', '2026-2027',
          res, date '2026-07-20', date '2026-08-16')
  returning id into cls;
  insert into public.class_members (class_id, student_id, status) values (cls, s1, 'active');
  insert into public.group_sets (class_id, name, mode) values (cls, 'Set B', 'manual') returning id into st;
  insert into public.groups (set_id, name, position) values (st, 'Board group', 1) returning id into grp;
  insert into public.group_members (group_id, set_id, student_id, added_by) values (grp, st, s1, prof);
  insert into public.projects (class_id, created_by, title, type, audience, group_set_id, start_week, end_week)
  values (cls, prof, 'zz Board project', 'activity', 'group', st, 1, 2) returning id into proj;
  select id into board from public.project_boards where project_id = proj and group_id = grp;
  if board is null then
    insert into public.project_boards (project_id, group_id) values (proj, grp) returning id into board;
  end if;

  perform pg_temp.act_as(s1);
  files := public.ensure_class_board_repo(board);
  perform pg_temp.must_be('the student is on their board''s hidden Files project', public.is_general_member(files));
  perform pg_temp.must_be('...which is not offered as a meeting audience',
    not exists (select 1 from public.meeting_audiences() where audience_id = files));
  perform pg_temp.must_be('...nor is its hidden space',
    not exists (select 1 from public.meeting_audiences() a
                  join public.general_projects p on p.space_id = a.audience_id
                 where p.id = files));
  perform pg_temp.must_be('...while their group is', exists (select 1 from public.meeting_audiences() where audience_id = grp));
  perform pg_temp.must_refuse('a meeting cannot be scheduled for a board''s Files project',
    format('select public.create_meeting(%L, %L, %L, %L, %L, now() + interval ''1 day'', 60)',
           'project', files, 'Files sync', '', 'https://meet.google.com/abc-defg-hij'));
end $$;

do $$ begin raise notice 'meetings: all passed'; end $$;

rollback;
