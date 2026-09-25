-- Archive visibility: your own archive, plus Owners and Managers see all. Rolls back.
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
  owner_uid  uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  alice      uuid := gen_random_uuid();
  bob        uuid := gen_random_uuid();
  proj       public.general_projects%rowtype;
  repo       public.general_repos%rowtype;
  t_alice    uuid;
  t_bob      uuid;
  n          int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Arc', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_uid, 'arc-owner@test.local', 'Owner'),
                 (manager_id, 'arc-manager@test.local', 'Manager'),
                 (alice, 'arc-alice@test.local', 'Alice'),
                 (bob, 'arc-bob@test.local', 'Bob')) as v(id, em, ln);

  perform pg_temp.act_as(owner_uid);
  proj := public.create_general_project('Archive project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A'),
    jsonb_build_object('path', 'b.md', 'action', 'added', 'kind', 'text', 'content', 'B')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, manager_id, 'manager'), (proj.id, alice, 'member'), (proj.id, bob, 'member');
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Alice task', alice) returning id into t_alice;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Bob task', bob) returning id into t_bob;

  perform pg_temp.act_as(alice);
  perform public.archive_general_task(t_alice, true);
  perform public.save_general_draft_file(repo.id, 'notes/alice.md', 'added', 'text', 'x');
  perform public.archive_general_draft_path(repo.id, 'notes', true);

  perform pg_temp.act_as(bob);
  perform public.archive_general_task(t_bob, true);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(alice);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('a member sees only the task they archived', n = 1);
  select count(*) into n from public.general_task_overview where id = t_bob;
  perform pg_temp.ok('a member cannot read another member''s archived task by id', n = 0);

  perform pg_temp.act_as(owner_uid);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('an Owner sees every archived task', n = 2);

  perform pg_temp.act_as(manager_id);
  select count(*) into n from public.general_task_overview
   where project_id = proj.id and archived_at is not null;
  perform pg_temp.ok('a Manager sees every archived task', n = 2);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a Manager sees a member''s archived draft files', n = 1);
  perform pg_temp.ok('...knowing whose draft they came from',
    (select owner_id from public.list_archived_general_draft_files(repo.id) limit 1) = alice);

  perform pg_temp.act_as(bob);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a member does not see another member''s archived draft files', n = 0);

  ------------------------------------------------------------------ removed paths
  perform pg_temp.act_as(owner_uid);
  perform public.commit_general_files(repo.id, 'Drop b', 1, jsonb_build_array(
    jsonb_build_object('path', 'b.md', 'action', 'removed', 'kind', 'text', 'content', '')));
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('whoever removed a path sees it', n = 1);
  perform pg_temp.act_as(alice);
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('a member does not see paths somebody else removed', n = 0);

  ------------------------------------------------------------------ writing
  perform pg_temp.act_as(alice);
  perform public.restore_archived_general_tasks(proj.id);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('bulk restore brings back your own',
    (select archived_at is null from public.general_tasks where id = t_alice));
  perform pg_temp.ok('...and leaves somebody else''s archived',
    (select archived_at is not null from public.general_tasks where id = t_bob));

  perform pg_temp.act_as(alice);
  perform public.delete_archived_general_tasks(proj.id);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('bulk delete leaves somebody else''s archived task alone',
    exists (select 1 from public.general_tasks where id = t_bob));

  perform pg_temp.act_as(alice);
  begin
    perform public.delete_archived_general_task(t_bob);
    perform pg_temp.ok('a member cannot delete another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot delete another member''s archived task', true);
  end;

  begin
    perform public.archive_general_task(t_bob, false);
    perform pg_temp.ok('a member cannot restore another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot restore another member''s archived task', true);
  end;

  perform pg_temp.act_as(bob);
  begin
    perform public.delete_archived_general_draft_path(repo.id, 'notes', alice);
    perform pg_temp.ok('a member cannot delete another member''s archived draft item', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot delete another member''s archived draft item', true);
  end;

  perform pg_temp.act_as(manager_id);
  perform public.delete_archived_general_draft_path(repo.id, 'notes', alice);
  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('a Manager can clear a member''s archived draft item', n = 0);

  perform public.delete_archived_general_task(t_bob);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('a Manager can delete anybody''s archived task',
    not exists (select 1 from public.general_tasks where id = t_bob));
end $$;

rollback;
