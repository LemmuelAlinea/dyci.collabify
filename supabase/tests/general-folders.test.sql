-- Renaming folders through a draft. Rolls back.
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
  owner_id uuid := gen_random_uuid();
  member   uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  draft    public.general_drafts%rowtype;
  n        int;
  act      text;
  txt      text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Fold', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'fold-owner@test.local', 'Owner'),
                 (member, 'fold-member@test.local', 'Member'),
                 (outsider, 'fold-out@test.local', 'Out')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Folder project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'docs/one.md', 'action', 'added', 'kind', 'text', 'content', 'One'),
    jsonb_build_object('path', 'docs/two.md', 'action', 'added', 'kind', 'text', 'content', 'Two'),
    jsonb_build_object('path', 'keep/x.md', 'action', 'added', 'kind', 'text', 'content', 'X')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level) values (proj.id, member, 'member');

  ------------------------------------------------------------------ draft-only folder
  perform pg_temp.act_as(member);
  draft := public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'New folder/.keep', 'added', 'text', '');
  perform public.save_general_draft_file(repo.id, 'New folder/notes.md', 'added', 'text', 'N');

  n := public.rename_general_draft_folder(repo.id, 'New folder', 'Chapter 3');
  perform pg_temp.ok('renaming a draft-only folder moves each file', n = 2);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path like 'New folder/%';
  perform pg_temp.ok('...and leaves nothing under the old name', n = 0);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path in ('Chapter 3/.keep', 'Chapter 3/notes.md') and action = 'added';
  perform pg_temp.ok('...under the new name, still as additions', n = 2);

  ------------------------------------------------------------------ underscore/percent are not wildcards
  perform public.save_general_draft_file(repo.id, 'a_b/1.md', 'added', 'text', '1');
  perform public.save_general_draft_file(repo.id, 'axb/2.md', 'added', 'text', '2');
  n := public.rename_general_draft_folder(repo.id, 'a_b', 'c');
  perform pg_temp.ok('renaming a_b moves only its own files', n = 1);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'axb/2.md' and action = 'added';
  perform pg_temp.ok('...and a lookalike folder is left untouched', n = 1);

  perform public.save_general_draft_file(repo.id, 'my-docs/note.md', 'added', 'text', 'M');
  n := public.rename_general_draft_folder(repo.id, 'c', 'my_docs');
  perform pg_temp.ok('an underscore in the new name does not collide with a similar dash name', n = 1);

  ------------------------------------------------------------------ Main folder
  perform public.save_general_draft_file(repo.id, 'docs/two.md', 'changed', 'text', 'Two, edited');
  n := public.rename_general_draft_folder(repo.id, 'docs', 'papers');
  perform pg_temp.ok('renaming a Main folder touches each of its files', n = 2);

  select action into act from public.general_draft_files where draft_id = draft.id and path = 'docs/one.md';
  perform pg_temp.ok('the old path is removed in the draft', act = 'removed');
  select action into act from public.general_draft_files where draft_id = draft.id and path = 'papers/one.md';
  perform pg_temp.ok('the new path is added in the draft', act = 'added');
  select content into txt from public.general_draft_files where draft_id = draft.id and path = 'papers/two.md';
  perform pg_temp.ok('a file already edited in the draft carries the edit', txt = 'Two, edited');
  select count(*) into n from public.general_repo_tree where repo_id = repo.id and path like 'docs/%';
  perform pg_temp.ok('Main is untouched until review', n = 2);

  ------------------------------------------------------------------ isolation setup: the owner drafts under the same name
  perform pg_temp.act_as(owner_id);
  perform public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'Chapter 3/own.md', 'added', 'text', 'Owner draft');
  perform pg_temp.act_as(member);

  ------------------------------------------------------------------ refusals
  begin
    perform public.rename_general_draft_folder(repo.id, 'papers', 'keep');
    perform pg_temp.ok('a name already in Main is refused', false);
  exception when unique_violation then
    perform pg_temp.ok('a name already in Main is refused', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', 'Chapter 3/inner');
    perform pg_temp.ok('a folder cannot move inside itself', false);
  exception when check_violation then
    perform pg_temp.ok('a folder cannot move inside itself', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', '../escape');
    perform pg_temp.ok('a name that climbs out is refused', false);
  exception when check_violation then
    perform pg_temp.ok('a name that climbs out is refused', true);
  end;

  begin
    perform public.rename_general_draft_folder(repo.id, 'Nowhere', 'Somewhere');
    perform pg_temp.ok('a folder that is not there is refused', false);
  exception when no_data_found then
    perform pg_temp.ok('a folder that is not there is refused', true);
  end;

  perform pg_temp.act_as(outsider);
  begin
    perform public.rename_general_draft_folder(repo.id, 'Chapter 3', 'Stolen');
    perform pg_temp.ok('somebody not on the project cannot rename', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('somebody not on the project cannot rename', true);
  end;

  perform pg_temp.act_as(member);
  n := public.rename_general_draft_folder(repo.id, 'Chapter 3', 'Renamed');
  perform pg_temp.ok('the member can still rename Chapter 3 afterwards', n = 2);

  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_draft_files f
    join public.general_drafts d on d.id = f.draft_id
   where d.user_id = owner_id and f.path = 'Chapter 3/own.md';
  perform pg_temp.ok('renaming only ever touches your own draft', n = 1);

  ------------------------------------------------------------------ exact folder prefixes
  perform pg_temp.act_as(member);
  perform public.save_general_draft_file(repo.id, 'q_r/1.md', 'added', 'text', '1');
  perform public.save_general_draft_file(repo.id, 'qxr/2.md', 'added', 'text', '2');
  perform public.submit_general_draft_folder(repo.id, 'q_r', 'Folder q_r', '', owner_id);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'qxr/2.md' and archived_at is null;
  perform pg_temp.ok('submitting a_b leaves axb/ in the draft', n = 1);
  select jsonb_array_length(files) into n from public.general_repo_changes
   where repo_id = repo.id and title = 'Folder q_r';
  perform pg_temp.ok('...and the change carries only a_b/ files', n = 1);

  perform public.save_general_draft_file(repo.id, 's_t/1.md', 'added', 'text', '1');
  perform public.save_general_draft_file(repo.id, 'sxt/2.md', 'added', 'text', '2');
  perform public.archive_general_draft_path(repo.id, 's_t', true);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'sxt/2.md' and archived_at is null;
  perform pg_temp.ok('archiving a_b leaves axb/ in the draft', n = 1);

  perform public.archive_general_draft_path(repo.id, 'sxt', true);
  perform public.delete_archived_general_draft_path(repo.id, 's_t');
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path = 'sxt/2.md' and archived_at is not null;
  perform pg_temp.ok('deleting archived a_b leaves archived axb/', n = 1);

  ------------------------------------------------------------------ discard keeps the archive
  perform public.save_general_draft_file(repo.id, 'loose.md', 'added', 'text', 'L');
  perform public.discard_general_draft(repo.id);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'loose.md';
  perform pg_temp.ok('discarding empties the working files', n = 0);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'sxt/2.md';
  perform pg_temp.ok('...and archived draft files survive a discard', n = 1);

  ------------------------------------------------------------------ .keep is not a file
  perform public.save_general_draft_file(repo.id, 'conf/.keep', 'added', 'text', '');
  perform public.save_general_draft_file(repo.id, 'conf/real.md', 'added', 'text', 'R');
  perform pg_temp.act_as(owner_id);
  perform public.commit_general_files(repo.id, 'Second', 1, jsonb_build_array(
    jsonb_build_object('path', 'conf/.keep', 'action', 'added', 'kind', 'text', 'content', ''),
    jsonb_build_object('path', 'conf/real.md', 'action', 'added', 'kind', 'text', 'content', 'Main')));
  select file_count into n from public.general_repo_overview where id = repo.id;
  perform pg_temp.ok('the Main file count leaves out .keep', n = 4);
  perform pg_temp.act_as(member);
  select count(*) into n from public.general_draft_conflicts(repo.id) c where c.path = 'conf/.keep';
  perform pg_temp.ok('a .keep never reads as a conflict', n = 0);
  select count(*) into n from public.general_draft_conflicts(repo.id) c where c.path = 'conf/real.md';
  perform pg_temp.ok('...while a real file still does', n = 1);

  ------------------------------------------------------------------ archived project
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, true);
  perform pg_temp.act_as(member);

  begin
    perform public.archive_general_draft_path(repo.id, 'conf', true);
    perform pg_temp.ok('archiving a draft path in an archived project is refused', false);
  exception when check_violation then
    perform pg_temp.ok('archiving a draft path in an archived project is refused', true);
  end;
  begin
    perform public.delete_archived_general_draft_path(repo.id, 'sxt');
    perform pg_temp.ok('deleting an archived draft path in an archived project is refused', false);
  exception when check_violation then
    perform pg_temp.ok('deleting an archived draft path in an archived project is refused', true);
  end;
  begin
    perform public.restore_archived_general_draft_files(repo.id);
    perform pg_temp.ok('restoring archived draft files in an archived project is refused', false);
  exception when check_violation then
    perform pg_temp.ok('restoring archived draft files in an archived project is refused', true);
  end;
  begin
    perform public.delete_archived_general_draft_files(repo.id);
    perform pg_temp.ok('deleting archived draft files in an archived project is refused', false);
  exception when check_violation then
    perform pg_temp.ok('deleting archived draft files in an archived project is refused', true);
  end;
end $$;

rollback;
