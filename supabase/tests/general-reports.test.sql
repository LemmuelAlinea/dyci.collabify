-- General workplace reports: who sees what, archive rules, history, templates. Rolls back.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
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
  owner_id  uuid := gen_random_uuid();
  pmgr_id   uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  smgr_id   uuid := gen_random_uuid();
  stranger  uuid := gen_random_uuid();
  leaver    uuid := gen_random_uuid();
  proj      public.general_projects%rowtype;
  proj2     public.general_projects%rowtype;
  gone      public.general_projects%rowtype;
  repo      public.general_repos%rowtype;
  t_mine    uuid;
  t_owner   uuid;
  t_arch    uuid;
  tpl       uuid;
  shared_tpl uuid;
  v_from    timestamptz := now() - interval '7 days';
  v_to      timestamptz := now() + interval '1 day';
  n         int;
  txt       text;
  i         int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Rep', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'rep-owner@test.local', 'Owner'),
                 (pmgr_id, 'rep-pmgr@test.local', 'Pmgr'),
                 (member_id, 'rep-member@test.local', 'Member'),
                 (viewer_id, 'rep-viewer@test.local', 'Viewer'),
                 (smgr_id, 'rep-smgr@test.local', 'Smgr'),
                 (stranger, 'rep-stranger@test.local', 'Stranger'),
                 (leaver, 'rep-leaver@test.local', 'Leaver')) as v(id, em, ln);
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';

  perform pg_temp.act_as(owner_id);
  proj  := public.create_general_project('Report project', '');
  proj2 := public.create_general_project('Second project', '');
  repo  := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First files', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A'),
    jsonb_build_object('path', 'docs/.keep', 'action', 'added', 'kind', 'text', 'content', '')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, pmgr_id, 'manager'), (proj.id, member_id, 'member'), (proj.id, leaver, 'member');
  insert into public.general_space_members (space_id, user_id, level)
  values (proj.space_id, viewer_id, 'member'), (proj.space_id, smgr_id, 'manager'),
         (proj.space_id, member_id, 'member'), (proj.space_id, pmgr_id, 'member')
  on conflict do nothing;

  insert into public.general_tasks (project_id, title, created_by, status, completed_at, due_at)
  values (proj.id, 'Member task', member_id, 'done', now() - interval '1 day', now() - interval '2 days')
  returning id into t_mine;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Owner task', owner_id) returning id into t_owner;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Archived task', owner_id) returning id into t_arch;
  insert into public.general_task_assignees (task_id, project_id, user_id)
  values (t_mine, proj.id, member_id), (t_owner, proj.id, owner_id);
  insert into public.general_task_logs (task_id, project_id, user_id, minutes, note, logged_on)
  values (t_mine, proj.id, member_id, 90, 'Drafted it', current_date),
         (t_owner, proj.id, owner_id, 30, 'Owner note', current_date);
  insert into public.general_task_comments (task_id, project_id, author_id, body, created_at)
  values (t_owner, proj.id, owner_id, 'secret body text', now() - interval '1 hour'),
         (t_owner, proj.id, owner_id, 'at the start', v_from),
         (t_owner, proj.id, owner_id, 'at the end', v_to);

  perform pg_temp.act_as(member_id);
  perform public.save_general_draft_file(repo.id, 'private-draft.md', 'added', 'text', 'draft');

  perform pg_temp.act_as(owner_id);
  perform public.archive_general_task(t_arch, true);

  -------------------------------------------------- who is a lead
  perform pg_temp.ok('a project Owner is a lead', public.general_report_is_lead(proj.id));
  perform pg_temp.act_as(smgr_id);
  perform pg_temp.ok('a space Manager is a lead in every project of the space',
                     public.general_report_is_lead(proj.id) and public.general_report_is_lead(proj2.id));
  perform pg_temp.act_as(member_id);
  perform pg_temp.ok('a project Member is not a lead', not public.general_report_is_lead(proj.id));

  -------------------------------------------------- lead sees everybody
  perform pg_temp.act_as(owner_id);
  select count(distinct user_id) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('a lead sees every person on the project', n >= 4);
  select count(*) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to)
   where user_id = member_id and name is not null and minutes_logged = 90;
  perform pg_temp.ok('a lead sees a member''s name and hours', n = 1);
  select count(distinct user_id) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to, array[member_id]);
  perform pg_temp.ok('a lead can narrow the report to one person', n = 1);

  perform pg_temp.act_as(smgr_id);
  select count(*) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to)
   where user_id = member_id and name is not null;
  perform pg_temp.ok('a space Manager sees names in a project they are not on', n = 1);

  -------------------------------------------------- member sees only themselves
  perform pg_temp.act_as(member_id);
  select count(*) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to, array[owner_id])
   where user_id <> member_id;
  perform pg_temp.ok('a member asking for someone else gets nobody else', n = 0);
  select count(*) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to)
   where user_id <> member_id;
  perform pg_temp.ok('a member''s people table holds only them', n = 0);
  select count(*) into n
    from public.general_report_activity(proj.space_id, array[proj.id], v_from, v_to)
   where actor_id is distinct from member_id and actor_name is not null and actor_name not like '%Member%';
  perform pg_temp.ok('a member''s activity names nobody else', n = 0);
  select tasks_total into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('a member still gets project-wide task totals', n = 2);
  select minutes_in_range into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('but only their own hours', n = 90);
  select count(*) into n
    from public.general_report_tasks(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('a member''s task table holds only their tasks', n = 1);

  -------------------------------------------------- space-only viewer
  perform pg_temp.act_as(viewer_id);
  select tasks_total into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('a space-only viewer gets totals', n = 2);
  select count(*) into n
    from public.general_report_people(proj.space_id, array[proj.id], v_from, v_to)
   where name is not null;
  perform pg_temp.ok('and no names', n = 0);
  select count(*) into n
    from public.general_report_time_logs(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('and none of anybody''s time logs', n = 0);

  -------------------------------------------------- stranger
  perform pg_temp.act_as(stranger);
  select count(*) into n from public.general_report_scope(proj.space_id);
  perform pg_temp.ok('a stranger gets no projects', n = 0);
  select count(*) into n
    from public.general_report_summary(proj.space_id, null, v_from, v_to);
  perform pg_temp.ok('and no summary', n = 0);

  -------------------------------------------------- archived tasks
  perform pg_temp.act_as(owner_id);
  select tasks_total into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to);
  perform pg_temp.ok('an archived task is left out by default', n = 2);
  select tasks_total into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to, null, null, true);
  perform pg_temp.ok('and included when asked, for whoever may see it', n = 3);
  perform pg_temp.act_as(member_id);
  select tasks_total into n
    from public.general_report_summary(proj.space_id, array[proj.id], v_from, v_to, null, null, true);
  perform pg_temp.ok('a member who may not see it does not get it even when asked', n = 2);

  -------------------------------------------------- archived projects
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj2.id, true);
  select count(*) into n
    from public.general_report_summary(proj.space_id, null, v_from, v_to, null, null, true)
   where project_id = proj2.id;
  perform pg_temp.ok('an archived project is reported to its archiver when asked', n = 1);
  select count(*) into n
    from public.general_report_summary(proj.space_id, null, v_from, v_to)
   where project_id = proj2.id;
  perform pg_temp.ok('and left out by default', n = 0);
  perform pg_temp.act_as(viewer_id);
  select count(*) into n
    from public.general_report_summary(proj.space_id, null, v_from, v_to, null, null, true)
   where project_id = proj2.id;
  perform pg_temp.ok('an archived project is not reported to the rest of the space', n = 0);

  -------------------------------------------------- never drafts, never bodies
  perform pg_temp.act_as(owner_id);
  select count(*) into n
    from public.general_report_activity(proj.space_id, null, v_from, v_to)
   where detail::text like '%secret body%' or detail::text like '%private-draft%'
      or task_title like '%private-draft%';
  perform pg_temp.ok('comment bodies and drafts never appear', n = 0);
  select count(*) into n
    from public.general_report_activity(proj.space_id, null, v_from, v_to, null, null, false, 'UTC', array['comment'])
   where (detail->>'length')::int = char_length('secret body text');
  perform pg_temp.ok('a comment is reported by its length', n = 1);

  -------------------------------------------------- date boundaries
  select count(*) into n
    from public.general_report_activity(proj.space_id, null, v_from, v_to, null, null, false, 'UTC', array['comment']);
  perform pg_temp.ok('from is inclusive and to is exclusive', n = 2);

  select count(*) into n
    from public.general_report_progress_series(proj.space_id, array[proj.id],
         '2026-09-01 00:00+08', '2026-09-04 00:00+08', null, null, false, 'Asia/Manila');
  perform pg_temp.ok('a three-day range in Manila has three days', n = 3);
  select count(*) into n
    from public.general_report_progress_series(proj.space_id, array[proj.id],
         '2026-03-07 00:00-05', '2026-03-10 00:00-04', null, null, false, 'America/New_York');
  perform pg_temp.ok('a range across a clock change still counts its days', n = 3);
  select done_count into n
    from public.general_report_progress_series(proj.space_id, array[proj.id], v_from, v_to)
   order by day desc limit 1;
  perform pg_temp.ok('the last day counts the finished task', n = 1);

  -------------------------------------------------- history triggers
  select count(*) into n from public.general_project_events
   where task_id = t_arch and kind = 'task_archived' and actor_id = owner_id;
  perform pg_temp.ok('archiving a task is recorded', n = 1);

  update public.general_projects set status = 'on_hold' where id = proj.id;
  select detail->>'to' into txt from public.general_project_events
   where project_id = proj.id and kind = 'project_status';
  perform pg_temp.ok('a project status change is recorded with where it went', txt = 'on_hold');

  select count(*) into n from public.general_project_events
   where project_id = proj2.id and kind = 'project_archived';
  perform pg_temp.ok('archiving a project is recorded', n = 1);

  select count(*) into n from public.general_project_events
   where project_id = proj.id and kind = 'member_joined' and subject_id = member_id;
  perform pg_temp.ok('a member joining is recorded', n = 1);

  perform public.set_general_member_level(proj.id, member_id, 'manager');
  select detail->>'to' into txt from public.general_project_events
   where project_id = proj.id and kind = 'member_level' and subject_id = member_id;
  perform pg_temp.ok('a level change is recorded', txt = 'manager');
  perform public.set_general_member_level(proj.id, member_id, 'member');

  perform public.remove_general_member(proj.id, pmgr_id);
  select count(*) into n from public.general_project_events
   where project_id = proj.id and kind = 'member_removed' and subject_id = pmgr_id;
  perform pg_temp.ok('removing a member is recorded as removed', n = 1);

  perform pg_temp.act_as(leaver);
  perform public.leave_general_project(proj.id);
  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_project_events
   where project_id = proj.id and kind = 'member_left' and subject_id = leaver;
  perform pg_temp.ok('leaving is recorded as left', n = 1);

  perform pg_temp.act_as(member_id);
  select count(*) into n from public.general_project_events
   where project_id = proj.id and kind = 'member_removed';
  perform pg_temp.ok('a member does not read other people''s membership history', n = 0);

  -- Deleting a project records nothing on its way out and takes its history with it.
  perform pg_temp.act_as(owner_id);
  gone := public.create_general_project('Doomed', '');
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level) values (gone.id, member_id, 'member');
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(gone.id, true);
  perform public.delete_general_project(gone.id);
  perform pg_temp.act_as_service();
  select count(*) into n from public.general_project_events where project_id = gone.id;
  perform pg_temp.ok('a deleted project leaves no history behind', n = 0);

  perform pg_temp.ok('history has a start date', public.general_report_history_since() <= now());

  -------------------------------------------------- templates
  perform pg_temp.act_as(member_id);
  insert into public.general_report_templates (space_id, owner_id, name, config)
  values (proj.space_id, member_id, 'Mine', '{"version":1}') returning id into tpl;
  insert into public.general_report_templates (space_id, owner_id, name, config, shared)
  values (proj.space_id, member_id, 'For everyone', '{"version":1}', true) returning id into shared_tpl;

  perform pg_temp.act_as(viewer_id);
  select count(*) into n from public.general_report_templates where id = tpl;
  perform pg_temp.ok('a private template is invisible to others', n = 0);
  select count(*) into n from public.general_report_templates where id = shared_tpl;
  perform pg_temp.ok('a shared template is visible to the space', n = 1);
  update public.general_report_templates set name = 'Taken' where id = shared_tpl;
  perform pg_temp.act_as(member_id);
  select name into txt from public.general_report_templates where id = shared_tpl;
  perform pg_temp.ok('somebody else cannot rename it', txt = 'For everyone');

  perform pg_temp.act_as(owner_id);
  delete from public.general_report_templates where id = shared_tpl;
  perform pg_temp.act_as_service();
  select count(*) into n from public.general_report_templates where id = shared_tpl;
  perform pg_temp.ok('the space Owner can delete it', n = 0);

  perform pg_temp.act_as(member_id);
  for i in 2..50 loop
    insert into public.general_report_templates (space_id, owner_id, name, config)
    values (proj.space_id, member_id, 'Report ' || i, '{"version":1}');
  end loop;
  begin
    insert into public.general_report_templates (space_id, owner_id, name, config)
    values (proj.space_id, member_id, 'One too many', '{"version":1}');
    perform pg_temp.ok('a 51st template in a space is refused', false);
  exception when check_violation then
    perform pg_temp.ok('a 51st template in a space is refused', true);
  end;

  begin
    insert into public.general_report_templates (space_id, owner_id, name, config)
    values (proj.space_id, owner_id, 'Forged', '{"version":1}');
    perform pg_temp.ok('nobody saves a template as someone else', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('nobody saves a template as someone else', true);
  end;

  -------------------------------------------------- closed to anon
  perform pg_temp.act_as_service();
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname like 'general_report%'
     and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.ok('every report function is closed to anon', n = 0);
end $$;

rollback;
