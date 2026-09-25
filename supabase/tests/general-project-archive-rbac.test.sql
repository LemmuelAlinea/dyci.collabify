-- Who sees an archived General project, and deleting one for good. Rolls back.
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
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id   uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  member_id  uuid := gen_random_uuid();
  neighbour  uuid := gen_random_uuid();
  proj       public.general_projects%rowtype;
  live       public.general_projects%rowtype;
  repo       public.general_repos%rowtype;
  task_id    uuid;
  names      text[];
  n          int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Arch', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'arch-owner@test.local', 'Owner'),
                 (manager_id, 'arch-manager@test.local', 'Manager'),
                 (member_id, 'arch-member@test.local', 'Member'),
                 (neighbour, 'arch-neighbour@test.local', 'Neighbour')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Archived one', '');
  live := public.create_general_project('Still live', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, manager_id, 'manager'), (proj.id, member_id, 'member');
  -- Somebody in the same space who is on neither project.
  insert into public.general_space_members (space_id, user_id, level)
  values (proj.space_id, neighbour, 'member')
  on conflict do nothing;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'A task', owner_id) returning id into task_id;
  insert into public.general_teams (project_id, name) values (proj.id, 'Writers');

  perform pg_temp.act_as(member_id);
  perform public.save_general_draft_file(repo.id, 'b.md', 'added', 'text', 'B');

  -------------------------------------------------- before archiving
  perform pg_temp.act_as(neighbour);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('a live project is readable across its space', n = 1);

  -------------------------------------------------- archived
  perform pg_temp.act_as(owner_id);
  proj := public.archive_general_project(proj.id, true);
  perform pg_temp.ok('archiving records who did it', proj.archived_by = owner_id);

  perform pg_temp.act_as(neighbour);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('somebody else in the space no longer sees it', n = 0);
  select count(*) into n from public.general_tasks where project_id = proj.id;
  perform pg_temp.ok('nor anything inside it', n = 0);
  select archived_count into n from public.general_space_overview where id = proj.space_id;
  perform pg_temp.ok('and it is not in their archive count', n = 0);
  select count(*) into n from public.general_project_overview where id = live.id;
  perform pg_temp.ok('a live project in the same space is unaffected', n = 1);

  perform pg_temp.act_as(member_id);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('a plain member of the project no longer sees it', n = 0);

  perform pg_temp.act_as(manager_id);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('a Manager of the project still sees it', n = 1);

  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('whoever archived it still sees it', n = 1);
  select archived_count into n from public.general_space_overview where id = proj.space_id;
  perform pg_temp.ok('and it counts in their archive', n = 1);

  begin
    update public.general_projects set archived_by = manager_id where id = proj.id;
    perform pg_temp.ok('who archived it cannot be rewritten', false);
  exception when insufficient_privilege or check_violation then
    perform pg_temp.ok('who archived it cannot be rewritten', true);
  end;

  -------------------------------------------------- restoring
  proj := public.archive_general_project(proj.id, false);
  perform pg_temp.ok('restoring clears who archived it', proj.archived_by is null);
  perform pg_temp.act_as(neighbour);
  select count(*) into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('a restored project is back for the whole space', n = 1);

  -------------------------------------------------- deleting
  perform pg_temp.act_as(owner_id);
  begin
    perform public.delete_general_project(proj.id);
    perform pg_temp.ok('a live project cannot be deleted', false);
  exception when check_violation then
    perform pg_temp.ok('a live project cannot be deleted', true);
  end;

  proj := public.archive_general_project(proj.id, true);

  perform pg_temp.act_as(manager_id);
  begin
    perform public.delete_general_project(proj.id);
    perform pg_temp.ok('a Manager cannot delete a project', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Manager cannot delete a project', true);
  end;

  perform pg_temp.act_as(owner_id);
  names := public.delete_general_project(proj.id);
  perform pg_temp.ok('an Owner deletes an archived project', names is not null);

  perform pg_temp.act_as_service();
  select count(*) into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('the project is gone', n = 0);
  select count(*) into n from public.general_tasks where id = task_id;
  perform pg_temp.ok('its tasks went with it', n = 0);
  select count(*) into n from public.general_commits where repo_id = repo.id;
  perform pg_temp.ok('its history went with it', n = 0);
  select count(*) into n from public.general_draft_files where project_id = proj.id;
  perform pg_temp.ok('its drafts went with it', n = 0);
  select count(*) into n from public.general_projects where id = live.id;
  perform pg_temp.ok('the other project is untouched', n = 1);

  -- Commits stay frozen for everything else.
  perform pg_temp.act_as(owner_id);
  repo := public.create_general_repo(live.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A')));
  perform pg_temp.act_as_service();
  begin
    delete from public.general_commits where repo_id = repo.id;
    perform pg_temp.ok('a commit still cannot be removed on its own', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a commit still cannot be removed on its own', true);
  end;
end $$;

rollback;
