-- File kinds, uploaded objects and the project-kind flag. Rolls back.
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
  other_id uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  proj2    public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  cmt      public.general_commits%rowtype;
  n        int;
  txt      text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'File', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'file-owner@test.local', 'Owner'),
                 (other_id, 'file-other@test.local', 'Other')) as v(id, em, ln);
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';

  perform pg_temp.act_as(owner_id);
  proj  := public.create_general_project('File project', '');
  proj2 := public.create_general_project('Another project', '');
  repo  := public.create_general_repo(proj.id, 'Files');

  ------------------------------------------------------------------ kinds
  cmt := public.commit_general_files(repo.id, 'A file of each kind', 0, jsonb_build_array(
    jsonb_build_object('path', 'src/app.ts', 'action', 'added', 'kind', 'text',
                       'content', 'export const app = 1'),
    jsonb_build_object('path', 'documents/Chapter 1.docx', 'action', 'added', 'kind', 'rich',
                       'content', '<h1>Chapter 1</h1><p>The problem.</p>'),
    jsonb_build_object('path', 'documents/Budget.xlsx', 'action', 'added', 'kind', 'sheet',
                       'content', '{"sheets":[{"name":"Sheet1","cells":{"A1":"Item"}}]}'),
    jsonb_build_object('path', 'documents/Permit.pdf', 'action', 'added', 'kind', 'binary',
                       'storage_path', proj.id::text || '/files/permit-1')
  ));
  perform pg_temp.ok('a commit carries text, rich, sheet and binary together', cmt.seq = 1);

  select count(*) into n from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('all four land in the tree', n = 4);

  select kind::text into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Chapter 1.docx';
  perform pg_temp.ok('a Word file is stored as rich', txt = 'rich');

  select storage_path into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Permit.pdf';
  perform pg_temp.ok('a binary file points at its uploaded object',
                     txt = proj.id::text || '/files/permit-1');

  select content into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Permit.pdf';
  perform pg_temp.ok('a binary file keeps no contents in the database', txt = '');

  -- Folders are the slashes in a path; two files share one without a table.
  select count(distinct split_part(path, '/', 1)) into n
    from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('paths give the tree its folders', n = 2);

  ------------------------------------------------------------------ refusals
  begin
    perform public.commit_general_files(repo.id, 'Binary with no object', 1, jsonb_build_array(
      jsonb_build_object('path', 'x.pdf', 'action', 'added', 'kind', 'binary')));
    perform pg_temp.ok('a binary file without an object is refused', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('a binary file without an object is refused', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Object from elsewhere', 1, jsonb_build_array(
      jsonb_build_object('path', 'x.pdf', 'action', 'added', 'kind', 'binary',
                         'storage_path', proj2.id::text || '/files/stolen')));
    perform pg_temp.ok('an object from another project cannot be committed', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('an object from another project cannot be committed', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Text with an object', 1, jsonb_build_array(
      jsonb_build_object('path', 'x.ts', 'action', 'added', 'kind', 'text',
                         'content', 'a', 'storage_path', proj.id::text || '/files/x')));
    perform pg_temp.ok('only a binary file may name an object', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('only a binary file may name an object', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Unknown kind', 1, jsonb_build_array(
      jsonb_build_object('path', 'x.ts', 'action', 'added', 'kind', 'video', 'content', 'a')));
    perform pg_temp.ok('an unknown kind is refused', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('an unknown kind is refused', true);
  end;

  -- A control: the same shape with a real kind goes through.
  cmt := public.commit_general_files(repo.id, 'A real kind', 1, jsonb_build_array(
    jsonb_build_object('path', 'notes.txt', 'action', 'added', 'kind', 'text', 'content', 'a')));
  perform pg_temp.ok('the same shape with a real kind is accepted', cmt.seq = 2);

  ------------------------------------------------- a kind can change over time
  cmt := public.commit_general_files(repo.id, 'Turned the note into a document', 2, jsonb_build_array(
    jsonb_build_object('path', 'notes.txt', 'action', 'changed', 'kind', 'rich',
                       'content', '<p>a</p>')));
  select kind::text into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'notes.txt';
  perform pg_temp.ok('a file can change kind in a later commit', txt = 'rich');

  select count(*) into n from public.general_blobs
   where repo_id = repo.id and path = 'notes.txt' and kind = 'text';
  perform pg_temp.ok('the older kind is still in the history', n = 1);

  ------------------------------------------------------- removing a binary file
  cmt := public.commit_general_files(repo.id, 'Dropped the permit', 3, jsonb_build_array(
    jsonb_build_object('path', 'documents/Permit.pdf', 'action', 'removed', 'kind', 'binary',
                       'storage_path', proj.id::text || '/files/permit-1')));
  select count(*) into n from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Permit.pdf';
  perform pg_temp.ok('a removed binary file leaves the tree', n = 0);

  select count(*) into n from public.general_blobs
   where repo_id = repo.id and path = 'documents/Permit.pdf' and action = 'added';
  perform pg_temp.ok('the commit that added it still opens', n = 1);

  ------------------------------------------------------------------ documents
  select count(*) into n from pg_class where relname = 'general_docs' and relkind = 'r';
  perform pg_temp.ok('the separate documents tables are gone', n = 0);

  ------------------------------------------------------------ the code flag
  select has_code::int into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('a project does not build software unless it says so', n = 0);

  perform pg_temp.act_as(owner_id);
  update public.general_projects set has_code = true where id = proj.id;
  select has_code::int into n from public.general_project_overview where id = proj.id;
  perform pg_temp.ok('somebody who can edit the project turns the code view on', n = 1);

  perform pg_temp.act_as(other_id);
  update public.general_projects set has_code = false where id = proj.id;
  -- Read it back as somebody who can see the project: a stranger's select is
  -- filtered too, so reading as the stranger would prove nothing either way.
  perform pg_temp.act_as(owner_id);
  select has_code::int into n from public.general_projects where id = proj.id;
  perform pg_temp.ok('a stranger cannot turn it off', n = 1);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(other_id);
  select count(*) into n from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('a stranger reads no files', n = 0);
end $$;

rollback;
