-- supabase/tests/work-milestones.test.sql
-- Milestones on a work project. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/work-milestones.test.sql
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

/** Runs a statement and asserts it is refused. */
create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Member', 'Outsider'];
  i int;
  a uuid; b uuid; d uuid;
  p uuid; v_inv uuid;
  p2 uuid; m1 uuid; m_other uuid; t_a uuid; t_b uuid; t_arch uuid; v_team uuid;
  n int; m_r uuid; m_own uuid; t_own uuid; v_old timestamptz;
  p3 uuid; m3 uuid; t3a uuid; t3b uuid; t3c uuid; v_team3 uuid;
  p4 uuid; m4 uuid; t4a uuid; t4b uuid; v_team4 uuid;
begin
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-wmile-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzwmile', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  -- General accounts are approved faculty: supabase/access.sql.
  update public.profiles set status = 'active'
   where id = any (v_ids) and role = 'faculty' and status = 'pending';
  a := v_ids[1]; b := v_ids[2]; d := v_ids[3];

  perform pg_temp.act_as(a);
  p := (public.create_general_project('Zz milestone project')).id;
  select id into v_inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(v_inv, true);

  perform pg_temp.act_as(a);
  p2 := (public.create_general_project('Zz other milestones')).id;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Beta', current_date + 10) returning id into m1;
  insert into public.general_milestones (project_id, name, due_on)
  values (p2, 'Elsewhere', current_date + 10) returning id into m_other;
  perform pg_temp.must_be('a manager can create a milestone',
    exists (select 1 from public.general_milestones where id = m1));
  perform pg_temp.must_refuse('a milestone needs a name',
    format($q$insert into public.general_milestones (project_id, name, due_on) values (%L, '  ', current_date)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('a member can read milestones',
    exists (select 1 from public.general_milestones where id = m1));
  perform pg_temp.must_refuse('a member cannot create a milestone',
    format($q$insert into public.general_milestones (project_id, name, due_on) values (%L, 'Mine', current_date)$q$, p));
  update public.general_milestones set reached_at = now() where id = m1;
  perform pg_temp.must_be('a member cannot mark a milestone reached',
    (select reached_at from public.general_milestones where id = m1) is null);

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('an outsider cannot read milestones',
    not exists (select 1 from public.general_milestones where id = m1));

  -- tagging
  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Member task') returning id into t_b;
  perform pg_temp.must_refuse('a member cannot tag a task',
    format('update public.general_tasks set milestone_id = %L where id = %L', m1, t_b));
  perform pg_temp.must_refuse('a member cannot add a task already tagged',
    format($q$insert into public.general_tasks (project_id, title, milestone_id) values (%L, 'x', %L)$q$, p, m1));

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title, milestone_id) values (p, 'Tagged', m1) returning id into t_a;
  update public.general_tasks set milestone_id = m1 where id = t_b;
  perform pg_temp.must_be('a manager can tag tasks',
    (select count(*) from public.general_tasks where milestone_id = m1) = 2);
  perform pg_temp.must_refuse('a task cannot take another project''s milestone',
    format('update public.general_tasks set milestone_id = %L where id = %L', m_other, t_a));
  update public.general_milestones set reached_at = now() where id = m1;
  perform pg_temp.must_be('a manager can mark a milestone reached',
    (select reached_at is not null from public.general_milestones where id = m1));
  perform pg_temp.must_be('the overview carries the milestone',
    (select milestone_id = m1 from public.general_task_overview where id = t_a));

  -- a member cannot undo a manager's planning
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a member cannot untag a task',
    format('update public.general_tasks set milestone_id = null where id = %L', t_b));
  delete from public.general_milestones where id = m1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a member cannot delete a milestone',
    n = 0 and exists (select 1 from public.general_milestones where id = m1));
  perform pg_temp.act_as(a);

  -- the server stamps reached_at and the bookkeeping columns
  insert into public.general_milestones (project_id, name, due_on, reached_at, created_by, created_at)
  values (p, 'Stamped', current_date + 5, '2000-01-01', b, '2000-01-01') returning id into m_r;
  perform pg_temp.must_be('a new milestone takes its creator and time from the server',
    (select created_by = a and abs(extract(epoch from now() - created_at)) < 60
            and abs(extract(epoch from now() - reached_at)) < 60
       from public.general_milestones where id = m_r));
  update public.general_milestones set reached_at = null where id = m_r;
  update public.general_milestones set reached_at = '2000-01-01' where id = m_r;
  perform pg_temp.must_be('reached_at is the server time, not the one the client sent',
    (select abs(extract(epoch from now() - reached_at)) < 60 from public.general_milestones where id = m_r));
  select reached_at into v_old from public.general_milestones where id = m_r;
  update public.general_milestones set reached_at = '2001-01-01', name = 'Stamped 2' where id = m_r;
  perform pg_temp.must_be('a milestone already reached keeps its reached_at',
    (select reached_at = v_old and name = 'Stamped 2' from public.general_milestones where id = m_r));
  update public.general_milestones set reached_at = null where id = m_r;
  perform pg_temp.must_be('reached_at can be cleared',
    (select reached_at is null from public.general_milestones where id = m_r));
  update public.general_milestones
     set created_by = b, created_at = '2000-01-01', project_id = p2 where id = m_r;
  perform pg_temp.must_be('an edit cannot change who made a milestone, when, or its project',
    (select created_by = a and created_at > '2001-01-01' and project_id = p
       from public.general_milestones where id = m_r));

  -- deleting releases tags, archived team tasks included
  insert into public.general_teams (project_id, name) values (p, 'Zz Crew') returning id into v_team;
  insert into public.general_tasks (project_id, team_id, title, milestone_id)
  values (p, v_team, 'Archived team task', m1) returning id into t_arch;
  perform public.archive_general_task(t_arch, true);
  delete from public.general_milestones where id = m1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a milestone can be deleted over archived team tasks', n = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('its tasks lose the tag, archived ones too',
    (select count(*) from public.general_tasks where id in (t_a, t_b, t_arch) and milestone_id is null) = 3);
  perform pg_temp.must_be('the archive flag is not left on',
    coalesce(current_setting('collabify.general_archive_op', true), '') <> 'on');

  -- a member archives their own tagged team task; the Owner then deletes the milestone
  perform pg_temp.act_as(a);
  insert into public.general_team_members (team_id, project_id, user_id) values (v_team, p, b);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Member archive', current_date + 4) returning id into m_own;
  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, team_id, title) values (p, v_team, 'Member team task')
  returning id into t_own;
  perform pg_temp.act_as(a);
  update public.general_tasks set milestone_id = m_own where id = t_own;
  perform pg_temp.act_as(b);
  perform public.archive_general_task(t_own, true);
  perform pg_temp.act_as(a);
  delete from public.general_milestones where id = m_own;
  get diagnostics n = row_count;
  perform pg_temp.must_be('the Owner can delete a milestone over a task a member archived', n = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('that archived task lost its tag and stayed archived',
    (select milestone_id is null and archived_at is not null from public.general_tasks where id = t_own));

  -- deleting a whole project the real way: archive it, then delete_general_project
  perform pg_temp.act_as(a);
  p3 := (public.create_general_project('Zz milestone delete')).id;
  insert into public.general_milestones (project_id, name, due_on)
  values (p3, 'Doomed', current_date + 3) returning id into m3;
  insert into public.general_teams (project_id, name) values (p3, 'Zz Crew 3') returning id into v_team3;
  insert into public.general_tasks (project_id, title, milestone_id) values (p3, 'Live tagged', m3)
  returning id into t3a;
  insert into public.general_tasks (project_id, team_id, title, milestone_id)
  values (p3, v_team3, 'Archived team task', m3) returning id into t3b;
  perform public.archive_general_task(t3b, true);
  insert into public.general_tasks (project_id, title, milestone_id) values (p3, 'Also tagged', m3)
  returning id into t3c;
  perform public.archive_general_project(p3, true);
  perform public.delete_general_project(p3);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the Owner can delete a project holding a milestone with tagged and archived tasks',
    not exists (select 1 from public.general_projects where id = p3)
    and not exists (select 1 from public.general_milestones where id = m3)
    and not exists (select 1 from public.general_tasks where id in (t3a, t3b, t3c)));

  -- and the same through Trash
  perform pg_temp.act_as(a);
  p4 := (public.create_general_project('Zz milestone trash')).id;
  insert into public.general_milestones (project_id, name, due_on)
  values (p4, 'Doomed too', current_date + 3) returning id into m4;
  insert into public.general_teams (project_id, name) values (p4, 'Zz Crew 4') returning id into v_team4;
  insert into public.general_tasks (project_id, title, milestone_id) values (p4, 'Live tagged', m4)
  returning id into t4a;
  insert into public.general_tasks (project_id, team_id, title, milestone_id)
  values (p4, v_team4, 'Archived team task', m4) returning id into t4b;
  perform public.archive_general_task(t4b, true);
  perform public.archive_general_project(p4, true);
  perform public.trash_archived_item('project', p4);
  perform public.delete_trashed_item('project', p4);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an archived project deleted from Trash takes its milestones and tagged tasks with it',
    not exists (select 1 from public.general_projects where id = p4)
    and not exists (select 1 from public.general_milestones where id = m4)
    and not exists (select 1 from public.general_tasks where id in (t4a, t4b)));
end $$;

rollback;
