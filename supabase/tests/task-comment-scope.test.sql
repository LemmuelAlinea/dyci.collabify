-- supabase/tests/task-comment-scope.test.sql
-- Who may comment on a work project's task. Rolls back; nothing survives.
--
-- The file under test must already be applied, or spliced in after the opening begin:
--   node scripts/db.mjs supabase/tests/task-comment-scope.test.sql
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

/** The person comments on the task, and the comment must go through. */
create or replace function pg_temp.must_comment(p_label text, p_user uuid, p_task uuid, p_project uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (p_task, p_project, p_user, 'Zz check');
  raise notice 'PASS  %', p_label;
exception when others then
  raise exception 'FAIL  % — refused: %', p_label, sqlerrm;
end;
$$;

/** The person comments on the task, and row security must refuse it. */
create or replace function pg_temp.must_not_comment(p_label text, p_user uuid, p_task uuid, p_project uuid)
returns void language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  begin
    insert into public.general_task_comments (task_id, project_id, author_id, body)
    values (p_task, p_project, p_user, 'Zz check');
  exception when insufficient_privilege then
    raise notice 'PASS  %', p_label;
    return;
  end;
  raise exception 'FAIL  % — the comment went through and should not have', p_label;
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
  v_pm    uuid := gen_random_uuid();
  v_lead  uuid := gen_random_uuid();  -- member, leads the team
  v_mate  uuid := gen_random_uuid();  -- member on the team
  v_other uuid := gen_random_uuid();  -- member, not on the team
  v_grant uuid := gen_random_uuid();  -- member with a manage_tasks grant
  v_coord uuid := gen_random_uuid();
  v_qa    uuid := gen_random_uuid();
  v_stake uuid := gen_random_uuid();
  v_space uuid;
  p       uuid;
  team    uuid;
  t_mate  uuid;  -- held by v_mate
  t_lead  uuid;  -- held by v_lead
  t_other uuid;  -- held by v_other
  t_free  uuid;  -- held by nobody, filed under the team
  c_old   uuid;
  c_author uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.em, '', now(), now()
    from (values
      (v_pm,    'zz-tcs-pm@example.test'),    (v_lead,  'zz-tcs-lead@example.test'),
      (v_mate,  'zz-tcs-mate@example.test'),  (v_other, 'zz-tcs-other@example.test'),
      (v_grant, 'zz-tcs-grant@example.test'), (v_coord, 'zz-tcs-coord@example.test'),
      (v_qa,    'zz-tcs-qa@example.test'),    (v_stake, 'zz-tcs-stake@example.test')
    ) as v(id, em);

  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  select u.id, u.email, 'Zz', 'Tcs', 'member', 'active', false, u.id = v_pm
    from auth.users u where u.email like 'zz-tcs-%@example.test'
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz TCS space', '')).id;
  p := (public.create_general_project('Zz TCS project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_lead, 'member'), (v_space, v_mate, 'member'), (v_space, v_other, 'member'),
    (v_space, v_grant, 'member'), (v_space, v_coord, 'member'), (v_space, v_qa, 'member'),
    (v_space, v_stake, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_lead, 'member'), (p, v_mate, 'member'), (p, v_other, 'member'), (p, v_grant, 'member'),
    (p, v_coord, 'coordinator'), (p, v_qa, 'qa'), (p, v_stake, 'stakeholder');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (p, v_grant, 'manage_tasks', v_pm);
  insert into public.general_teams (project_id, name) values (p, 'Zz TCS team') returning id into team;
  insert into public.general_team_members (project_id, team_id, user_id) values
    (p, team, v_lead), (p, team, v_mate);
  update public.general_teams set leader_id = v_lead where id = team;

  insert into public.general_tasks (project_id, title, routing_state) values (p, 'Zz mate', 'released') returning id into t_mate;
  insert into public.general_tasks (project_id, title, routing_state) values (p, 'Zz lead', 'released') returning id into t_lead;
  insert into public.general_tasks (project_id, title, routing_state) values (p, 'Zz other', 'released') returning id into t_other;
  insert into public.general_tasks (project_id, title, routing_state, team_id) values (p, 'Zz free', 'released', team) returning id into t_free;
  insert into public.general_task_assignees (project_id, task_id, user_id) values
    (p, t_mate, v_mate), (p, t_lead, v_lead), (p, t_other, v_other);

  ------------------------------------------------------------ inside the scope
  perform pg_temp.must_comment('a member comments on their own task', v_mate, t_mate, p);
  perform pg_temp.must_comment('a lead comments on their own task', v_lead, t_lead, p);
  perform pg_temp.must_comment('a lead comments on a teammate''s task', v_lead, t_mate, p);

  ------------------------------------------------------------ outside the scope
  perform pg_temp.must_not_comment('a member cannot comment on a teammate''s task', v_mate, t_lead, p);
  perform pg_temp.must_not_comment('a member cannot comment on another team''s task', v_mate, t_other, p);
  perform pg_temp.must_not_comment('a member cannot comment on a task nobody holds', v_other, t_free, p);
  perform pg_temp.must_not_comment('a lead cannot comment on a task outside their team', v_lead, t_other, p);
  perform pg_temp.must_not_comment('a lead cannot comment on an unheld task of their team', v_lead, t_free, p);
  perform pg_temp.must_not_comment('a stakeholder cannot comment', v_stake, t_mate, p);

  perform pg_temp.act_as(v_mate);
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (t_mate, p, v_other, 'Zz forged') returning author_id into c_author;
  perform pg_temp.must_be('a comment always carries its real author', c_author = v_mate);

  ------------------------------------------------------------ the roles that keep it
  perform pg_temp.must_comment('the project manager comments on any task', v_pm, t_other, p);
  perform pg_temp.must_comment('a coordinator comments on any task', v_coord, t_other, p);
  perform pg_temp.must_comment('QA comments on any task', v_qa, t_other, p);
  perform pg_temp.must_comment('a member with manage_tasks comments on any task', v_grant, t_other, p);

  ------------------------------------------------------------ read-only still reads
  perform pg_temp.act_as(v_other);
  perform pg_temp.must_be('a member still reads a task outside their scope',
    exists(select 1 from public.general_tasks where id = t_mate));
  perform pg_temp.must_be('a member still reads its comments',
    exists(select 1 from public.general_task_comments where task_id = t_mate));

  ------------------------------------------------------------ leaving a task
  perform pg_temp.act_as(v_mate);
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (t_mate, p, v_mate, 'Zz written while holding') returning id into c_old;
  perform pg_temp.act_as_service();
  delete from public.general_task_assignees where task_id = t_mate and user_id = v_mate;
  perform pg_temp.must_not_comment('someone taken off a task can no longer comment on it', v_mate, t_mate, p);
  perform pg_temp.act_as(v_mate);
  update public.general_task_comments set body = 'Zz fixed' where id = c_old;
  perform pg_temp.must_be('they can still fix what they wrote',
    exists(select 1 from public.general_task_comments where id = c_old and body = 'Zz fixed'));
  delete from public.general_task_comments where id = c_old;
  perform pg_temp.must_be('they can still remove what they wrote',
    not exists(select 1 from public.general_task_comments where id = c_old));

  perform pg_temp.act_as_service();
end;
$$;

rollback;
