-- supabase/tests/project-settings-general.test.sql
-- A work project's look, Workspace visibility and asking to join.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-settings-general.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_pm      uuid := gen_random_uuid();  -- project manager, Owner of the space
  v_coord   uuid := gen_random_uuid();  -- coordinator on P
  v_viewer  uuid := gen_random_uuid();  -- plain space member, not on P
  v_second  uuid := gen_random_uuid();  -- another plain space member
  v_third   uuid := gen_random_uuid();  -- a third, who joins by invitation
  v_outside uuid := gen_random_uuid();  -- member of another space only
  v_space   uuid;
  v_other   uuid;
  p         uuid;  -- the project under test
  p2        uuid;  -- a private project in the same space
  r1        uuid;
  r2        uuid;
  r3        uuid;
  v_inv     uuid;
  n         int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,      'zz-psg-pm@example.test'),
      (v_coord,   'zz-psg-coord@example.test'),
      (v_viewer,  'zz-psg-viewer@example.test'),
      (v_second,  'zz-psg-second@example.test'),
      (v_third,   'zz-psg-third@example.test'),
      (v_outside, 'zz-psg-outside@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,      'zz-psg-pm@example.test',      'Zz', 'Psgpm',      'member', 'active', false, true),
    (v_coord,   'zz-psg-coord@example.test',   'Zz', 'Psgcoord',   'member', 'active', false, false),
    (v_viewer,  'zz-psg-viewer@example.test',  'Zz', 'Psgviewer',  'member', 'active', false, false),
    (v_second,  'zz-psg-second@example.test',  'Zz', 'Psgsecond',  'member', 'active', false, false),
    (v_third,   'zz-psg-third@example.test',   'Zz', 'Psgthird',   'member', 'active', false, false),
    (v_outside, 'zz-psg-outside@example.test', 'Zz', 'Psgoutside', 'member', 'active', false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PSG space', '')).id;
  p := (public.create_general_project('Zz PSG project', '', null, null, null, null, v_space)).id;
  p2 := (public.create_general_project('Zz PSG private', '', null, null, null, null, v_space)).id;
  perform pg_temp.act_as(v_outside);
  v_other := (public.create_general_space('Zz PSG other space', '')).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_viewer, 'member'), (v_space, v_second, 'member'), (v_space, v_third, 'member');
  insert into public.general_members (project_id, user_id, role) values (p, v_coord, 'coordinator');
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (p, 'Zz PSG released task', v_pm, 'released');
  -- The project manager's new task starts in private planning.
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (p, 'Zz PSG planning task');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('fixture: one released and one planning task',
    (select count(*) filter (where routing_state = 'released') = 1
        and count(*) filter (where routing_state = 'planning') = 1
       from public.general_tasks where project_id = p));

  ------------------------------------------------------------ look and defaults
  perform pg_temp.must_be('new projects are private with the overview as default view',
    (select visibility = 'private' and default_view = 'overview'
        and color is null and icon is null
       from public.general_projects where id = p));

  ------------------------------------------------------------ private
  perform pg_temp.act_as(v_viewer);
  perform pg_temp.must_be('a private project stays hidden from space members',
    not coalesce(public.can_read_general_project(p), false)
    and not exists (select 1 from public.general_projects where id = p)
    and not exists (select 1 from public.general_tasks where project_id = p)
    and not exists (select 1 from public.general_members where project_id = p)
    and not exists (select 1 from public.general_project_overview where id = p));

  ------------------------------------------------------------ the project manager edits the look
  perform pg_temp.act_as(v_pm);
  update public.general_projects
     set color = 'teal', icon = 'monitor', default_view = 'plan', visibility = 'workspace'
   where id = p;
  perform pg_temp.must_be('the project manager can set color, icon, default view and visibility',
    (select color = 'teal' and icon = 'monitor' and default_view = 'plan' and visibility = 'workspace'
       from public.general_projects where id = p));
  perform pg_temp.must_refuse_with('an unknown color or icon is refused',
    format($q$update public.general_projects set color = 'pink' where id = %L$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...an unknown icon too',
    format($q$update public.general_projects set icon = 'rocket' where id = %L$q$, p),
    'check constraint');
  perform pg_temp.must_refuse_with('...and an unknown default view',
    format($q$update public.general_projects set default_view = 'files' where id = %L$q$, p),
    'check constraint');

  perform pg_temp.act_as(v_coord);
  update public.general_projects set visibility = 'private' where id = p;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a coordinator cannot change visibility (no row changes)',
    n = 0 and (select visibility = 'workspace' from public.general_projects where id = p));

  ------------------------------------------------------------ workspace
  perform pg_temp.act_as(v_viewer);
  perform pg_temp.must_be('a workspace project is readable by a space member',
    coalesce(public.can_read_general_project(p), false)
    and exists (select 1 from public.general_projects where id = p)
    and exists (select 1 from public.general_project_overview where id = p and my_level is null)
    and (select count(*) from public.general_members where project_id = p) = 2);
  perform pg_temp.must_be('...without the project''s join code',
    (select join_code is null from public.general_project_overview where id = p));
  perform pg_temp.must_refuse_with('a workspace viewer cannot write',
    format($q$insert into public.general_tasks (project_id, title, created_by)
              values (%L, 'Zz PSG viewer task', %L)$q$, p, v_viewer),
    'You are not on this project');
  update public.general_projects set name = 'Zz PSG renamed' where id = p;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...and cannot rename it (no row changes)', n = 0);
  update public.general_tasks set title = 'Zz PSG renamed task' where project_id = p;
  get diagnostics n = row_count;
  perform pg_temp.must_be('...or edit a task (no row changes)', n = 0);
  perform pg_temp.must_be('a workspace viewer sees no private planning tasks',
    (select count(*) from public.general_tasks where project_id = p) = 1
    and not exists (select 1 from public.general_tasks
                     where project_id = p and routing_state <> 'released'));
  perform pg_temp.must_be('...and the private project next to it stays hidden',
    not coalesce(public.can_read_general_project(p2), false));

  perform pg_temp.act_as(v_outside);
  perform pg_temp.must_be('a member of another space cannot read it',
    not coalesce(public.can_read_general_project(p), false)
    and not exists (select 1 from public.general_projects where id = p)
    and not exists (select 1 from public.general_tasks where project_id = p));
  perform pg_temp.must_refuse_with('...or ask to join it',
    format('select public.request_join_general_project(%L)', p),
    'does not take join requests');

  ------------------------------------------------------------ asking to join
  perform pg_temp.act_as(v_viewer);
  r1 := public.request_join_general_project(p);
  perform pg_temp.must_be('a space member can ask to join a workspace project',
    (select status = 'open' and user_id = v_viewer and role is null
       from public.general_join_requests where id = r1));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the project manager and the coordinator are told',
    (select count(*) from public.notifications
      where general_project_id = p and type = 'join_requested'
        and title = 'Zz Psgviewer asked to join Zz PSG project'
        and preview = 'Answer it in Settings → Members & permissions.'
        and user_id in (v_pm, v_coord)) = 2
    and not exists (select 1 from public.notifications
                     where general_project_id = p and user_id = v_viewer));

  perform pg_temp.act_as(v_viewer);
  perform pg_temp.must_refuse_with('asking to join a private project is refused',
    format('select public.request_join_general_project(%L)', p2),
    'does not take join requests');
  perform pg_temp.must_be('one open request per person',
    public.request_join_general_project(p) = r1
    and (select count(*) from public.general_join_requests
          where project_id = p and user_id = v_viewer and status = 'open') = 1);
  perform pg_temp.must_refuse_with('...and the requester cannot write a request directly',
    format($q$insert into public.general_join_requests (project_id, user_id) values (%L, %L)$q$,
           p, v_viewer),
    'permission denied');
  perform pg_temp.must_refuse_with('...or approve their own',
    format($q$update public.general_join_requests set status = 'approved', role = 'member' where id = %L$q$,
           r1),
    'permission denied');
  perform pg_temp.must_refuse_with('...or answer it through the function',
    format('select public.answer_join_request(%L, true)', r1),
    'Only the project manager or a coordinator');

  ------------------------------------------------------------ answering
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_be('the coordinator reads the request',
    exists (select 1 from public.general_join_requests where id = r1));
  perform pg_temp.must_refuse_with('a coordinator cannot approve as coordinator',
    format($q$select public.answer_join_request(%L, true, 'coordinator')$q$, r1),
    'Only the project manager can add a coordinator');
  perform pg_temp.must_refuse_with('...nor as project manager',
    format($q$select public.answer_join_request(%L, true, 'pm')$q$, r1),
    'hand over');
  perform public.answer_join_request(r1, true, 'member');
  perform pg_temp.must_be('a coordinator can approve as member',
    (select status = 'approved' from public.general_join_requests where id = r1));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an approved request makes them a member and closes it',
    (select role = 'member' and level = 'member' from public.general_members
      where project_id = p and user_id = v_viewer)
    and (select status = 'approved' and role = 'member' and answered_by = v_coord
                and answered_at is not null
           from public.general_join_requests where id = r1)
    and not exists (select 1 from public.general_join_requests
                     where project_id = p and user_id = v_viewer and status = 'open'));
  perform pg_temp.must_be('...and they are told they joined',
    exists (select 1 from public.notifications
             where user_id = v_viewer and general_project_id = p and type = 'join_answered'
               and title = 'You joined Zz PSG project'));
  perform pg_temp.act_as(v_viewer);
  perform pg_temp.must_refuse_with('...so they cannot ask again',
    format('select public.request_join_general_project(%L)', p),
    'already on this project');
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('...and the answered request cannot be answered again',
    format('select public.answer_join_request(%L, false)', r1),
    'already answered');

  perform pg_temp.act_as(v_second);
  r2 := public.request_join_general_project(p);
  perform pg_temp.act_as(v_pm);
  perform public.answer_join_request(r2, false);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a declined request notifies the requester',
    (select status = 'declined' and role is null and answered_by = v_pm
       from public.general_join_requests where id = r2)
    and not exists (select 1 from public.general_members where project_id = p and user_id = v_second)
    and exists (select 1 from public.notifications
                 where user_id = v_second and general_project_id = p and type = 'join_answered'
                   and title = 'Your request to join Zz PSG project was declined'));

  perform pg_temp.act_as(v_second);
  r2 := public.request_join_general_project(p);
  perform pg_temp.act_as(v_coord);
  perform pg_temp.must_refuse_with('only the requester can withdraw',
    format('select public.withdraw_join_request(%L)', r2),
    'not yours to withdraw');
  perform pg_temp.act_as(v_second);
  perform public.withdraw_join_request(r2);
  perform pg_temp.must_be('the requester can withdraw',
    (select status = 'withdrawn' from public.general_join_requests where id = r2));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('...and a withdrawn request cannot be approved',
    format('select public.answer_join_request(%L, true)', r2),
    'already answered');

  perform pg_temp.act_as(v_second);
  r2 := public.request_join_general_project(p);
  perform pg_temp.act_as(v_viewer);  -- now a member of P, but not a lead
  perform pg_temp.must_be('others cannot read someone else''s request',
    not exists (select 1 from public.general_join_requests where id = r2)
    and exists (select 1 from public.general_join_requests where id = r1));
  perform pg_temp.act_as(v_third);
  perform pg_temp.must_be('...nor can another space member',
    not exists (select 1 from public.general_join_requests where project_id = p));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('...while the project manager reads them all',
    (select count(*) from public.general_join_requests where project_id = p) = 4);
  perform public.answer_join_request(r2, true, 'coordinator');
  perform pg_temp.must_be('the project manager can approve as coordinator',
    (select role = 'coordinator' from public.general_members where project_id = p and user_id = v_second));

  ------------------------------------------------------------ joining another way
  perform pg_temp.act_as(v_third);
  r3 := public.request_join_general_project(p);
  perform pg_temp.act_as(v_pm);
  select id into v_inv from public.invite_to_general_project(p, v_third, 'qa');
  perform pg_temp.act_as(v_third);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.must_be('joining by invitation closes the open request',
    (select status = 'approved' and role = 'qa' from public.general_join_requests where id = r3));

  ------------------------------------------------------------ archived
  perform pg_temp.act_as(v_pm);
  update public.general_projects set visibility = 'workspace' where id = p2;
  perform public.archive_general_project(p2, true);
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values (v_space, v_outside, 'member');
  perform pg_temp.act_as(v_outside);
  perform pg_temp.must_refuse_with('an archived project takes no requests',
    format('select public.request_join_general_project(%L)', p2),
    'archived');
end;
$$;

rollback;
