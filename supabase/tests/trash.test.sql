-- Trash for draft files, folders and task files, kept apart from Archive. Rolls back.
--
--   node scripts/db.mjs supabase/tests/trash.test.sql
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
  perform set_config('role', 'postgres', true);
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
  owner_id uuid := gen_random_uuid();
  member   uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  draft    public.general_drafts%rowtype;
  t_id     uuid;
  file_a   uuid;
  file_b   uuid;
  n        int;
  refused  boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Trash', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'trash-owner@test.local', 'Owner'),
                 (member, 'trash-member@test.local', 'Member')) as v(id, em, ln);
  update public.profiles set status = 'active' where created_at = now() and role = 'faculty' and status = 'pending';

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Trash project', '');
  repo := public.create_general_repo(proj.id, 'Files');

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level) values (proj.id, member, 'member');

  ------------------------------------------------------------------ draft files and folders
  perform pg_temp.act_as(owner_id);
  draft := public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'ch/a.md', 'added', 'text', 'A');
  perform public.save_general_draft_file(repo.id, 'ch/b.md', 'added', 'text', 'B');
  perform public.save_general_draft_file(repo.id, 'ch_x/c.md', 'added', 'text', 'C');
  perform public.save_general_draft_file(repo.id, 'kept.md', 'added', 'text', 'K');
  perform public.save_general_draft_file(repo.id, 'old.md', 'added', 'text', 'O');
  perform public.archive_general_draft_path(repo.id, 'old.md', true);

  n := public.trash_general_draft_path(repo.id, 'ch');
  perform pg_temp.ok('a folder goes to Trash whole', n = 2);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'ch_x/c.md' and trashed_at is null and archived_at is null;
  perform pg_temp.ok('...and a lookalike folder stays in the draft', n = 1);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and archived_at is null;
  perform pg_temp.ok('...and the trashed files leave My draft', n = 2);

  select count(*) into n from public.list_archived_general_draft_files(repo.id);
  perform pg_temp.ok('the archive does not show trashed files', n = 1);

  select count(*) into n from public.list_my_trash() where kind = 'draft' and root = 'ch' and is_folder and file_count = 2;
  perform pg_temp.ok('Trash shows the folder as one row', n = 1);
  select count(*) into n from public.list_my_trash() where purge_at > now() + interval '29 days';
  perform pg_temp.ok('...due to go in 30 days', n = 1);

  perform public.restore_archived_general_draft_files(repo.id);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and trashed_at is not null;
  perform pg_temp.ok('restoring the archive leaves Trash alone', n = 2);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'old.md' and archived_at is null;
  perform pg_temp.ok('...while it restores the archived file', n = 1);

  begin
    update public.general_draft_files set trashed_at = null where draft_id = draft.id and trashed_at is not null;
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('trash columns cannot be edited directly', refused);

  perform public.restore_trashed_draft_path(repo.id, 'ch');
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path like 'ch/%' and archived_at is null and trashed_at is null and trash_root is null;
  perform pg_temp.ok('a folder comes back from Trash into the draft', n = 2);

  perform public.trash_general_draft_path(repo.id, 'kept.md');
  perform public.save_general_draft_file(repo.id, 'kept.md', 'added', 'text', 'K again');
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'kept.md' and trashed_at is null and archived_at is null;
  perform pg_temp.ok('saving over a trashed path takes it out of Trash', n = 1);

  perform public.trash_general_draft_path(repo.id, 'kept.md');
  perform public.delete_trashed_draft_path(repo.id, 'kept.md');
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'kept.md';
  perform pg_temp.ok('deleting from Trash removes it for good', n = 0);

  ------------------------------------------------------------------ task files
  insert into public.general_tasks (project_id, title) values (proj.id, 'Trash task') returning id into t_id;
  insert into public.general_task_files (task_id, project_id, file_path, file_name, mime_type, size_bytes)
  values (t_id, proj.id, proj.id || '/' || t_id || '/a.pdf', 'a.pdf', 'application/pdf', 10)
  returning id into file_a;
  insert into public.general_task_files (task_id, project_id, file_path, file_name, mime_type, size_bytes)
  values (t_id, proj.id, proj.id || '/' || t_id || '/b.pdf', 'b.pdf', 'application/pdf', 20)
  returning id into file_b;

  perform pg_temp.act_as(member);
  begin
    perform public.trash_general_task_file(file_a);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a Member cannot trash somebody else''s task file', refused);

  perform pg_temp.act_as(owner_id);
  perform public.trash_general_task_file(file_a);
  select count(*) into n from public.general_task_files where task_id = t_id and archived_at is null;
  perform pg_temp.ok('a trashed task file leaves its task', n = 1);
  select count(*) into n from public.list_archived_general_task_files(proj.id);
  perform pg_temp.ok('...and stays out of the archive', n = 0);
  select count(*) into n from public.list_my_trash() where kind = 'task_file' and id = file_a and task_title = 'Trash task';
  perform pg_temp.ok('...and shows in Trash with its task', n = 1);

  perform pg_temp.act_as(member);
  select count(*) into n from public.list_my_trash();
  perform pg_temp.ok('nobody else sees your Trash', n = 0);
  perform public.restore_trashed_task_file(file_a);
  perform public.delete_trashed_task_file(file_a);

  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_task_files where id = file_a and trashed_at is not null;
  perform pg_temp.ok('...or restores or deletes it', n = 1);

  begin
    perform public.archive_general_task_file(file_a, false);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('the archive''s restore refuses a trashed file', refused);

  perform public.restore_trashed_task_file(file_a);
  select count(*) into n from public.general_task_files where id = file_a and archived_at is null and trashed_at is null;
  perform pg_temp.ok('a task file comes back from Trash', n = 1);

  perform public.trash_general_task_file(file_b);
  perform public.trash_general_draft_path(repo.id, 'ch');
  n := public.empty_my_trash();
  perform pg_temp.ok('emptying Trash deletes all of it', n = 3);

  ------------------------------------------------------------------ thirty days on
  perform public.trash_general_task_file(file_a);
  perform public.trash_general_draft_path(repo.id, 'ch_x');
  perform pg_temp.act_as_service();
  update public.general_task_files set trashed_at = now() - interval '31 days' where id = file_a;
  -- Backdated as the owner: the draft guard wants somebody signed in.
  perform pg_temp.act_as(owner_id);
  perform set_config('collabify.trash_op', 'on', true);
  update public.general_draft_files set trashed_at = now() - interval '31 days' where draft_id = draft.id and trashed_at is not null;
  perform set_config('collabify.trash_op', 'off', true);
  perform pg_temp.act_as_service();
  n := public.purge_trash();
  perform pg_temp.ok('Trash empties itself after 30 days', n = 2);

  perform pg_temp.act_as(owner_id);
  begin
    perform public.purge_trash();
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a signed-in person cannot run the purge', refused);

  perform pg_temp.act_as_service();
  perform pg_temp.ok('the purge runs once a day',
    exists (select 1 from cron.job where jobname = 'collabify-trash-purge'));
end $$;

rollback;
