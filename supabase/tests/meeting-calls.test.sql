-- Collabify call access checks. Every fixture rolls back.
begin;

create or replace function pg_temp.must_be(p_label text, p_ok boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
    return;
  end;
  raise exception 'FAIL  % — it went through', p_label;
end;
$$;

do $$
begin
  perform pg_temp.must_be('new call feature is disabled before release',
    (select not meeting_calls_enabled from public.organization_settings where id));
  perform pg_temp.must_be('edge functions can run service-only lifecycle actions',
    has_function_privilege('service_role', 'public.confirm_meeting_live(uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.finish_meeting_call(uuid,text)', 'execute')
    and has_function_privilege('service_role', 'public.ban_meeting_call_participant(uuid,text,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.meeting_calls_to_reconcile(integer)', 'execute')
    and has_function_privilege('service_role', 'public.begin_meeting_recording(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.meeting_recordings_to_delete(integer)', 'execute')
    and has_function_privilege('service_role', 'public.sync_meeting_call_presence(uuid,text,uuid[])', 'execute'));
  perform pg_temp.must_be('chat and presence have no anonymous access or client edits',
    not has_table_privilege('anon', 'public.meeting_call_messages', 'select')
    and not has_table_privilege('anon', 'public.meeting_call_messages', 'insert')
    and not has_table_privilege('authenticated', 'public.meeting_call_messages', 'update')
    and not has_table_privilege('authenticated', 'public.meeting_call_messages', 'delete')
    and not has_table_privilege('authenticated', 'public.meeting_call_presence', 'select'));
  perform pg_temp.must_be('instant creation is signed-in only',
    not has_function_privilege('anon',
      'public.create_collabify_meeting_once(public.meeting_scope,uuid,text,text,integer,uuid)', 'execute')
    and has_function_privilege('authenticated',
      'public.create_collabify_meeting_once(public.meeting_scope,uuid,text,text,integer,uuid)', 'execute'));
  perform set_config('role', 'authenticated', true);
  perform pg_temp.must_refuse('members cannot enable calls',
    'update public.organization_settings set meeting_calls_enabled = true where id');
end $$;

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

-- A fresh class and work project avoid relying on live member ordering.
do $$
declare
  prof uuid := gen_random_uuid();
  coordinator uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  worker uuid := gen_random_uuid();
  stakeholder uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  cls uuid; set_id uuid; group_a uuid; group_b uuid;
  space public.general_spaces%rowtype;
  team public.general_space_teams%rowtype;
  project public.general_projects%rowtype;
  project_team uuid;
begin
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@example.test', '', now(), now()
    from (values (prof), (coordinator), (a), (b), (worker), (stakeholder), (outsider)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (prof, prof::text || '@example.test', 'Call', 'Teacher', 'member', 'active', true, true),
         (coordinator, coordinator::text || '@example.test', 'Call', 'Coordinator', 'member', 'active', true, true),
         (a, a::text || '@example.test', 'Call', 'A', 'student', 'active', false, false),
         (b, b::text || '@example.test', 'Call', 'B', 'student', 'active', false, false),
         (worker, worker::text || '@example.test', 'Call', 'Worker', 'member', 'active', false, true),
         (stakeholder, stakeholder::text || '@example.test', 'Call', 'Stakeholder', 'member', 'active', false, false),
         (outsider, outsider::text || '@example.test', 'Call', 'Outsider', 'member', 'active', false, false);
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (prof, 'zz Call class', 'ZZVC', 'ZZ-VC-1', 'BSIT 9V', '3rd', '1st', '2026-2027')
  returning id into cls;
  insert into public.general_space_members(space_id, user_id, level)
  select space_id, coordinator, 'manager' from public.classes where id = cls;
  insert into public.class_members (class_id, student_id, status) values (cls, a, 'active'), (cls, b, 'active');
  insert into public.group_sets (class_id, name, mode) values (cls, 'Call set', 'manual') returning id into set_id;
  insert into public.groups (set_id, name, position) values (set_id, 'Group A', 1) returning id into group_a;
  insert into public.groups (set_id, name, position) values (set_id, 'Group B', 2) returning id into group_b;
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (group_a, set_id, a, prof), (group_b, set_id, b, prof);
  perform pg_temp.act_as(prof);
  perform public.set_group_leader(group_a, a);
  space := public.create_general_space('zz Call space', '');
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values (space.id, worker, 'member');
  perform pg_temp.act_as(prof);
  team := public.create_general_space_team(space.id, 'Call crew', '', array[worker]);
  project := public.create_general_project('zz Call project', '', null, null, null, null, space.id, team.id);
  select id into project_team from public.general_teams where project_id = project.id and space_team_id = team.id;
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role)
  values (project.id, stakeholder, 'stakeholder');
  update public.organization_settings set meeting_calls_enabled = true where id;
  create temp table call_fx (k text primary key, v uuid) on commit drop;
  grant select, insert on call_fx to authenticated;
  insert into call_fx values ('prof', prof), ('coordinator', coordinator), ('a', a), ('b', b), ('worker', worker),
    ('stakeholder', stakeholder), ('outsider', outsider), ('class', cls),
    ('group_a', group_a), ('group_b', group_b), ('space', space.id),
    ('project', project.id), ('space_team', team.id), ('project_team', project_team);
end $$;

do $$
declare
  prof uuid := (select v from call_fx where k = 'prof');
  coordinator uuid := (select v from call_fx where k = 'coordinator');
  a uuid := (select v from call_fx where k = 'a');
  b uuid := (select v from call_fx where k = 'b');
  worker uuid := (select v from call_fx where k = 'worker');
  stakeholder uuid := (select v from call_fx where k = 'stakeholder');
  outsider uuid := (select v from call_fx where k = 'outsider');
  cls uuid := (select v from call_fx where k = 'class');
  group_a uuid := (select v from call_fx where k = 'group_a');
  group_b uuid := (select v from call_fx where k = 'group_b');
  m_class uuid; m_group uuid; m_space uuid; m_project uuid; m_space_team uuid; m_project_team uuid;
  instant_id uuid; v_request_key uuid := gen_random_uuid();
begin
  perform pg_temp.act_as(prof);
  m_class := (public.create_meeting('class', cls, 'Class call', '', null, now(), 60)).id;
  m_space := (public.create_meeting('space', (select v from call_fx where k = 'space'), 'Space call', '', null, now(), 60)).id;
  perform pg_temp.act_as(a);
  m_group := (public.create_meeting('group', group_a, 'Group call', '', null, now(), 60)).id;
  perform pg_temp.act_as(worker);
  m_space_team := (public.create_meeting('space_team', (select v from call_fx where k = 'space_team'), 'Team call', '', null, now(), 60)).id;
  m_project_team := (public.create_meeting('project_team', (select v from call_fx where k = 'project_team'), 'Project team call', '', null, now(), 60)).id;
  perform pg_temp.act_as(stakeholder);
  m_project := (public.create_meeting('project', (select v from call_fx where k = 'project'), 'Project call', '', null, now(), 60)).id;
  perform pg_temp.act_as_service();
  insert into call_fx values ('m_class', m_class), ('m_group', m_group), ('m_space', m_space),
    ('m_project', m_project), ('m_space_team', m_space_team), ('m_project_team', m_project_team);

  perform pg_temp.act_as(outsider);
  perform pg_temp.must_be('an outsider gets no call access row',
    not exists (select 1 from public.meeting_call_access(m_project)));
  perform pg_temp.act_as(b);
  perform pg_temp.must_be('another group cannot access the group call',
    not exists (select 1 from public.meeting_call_access(m_group)));
  perform pg_temp.must_be('a class student cannot start a class call',
    exists (select 1 from public.meeting_call_access(m_class) where not can_start));
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('faculty can start a class call',
    exists (select 1 from public.meeting_call_access(m_class) where can_start and can_host));
  perform pg_temp.act_as(coordinator);
  perform pg_temp.must_be('a teaching coordinator can start and host the class call',
    exists (select 1 from public.meeting_call_access(m_class) where can_start and can_host));
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('a group leader can start and host their group call',
    exists (select 1 from public.meeting_call_access(m_group) where can_start and can_host));
  perform pg_temp.act_as_service();
  update public.groups set leader_id = null where id = group_a;
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('a former group leader loses host controls',
    exists (select 1 from public.meeting_call_access(m_group) where can_start and not can_host));
  perform pg_temp.act_as_service();
  update public.groups set leader_id = a where id = group_a;
  perform pg_temp.act_as(worker);
  perform pg_temp.must_be('work-space and team members can start their calls',
    exists (select 1 from public.meeting_call_access(m_space) where can_start)
    and exists (select 1 from public.meeting_call_access(m_space_team) where can_start)
    and exists (select 1 from public.meeting_call_access(m_project_team) where can_start));
  perform pg_temp.must_be('an ordinary work member has no host controls before starting',
    exists (select 1 from public.meeting_call_access(m_space) where not can_host)
    and exists (select 1 from public.meeting_call_access(m_project_team) where not can_host));
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('current space, team and project managers have host controls',
    exists (select 1 from public.meeting_call_access(m_space) where can_host)
    and exists (select 1 from public.meeting_call_access(m_project) where can_host)
    and exists (select 1 from public.meeting_call_access(m_space_team) where can_host)
    and exists (select 1 from public.meeting_call_access(m_project_team) where can_host));
  perform public.set_general_team_leader((select v from call_fx where k = 'project_team'), worker);
  perform pg_temp.act_as(worker);
  perform pg_temp.must_be('a current project-team leader gains host controls',
    exists (select 1 from public.meeting_call_access(m_project_team) where can_host));
  perform pg_temp.act_as(prof);
  perform public.set_general_team_leader((select v from call_fx where k = 'project_team'), null);
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('a stakeholder can start a project call',
    exists (select 1 from public.meeting_call_access(m_project) where can_start and max_participants = 100));
  perform pg_temp.must_be('a scheduler is not automatically a host',
    exists (select 1 from public.meeting_call_access(m_project) where not can_host));
  instant_id := (public.create_collabify_meeting_once('project',
    (select v from call_fx where k = 'project'), 'Instant call', '', 60, v_request_key)).id;
  perform pg_temp.must_be('retrying instant creation reuses one meeting',
    instant_id = (public.create_collabify_meeting_once('project',
      (select v from call_fx where k = 'project'), 'Instant call', '', 60, v_request_key)).id
    and (select count(*) from public.meetings where request_key = v_request_key) = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('instant prejoin sends no schedule notice before connection',
    not exists (select 1 from public.notifications
                 where meeting_id = instant_id and type = 'meeting_scheduled'));
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.act_as(worker);
  perform pg_temp.must_refuse('another member cannot reuse an instant meeting key',
    format('select public.create_collabify_meeting_once(%L, %L, %L, %L, %s, %L)',
      'project', (select v from call_fx where k = 'project'), 'Instant call', '', 60, v_request_key));
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_refuse('a nonmember cannot start a class call',
    format('select public.begin_meeting_call(%L)', m_class));
end $$;

do $$
declare
  prof uuid := (select v from call_fx where k = 'prof');
  a uuid := (select v from call_fx where k = 'a');
  b uuid := (select v from call_fx where k = 'b');
  worker uuid := (select v from call_fx where k = 'worker');
  stakeholder uuid := (select v from call_fx where k = 'stakeholder');
  m_class uuid := (select v from call_fx where k = 'm_class');
  m_project uuid := (select v from call_fx where k = 'm_project');
  m_group uuid := (select v from call_fx where k = 'm_group');
  m_group_after_leave uuid;
  m_space uuid := (select v from call_fx where k = 'm_space');
  room text;
  second_room text;
  message_id uuid;
  v_recording_id uuid;
  recording_end timestamptz;
begin
  perform pg_temp.act_as(prof);
  select room_name into room from public.begin_meeting_call(m_class);
  perform pg_temp.must_be('a first Start claims one opaque room',
    room is not null and (select call_state = 'starting' and started_at is null
                            from public.meetings where id = m_class));
  select room_name into second_room from public.begin_meeting_call(m_class);
  perform pg_temp.must_be('duplicate Start keeps the first room', room = second_room);
  perform pg_temp.must_refuse('a signed-in user cannot mark a room live',
    format('select public.confirm_meeting_live(%L, %L)', m_class, room));
  perform pg_temp.must_refuse('a signed-in user cannot finish a room',
    format('select public.finish_meeting_call(%L, %L)', m_class, room));
  perform pg_temp.must_refuse('a signed-in user cannot lock a room',
    format('select public.set_meeting_call_lock(%L, true)', m_class));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a claimed room sends no started notice',
    not exists (select 1 from public.notifications where meeting_id = m_class and type = 'meeting_started'));
  perform public.confirm_meeting_live(m_class, room);
  perform public.confirm_meeting_live(m_class, room);
  perform pg_temp.must_be('one first connection sends one notice to each other class member',
    (select count(*) from public.notifications
      where meeting_id = m_class and type = 'meeting_started' and user_id in (a,b)) = 2
    and not exists (select 1 from public.notifications
                     where meeting_id = m_class and type = 'meeting_started' and user_id = prof));
  perform pg_temp.must_be('the call is live with actual start time',
    (select call_state = 'live' and started_at is not null and started_by = prof
       from public.meetings where id = m_class));
  perform public.finish_meeting_call(m_class, room);
  perform public.finish_meeting_call(m_class, room);
  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse('ended calls do not restart',
    format('select public.begin_meeting_call(%L)', m_class));

  perform pg_temp.act_as(stakeholder);
  select room_name into room from public.begin_meeting_call(m_project);
  perform pg_temp.act_as(worker);
  select room_name into second_room from public.begin_meeting_call(m_project);
  perform pg_temp.must_be('two audience members still claim only one room', room = second_room);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the first claimant stays starter',
    (select started_by = stakeholder from public.meetings where id = m_project));
  update public.meetings set starting_at = now() - interval '3 minutes' where id = m_project;
  perform pg_temp.act_as(worker);
  select room_name into second_room from public.begin_meeting_call(m_project);
  perform pg_temp.must_be('a timed-out, empty start can be reclaimed',
    second_room <> room and (select started_by = worker from public.meetings where id = m_project));
  perform pg_temp.act_as_service();
  perform public.confirm_meeting_live(m_project, second_room);
  perform public.sync_meeting_call_presence(m_project, second_room,
    array[worker, stakeholder]);
  perform pg_temp.must_be('recording bucket is private',
    exists (select 1 from storage.buckets where id = 'meeting-recordings' and not public));
  perform pg_temp.must_be('clients cannot write recording metadata',
    not has_table_privilege('authenticated', 'public.meeting_call_recordings', 'insert')
    and not has_table_privilege('authenticated', 'public.meeting_call_recordings', 'update')
    and not has_table_privilege('authenticated', 'public.meeting_call_recordings', 'delete'));
  perform pg_temp.must_refuse('a nonhost cannot start recording',
    format('select public.begin_meeting_recording(%L,%L)', m_project, stakeholder));
  v_recording_id := (public.begin_meeting_recording(m_project, worker)).id;
  perform pg_temp.must_be('one active recording has a private MP4 path',
    (select status = 'starting' and storage_path =
      'meetings/' || m_project || '/' || v_recording_id || '.mp4'
      from public.meeting_call_recordings where id = v_recording_id));
  perform pg_temp.must_refuse('a second active segment cannot start',
    format('select public.begin_meeting_recording(%L,%L)', m_project, worker));
  perform public.bind_meeting_recording_egress(v_recording_id, 'EG_test_recording');
  recording_end := now() - interval '1 minute';
  perform public.finish_meeting_recording(v_recording_id, 'EG_test_recording', true, recording_end);
  perform pg_temp.must_be('a finished segment expires exactly 30 days later',
    (select status = 'ready' and ended_at = recording_end
       and expires_at = recording_end + interval '30 days'
       from public.meeting_call_recordings where id = v_recording_id));
  perform pg_temp.must_be('unexpired recordings are not selected for deletion',
    not exists (select 1 from public.meeting_recordings_to_delete(10)
                where recording_id = v_recording_id));
  update public.meeting_call_recordings
     set status = 'processing', expires_at = now() - interval '1 minute'
   where id = v_recording_id;
  perform pg_temp.must_be('processing recordings are never selected for cleanup',
    not exists (select 1 from public.meeting_recordings_to_delete(10)
                 where recording_id = v_recording_id));
  update public.meeting_call_recordings set status = 'ready', expires_at = recording_end + interval '30 days'
   where id = v_recording_id;
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('current audience reads ready recording metadata',
    exists (select 1 from public.meeting_call_recordings where id = v_recording_id));
  perform pg_temp.must_refuse('clients cannot change recording state',
    format('update public.meeting_call_recordings set status = %L where id = %L',
      'ready', v_recording_id));
  perform pg_temp.act_as((select v from call_fx where k = 'outsider'));
  perform pg_temp.must_be('a nonmember cannot read recording metadata',
    not exists (select 1 from public.meeting_call_recordings where id = v_recording_id));
  perform pg_temp.act_as_service();
  update public.meeting_call_recordings set expires_at = now() - interval '1 minute'
   where id = v_recording_id;
  perform pg_temp.must_be('expired ready recordings are selected for cleanup',
    exists (select 1 from public.meeting_recordings_to_delete(10)
             where recording_id = v_recording_id));
  update public.meeting_call_recordings set status = 'failed' where id = v_recording_id;
  perform pg_temp.must_be('expired failed recordings are selected for cleanup',
    exists (select 1 from public.meeting_recordings_to_delete(10)
             where recording_id = v_recording_id));
  update public.meeting_call_recordings set status = 'deleting' where id = v_recording_id;
  perform pg_temp.must_be('failed deletion remains retryable',
    exists (select 1 from public.meeting_recordings_to_delete(10)
             where recording_id = v_recording_id));
  update public.meeting_call_recordings set expires_at = now() + interval '30 days'
   where id = v_recording_id;
  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse('a member outside the active room cannot chat',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, prof, 'Outside'));
  perform pg_temp.act_as(stakeholder);
  insert into public.meeting_call_messages(meeting_id, sender_id, body)
  values (m_project, stakeholder, 'Hello project') returning id into message_id;
  perform pg_temp.must_refuse('a chat sender cannot impersonate another member',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, worker, 'Impersonation'));
  perform pg_temp.must_refuse('empty chat is refused',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, stakeholder, '  '));
  perform pg_temp.must_refuse('overlong chat is refused',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, stakeholder, repeat('x', 2001)));
  perform pg_temp.act_as(worker);
  perform pg_temp.must_be('current members can read earlier chat',
    exists (select 1 from public.meeting_call_messages where id = message_id));
  perform pg_temp.act_as((select v from call_fx where k = 'outsider'));
  perform pg_temp.must_be('a nonmember cannot read chat',
    not exists (select 1 from public.meeting_call_messages where id = message_id));
  perform pg_temp.act_as_service();
  insert into call_fx values ('chat', message_id);
  perform public.sync_meeting_call_presence(m_project, second_room, array[worker]);
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_refuse('a member who left the room cannot send chat',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, stakeholder, 'After leaving'));
  perform pg_temp.must_be('a member who left the room still reads history',
    exists (select 1 from public.meeting_call_messages where id = message_id));
  perform pg_temp.act_as_service();
  perform public.sync_meeting_call_presence(m_project, second_room, array[worker, stakeholder]);
  perform public.mark_meeting_call_empty(m_project, second_room, true);
  perform pg_temp.must_be('an empty room starts a grace timer',
    (select empty_since is not null from public.meetings where id = m_project));
  perform public.mark_meeting_call_empty(m_project, second_room, false);
  perform pg_temp.must_be('a returning participant clears the empty timer',
    (select empty_since is null from public.meetings where id = m_project));
  perform public.set_meeting_call_lock(m_project, true);
  perform pg_temp.must_be('lock blocks a pre-issued token at arrival',
    not public.meeting_call_participant_allowed(m_project, stakeholder, true)
    and public.meeting_call_participant_allowed(m_project, stakeholder, false)
    and public.meeting_call_participant_allowed(m_project, worker, true));
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('a locked room blocks new nonhost joins',
    exists (select 1 from public.meeting_call_access(m_project) where not can_join));
  perform pg_temp.act_as(worker);
  perform pg_temp.must_be('the starter can return to a locked room',
    exists (select 1 from public.meeting_call_access(m_project) where can_join and can_host));
  perform pg_temp.act_as_service();
  perform public.set_meeting_call_lock(m_project, false);
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_refuse('a member cannot ban someone directly',
    format('select public.ban_meeting_call_participant(%L, %L, %L)', m_project, second_room, worker));
  perform pg_temp.act_as_service();
  perform public.ban_meeting_call_participant(m_project, second_room, stakeholder);
  perform pg_temp.must_be('a removed participant cannot return with an old token',
    not public.meeting_call_participant_allowed(m_project, stakeholder, true)
    and not public.meeting_call_participant_allowed(m_project, stakeholder, false));
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('a removed participant cannot request a fresh token',
    exists (select 1 from public.meeting_call_access(m_project) where not can_join));
  perform pg_temp.act_as_service();
  delete from public.meeting_call_bans where room_name = second_room and user_id = stakeholder;
  perform pg_temp.must_be('a live room is listed for reconciliation',
    exists (select 1 from public.meeting_calls_to_reconcile(50)
             where meeting_id = m_project and room_name = second_room));
  update public.meetings set started_at = now() - interval '8 hours 1 minute' where id = m_project;
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('an over-eight-hour room takes no new joins',
    exists (select 1 from public.meeting_call_access(m_project) where not can_join));

  perform pg_temp.act_as(a);
  m_group_after_leave := (public.create_meeting('group',
    (select v from call_fx where k = 'group_a'), 'Later group call', '', null, now(), 60)).id;
  perform public.cancel_meeting(m_group);
  perform pg_temp.must_refuse('a cancelled call cannot start',
    format('select public.begin_meeting_call(%L)', m_group));
  perform pg_temp.act_as_service();
  delete from public.group_members
   where group_id = (select v from call_fx where k = 'group_a') and student_id = a;
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('a group scheduler loses call access after leaving the group',
    not exists (select 1 from public.meeting_call_access(m_group_after_leave)));
  perform pg_temp.act_as_service();
  update public.meetings set starts_at = now() - interval '40 days' where id = m_space;
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('a deep link still finds a meeting older than 30 days',
    exists (select 1 from public.get_my_meeting_v2(m_space)));
  perform pg_temp.must_be('the ordinary recent list excludes that old meeting',
    not exists (select 1 from public.list_my_meetings_v2(now() - interval '30 days', now(), 50)
                 where id = m_space));
  perform pg_temp.act_as_service();
  update public.meetings set started_at = now() where id = m_project;
  perform pg_temp.must_be('a current project member is allowed to remain in the room',
    public.meeting_call_participant_allowed(m_project, worker, false));
  delete from public.general_members
   where project_id = (select v from call_fx where k = 'project') and user_id = worker;
  perform pg_temp.act_as(worker);
  perform pg_temp.must_be('a former member cannot read chat',
    not exists (select 1 from public.meeting_call_messages
                 where id = (select v from call_fx where k = 'chat')));
  perform pg_temp.must_be('a former member cannot read recording metadata',
    not exists (select 1 from public.meeting_call_recordings where id = v_recording_id));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing project membership revokes room access',
    not public.meeting_call_participant_allowed(m_project, worker, false));
  perform pg_temp.must_be('batch reconciliation removes only the former member',
    (select array_agg(identity order by identity)
       from public.meeting_call_disallowed_participants(
         m_project, array[worker::text, stakeholder::text], array[false, false]))
      = array[worker::text]);
  insert into public.meeting_call_events (event_id, room_name)
  values ('zz-test-event', second_room) on conflict do nothing;
  insert into public.meeting_call_events (event_id, room_name)
  values ('zz-test-event', second_room) on conflict do nothing;
  perform pg_temp.must_be('duplicate provider events are stored once',
    (select count(*) from public.meeting_call_events where event_id = 'zz-test-event') = 1);
  update public.profiles set status = 'pending' where id = stakeholder;
  perform pg_temp.act_as(stakeholder);
  perform pg_temp.must_be('a pending former member cannot read call detail',
    not exists (select 1 from public.get_my_meeting_v2(m_project)));
  perform pg_temp.must_be('a pending former member cannot read call access',
    not exists (select 1 from public.meeting_call_access(m_project)));
  perform pg_temp.act_as_service();
  perform public.finish_meeting_call(m_project, second_room);
  perform pg_temp.act_as(prof);
  perform pg_temp.must_be('current audience keeps chat history after the call',
    exists (select 1 from public.meeting_call_messages
             where id = (select v from call_fx where k = 'chat')));
  perform pg_temp.must_refuse('nobody can send after the call ends',
    format('insert into public.meeting_call_messages(meeting_id,sender_id,body) values (%L,%L,%L)',
      m_project, prof, 'Too late'));
  perform pg_temp.act_as_service();
  update public.general_spaces set archived_at = now() where id = (select v from call_fx where k = 'space');
  perform pg_temp.act_as(prof);
  perform pg_temp.must_refuse('an archived audience cannot start a call',
    format('select public.begin_meeting_call(%L)', m_space));
  perform pg_temp.act_as_service();
  delete from public.meetings where id = m_project;
  perform pg_temp.must_be('deleting a meeting deletes its chat',
    not exists (select 1 from public.meeting_call_messages
                 where id = (select v from call_fx where k = 'chat')));
  perform pg_temp.must_be('deleting a meeting keeps private bytes queued for expiry',
    exists (select 1 from public.meeting_call_recordings
             where id = v_recording_id and meeting_id is null));
end $$;

rollback;
