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
  carol      uuid := gen_random_uuid();
  dave       uuid := gen_random_uuid();
  t_bob2     uuid;
  t_alice2   uuid;
  t_alice3   uuid;
  t_alice4   uuid;
  f_alice    uuid;
  f_bob2     uuid;
  t_owner    uuid;
  f_hidden   uuid;
  n          int;
  remove_qual text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Arc', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_uid, 'arc-owner@test.local', 'Owner'),
                 (manager_id, 'arc-manager@test.local', 'Manager'),
                 (alice, 'arc-alice@test.local', 'Alice'),
                 (bob, 'arc-bob@test.local', 'Bob'),
                 (carol, 'arc-carol@test.local', 'Carol'),
                 (dave, 'arc-dave@test.local', 'Dave')) as v(id, em, ln);

  perform pg_temp.act_as(owner_uid);
  proj := public.create_general_project('Archive project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'added', 'kind', 'text', 'content', 'A'),
    jsonb_build_object('path', 'b.md', 'action', 'added', 'kind', 'text', 'content', 'B')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, manager_id, 'manager'), (proj.id, alice, 'member'), (proj.id, bob, 'member'),
         (proj.id, carol, 'member'), (proj.id, dave, 'member');
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

  ------------------------------------------------------------------ the tables themselves
  perform pg_temp.act_as_service();
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (proj.id, carol, 'manage_tasks', owner_uid), (proj.id, dave, 'edit_files', owner_uid);
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Bob second', bob) returning id into t_bob2;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Alice second', alice) returning id into t_alice2;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Alice third', alice) returning id into t_alice3;
  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Alice fourth', alice) returning id into t_alice4;
  insert into public.general_task_files (task_id, project_id, uploaded_by, file_path, file_name, size_bytes)
  values (t_alice2, proj.id, alice, proj.id || '/' || t_alice2 || '/1-a.pdf', 'a.pdf', 10)
  returning id into f_alice;

  perform pg_temp.act_as(bob);
  perform public.archive_general_task(t_bob2, true);
  perform pg_temp.act_as(owner_uid);
  perform public.archive_general_task(t_alice3, true);
  perform pg_temp.act_as(alice);
  perform public.archive_general_task(t_alice4, true);
  perform public.archive_general_task_file(f_alice, true);

  -- A manage_tasks grantee who is not an Owner or Manager.
  perform pg_temp.act_as(carol);
  begin
    perform public.archive_general_task(t_bob2, false);
    perform pg_temp.ok('a manage_tasks grantee cannot restore another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a manage_tasks grantee cannot restore another member''s archived task', true);
  end;
  begin
    perform public.delete_archived_general_task(t_bob2);
    perform pg_temp.ok('a manage_tasks grantee cannot delete another member''s archived task', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a manage_tasks grantee cannot delete another member''s archived task', true);
  end;
  perform public.restore_archived_general_tasks(proj.id);
  perform public.delete_archived_general_tasks(proj.id);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('...and their bulk restore and delete leave it archived',
    (select archived_at is not null from public.general_tasks where id = t_bob2));

  perform pg_temp.act_as(carol);
  select count(*) into n from public.general_tasks where id = t_bob2;
  perform pg_temp.ok('a manage_tasks grantee cannot read another member''s archived task from the table', n = 0);
  begin
    update public.general_tasks set archived_at = null where id = t_bob2;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.general_tasks where id = t_bob2;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.ok('a manage_tasks grantee cannot restore it by writing the table',
    (select archived_at is not null from public.general_tasks where id = t_bob2));
  perform pg_temp.ok('a manage_tasks grantee cannot delete it from the table',
    exists (select 1 from public.general_tasks where id = t_bob2));

  -- A plain member.
  perform pg_temp.act_as(alice);
  select count(*) into n from public.general_tasks where id = t_bob2;
  perform pg_temp.ok('a member cannot read another member''s archived task from the table', n = 0);
  begin
    update public.general_tasks set archived_at = null where id = t_bob2;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.general_tasks set archived_by = alice where id = t_alice3;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.general_tasks set archived_at = null where id = t_alice4;
    perform pg_temp.ok('a member cannot restore their own archive by writing the table', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot restore their own archive by writing the table', true);
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.ok('a member cannot restore another member''s archived task by writing the table',
    (select archived_at is not null from public.general_tasks where id = t_bob2));
  perform pg_temp.ok('a member cannot claim an archive somebody else made',
    (select archived_by = owner_uid from public.general_tasks where id = t_alice3));
  perform pg_temp.ok('...and their own archive stays archived',
    (select archived_at is not null from public.general_tasks where id = t_alice4));
  update public.general_tasks set archived_at = null, archived_by = null where id = t_alice4;
  perform pg_temp.ok('a service session can still write the archive columns',
    (select archived_at is null from public.general_tasks where id = t_alice4));

  -- Task files.
  perform pg_temp.act_as(bob);
  select count(*) into n from public.list_archived_general_task_files(proj.id);
  perform pg_temp.ok('a member does not see another member''s archived task file', n = 0);
  select count(*) into n from public.general_task_files where id = f_alice;
  perform pg_temp.ok('...nor read it from the table', n = 0);
  begin
    perform public.delete_archived_general_task_file(f_alice);
    perform pg_temp.ok('a member cannot delete another member''s archived task file', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a member cannot delete another member''s archived task file', true);
  end;

  perform pg_temp.act_as(dave);
  begin
    delete from public.general_task_files where id = f_alice;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as(alice);
  begin
    update public.general_task_files set archived_at = null where id = f_alice;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.ok('an edit_files grantee cannot delete another member''s archived file from the table',
    exists (select 1 from public.general_task_files where id = f_alice));
  perform pg_temp.ok('a member cannot restore a task file by writing the table',
    (select archived_at is not null from public.general_task_files where id = f_alice));

  perform pg_temp.act_as(owner_uid);
  select count(*) into n from public.list_archived_general_task_files(proj.id);
  perform pg_temp.ok('an Owner sees a member''s archived task file', n = 1);
  select count(*) into n from public.general_task_files where id = f_alice;
  perform pg_temp.ok('...and reads it from the table', n = 1);

  -- A member who removed a Main path (edit_files lets them commit).
  perform pg_temp.act_as(dave);
  perform public.commit_general_files(repo.id, 'Drop a', 2, jsonb_build_array(
    jsonb_build_object('path', 'a.md', 'action', 'removed', 'kind', 'text', 'content', '')));
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('a member who removed a path sees it', n = 1);
  perform pg_temp.act_as(owner_uid);
  select count(*) into n from public.list_removed_general_repo_paths(proj.id);
  perform pg_temp.ok('...and an Owner sees every removed path', n = 2);
  ------------------------------------------------------------------ storage and activity
  perform pg_temp.act_as_service();
  insert into storage.objects (bucket_id, name)
  values ('general-files', proj.id || '/' || t_alice2 || '/1-a.pdf'),
         ('general-files', proj.id || '/files/keep.md');
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (t_bob2, proj.id, bob, 'Bob note'), (t_alice2, proj.id, alice, 'Alice note');
  insert into public.general_task_logs (task_id, project_id, user_id, minutes)
  values (t_bob2, proj.id, bob, 15);
  insert into public.general_task_assignees (task_id, project_id, user_id)
  values (t_bob2, proj.id, bob);

  perform pg_temp.act_as(bob);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform pg_temp.ok('a member cannot read another member''s archived file in Storage', n = 0);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/files/keep.md';
  perform pg_temp.ok('...while project files in the same bucket stay readable', n = 1);

  perform pg_temp.act_as(alice);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform pg_temp.ok('whoever archived a file still reads it in Storage', n = 1);
  perform pg_temp.act_as(owner_uid);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform pg_temp.ok('an Owner reads an archived file in Storage', n = 1);

  perform pg_temp.act_as(dave);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform pg_temp.ok('an edit_files grantee cannot see another member''s archived file in Storage', n = 0);
  -- Storage's own API sets this; without it a direct delete is refused before RLS.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('...nor remove it',
    exists (select 1 from storage.objects
             where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf'));

  perform pg_temp.act_as(alice);
  select count(*) into n from public.general_task_comments where task_id = t_bob2;
  perform pg_temp.ok('a member cannot read comments on another member''s archived task', n = 0);
  select count(*) into n from public.general_task_events where task_id = t_bob2;
  perform pg_temp.ok('...nor its events', n = 0);
  select count(*) into n from public.general_task_logs where task_id = t_bob2;
  perform pg_temp.ok('...nor its time logs', n = 0);
  select count(*) into n from public.general_task_assignees where task_id = t_bob2;
  perform pg_temp.ok('...nor who holds it', n = 0);

  perform pg_temp.act_as(bob);
  select count(*) into n from public.general_task_comments where task_id = t_bob2;
  perform pg_temp.ok('whoever archived a task still reads its comments', n = 1);
  select count(*) into n from public.general_task_events where task_id = t_alice2;
  perform pg_temp.ok('events of an active task stay visible to every member', n >= 1);
  select count(*) into n from public.general_task_comments where task_id = t_alice2;
  perform pg_temp.ok('...and so do its comments', n = 1);

  perform pg_temp.act_as(owner_uid);
  select count(*) into n from public.general_task_comments where task_id = t_bob2;
  perform pg_temp.ok('an Owner reads comments on an archived task', n = 1);
  select count(*) into n from public.general_task_events where task_id = t_bob2;
  perform pg_temp.ok('...and its events', n >= 1);
  select count(*) into n from public.general_task_logs where task_id = t_bob2;
  perform pg_temp.ok('...and its time logs', n = 1);
  ------------------------------------------------------------------ files on an archived task
  perform pg_temp.act_as_service();
  insert into public.general_task_files (task_id, project_id, uploaded_by, file_path, file_name, size_bytes)
  values (t_bob2, proj.id, bob, proj.id || '/' || t_bob2 || '/1-b.pdf', 'b.pdf', 10)
  returning id into f_bob2;
  insert into storage.objects (bucket_id, name)
  values ('general-files', proj.id || '/' || t_bob2 || '/1-b.pdf');

  perform pg_temp.act_as(alice);
  select count(*) into n from public.general_task_files where id = f_bob2;
  perform pg_temp.ok('a member cannot read a file on another member''s archived task', n = 0);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_bob2 || '/1-b.pdf';
  perform pg_temp.ok('...nor its object in Storage', n = 0);

  perform pg_temp.act_as(dave);
  delete from public.general_task_files where id = f_bob2;
  perform pg_temp.act_as_service();
  perform pg_temp.ok('an edit_files grantee cannot delete a file on another member''s archived task',
    exists (select 1 from public.general_task_files where id = f_bob2));

  perform pg_temp.act_as(bob);
  select count(*) into n from public.general_task_files where id = f_bob2;
  perform pg_temp.ok('whoever archived the task still reads its file', n = 1);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_bob2 || '/1-b.pdf';
  perform pg_temp.ok('...and its object in Storage', n = 1);
  perform pg_temp.act_as(owner_uid);
  select count(*) into n from public.general_task_files where id = f_bob2;
  perform pg_temp.ok('an Owner reads a file on an archived task', n = 1);
  select count(*) into n from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_bob2 || '/1-b.pdf';
  perform pg_temp.ok('...and its object in Storage', n = 1);

  -- A scoped WHERE as dave would also apply the read policy, so run the live
  -- remove policy's own predicate as dave, limited to this project's objects.
  perform pg_temp.act_as_service();
  perform set_config('request.jwt.claims',
    json_build_object('sub', dave, 'role', 'authenticated')::text, true);
  select qual into remove_qual from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'general_files_remove';
  perform set_config('storage.allow_delete_query', 'true', true);
  execute format('delete from storage.objects where bucket_id = %L and left(name, %s) = %L and (%s)',
                 'general-files', char_length(proj.id::text) + 1, proj.id || '/', remove_qual);
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('the Storage remove policy on its own refuses a hidden task file',
    exists (select 1 from storage.objects
             where bucket_id = 'general-files' and name = proj.id || '/' || t_bob2 || '/1-b.pdf'));
  perform pg_temp.ok('...and a hidden archived file',
    exists (select 1 from storage.objects
             where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf'));
  perform pg_temp.ok('...while it still removes what the grantee may remove',
    not exists (select 1 from storage.objects
                 where bucket_id = 'general-files' and name = proj.id || '/files/keep.md'));
  ------------------------------------------------------------------ objects left behind
  perform pg_temp.act_as(alice);
  perform pg_temp.ok('whoever archived a file learns its object is still in Storage',
    public.archived_general_task_file_objects(array[f_alice])
      = array[proj.id || '/' || t_alice2 || '/1-a.pdf']);
  perform pg_temp.act_as(bob);
  perform pg_temp.ok('...while a member who cannot see it learns nothing',
    cardinality(public.archived_general_task_file_objects(array[f_alice])) = 0);
  perform pg_temp.act_as_service();
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'general-files' and name = proj.id || '/' || t_alice2 || '/1-a.pdf';
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp.act_as(alice);
  perform pg_temp.ok('...and once the object is gone, nothing is left to remove',
    cardinality(public.archived_general_task_file_objects(array[f_alice])) = 0);
  ------------------------------------------------------------------ definer functions reading tasks
  -- t_bob2 is archived by Bob, so Alice may not see it; t_alice2 is active.
  perform pg_temp.act_as(manager_id);
  insert into public.general_task_assignees (task_id, project_id, user_id)
  values (t_bob2, proj.id, alice), (t_bob2, proj.id, manager_id), (t_alice2, proj.id, bob);
  perform pg_temp.act_as_service();
  perform pg_temp.ok('assigning somebody to an archived task they cannot see does not tell them its title',
    not exists (select 1 from public.notifications
                 where user_id = alice and general_task_id = t_bob2));
  perform pg_temp.ok('...while assigning an active task still notifies',
    exists (select 1 from public.notifications
             where user_id = bob and general_task_id = t_alice2 and type = 'general_task_assigned'));

  perform pg_temp.act_as(bob);
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (t_bob2, proj.id, bob, 'Hidden reply'), (t_alice2, proj.id, bob, 'Open reply');
  perform pg_temp.act_as_service();
  perform pg_temp.ok('a comment on an archived task does not reach a holder who cannot see it',
    not exists (select 1 from public.notifications
                 where user_id = alice and general_task_id = t_bob2 and type = 'general_comment_posted'));
  perform pg_temp.ok('...but still reaches a Manager who holds it',
    exists (select 1 from public.notifications
             where user_id = manager_id and general_task_id = t_bob2 and type = 'general_comment_posted'));
  perform pg_temp.ok('...and a comment on an active task still notifies',
    exists (select 1 from public.notifications
             where user_id = alice and general_task_id = t_alice2 and type = 'general_comment_posted'));

  update public.general_tasks set due_at = now() + interval '2 hours', status = 'todo'
   where id in (t_bob2, t_alice2);
  delete from public.notifications where general_task_id in (t_bob2, t_alice2);
  perform public.send_general_deadline_reminders();
  perform pg_temp.ok('a deadline reminder skips a holder who cannot see the archived task',
    not exists (select 1 from public.notifications
                 where user_id = alice and general_task_id = t_bob2 and type = 'general_deadline_soon'));
  perform pg_temp.ok('...but reaches a Manager who holds it',
    exists (select 1 from public.notifications
             where user_id = manager_id and general_task_id = t_bob2 and type = 'general_deadline_soon'));
  perform pg_temp.ok('...and active tasks still get reminders',
    exists (select 1 from public.notifications
             where user_id = bob and general_task_id = t_alice2 and type = 'general_deadline_soon'));

  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Owner hid this', alice) returning id into t_owner;
  insert into public.general_task_files (task_id, project_id, uploaded_by, file_path, file_name, size_bytes)
  values (t_owner, proj.id, alice, proj.id || '/' || t_owner || '/1-c.pdf', 'c.pdf', 10)
  returning id into f_hidden;
  perform pg_temp.act_as(alice);
  perform public.archive_general_task_file(f_hidden, true);
  perform pg_temp.act_as(owner_uid);
  perform public.archive_general_task(t_owner, true);
  perform pg_temp.act_as(alice);
  perform pg_temp.ok('the archived files list does not name a task somebody else archived',
    not exists (select 1 from public.list_archived_general_task_files(proj.id)
                 where task_title = 'Owner hid this'));
  perform pg_temp.act_as(owner_uid);
  perform pg_temp.ok('...while an Owner still sees that file',
    exists (select 1 from public.list_archived_general_task_files(proj.id) where id = f_hidden));
end $$;

rollback;
