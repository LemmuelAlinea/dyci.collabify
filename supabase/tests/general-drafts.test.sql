-- Per-person drafts and submitting one for review. Rolls back.
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
  owner_id  uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  other_id  uuid := gen_random_uuid();
  outsider  uuid := gen_random_uuid();
  proj      public.general_projects%rowtype;
  repo      public.general_repos%rowtype;
  draft     public.general_drafts%rowtype;
  chg       public.general_repo_changes%rowtype;
  n         int;
  txt       text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Draft', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'draft-owner@test.local', 'Owner'),
                 (member_id, 'draft-member@test.local', 'Member'),
                 (other_id, 'draft-other@test.local', 'Other'),
                 (outsider, 'draft-out@test.local', 'Out')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Draft project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'The first files', 0, jsonb_build_array(
    jsonb_build_object('path', 'documents/Chapter 1.md', 'action', 'added', 'kind', 'text',
                       'content', 'One' || chr(10) || 'Two' || chr(10) || 'Three'),
    jsonb_build_object('path', 'src/app.ts', 'action', 'added', 'kind', 'text',
                       'content', 'export const app = 1')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, member_id, 'member'), (proj.id, other_id, 'member');

  ------------------------------------------------------------------ starting
  perform pg_temp.act_as(member_id);
  draft := public.my_general_draft(repo.id);
  perform pg_temp.ok('anybody on the project gets a draft', draft.id is not null);
  perform pg_temp.ok('a draft starts from the newest commit', draft.base_seq = 1);

  perform pg_temp.ok('asking twice gives the same draft',
                     (public.my_general_draft(repo.id)).id = draft.id);

  perform pg_temp.act_as(outsider);
  begin
    perform public.my_general_draft(repo.id);
    perform pg_temp.ok('somebody not on the project gets no draft', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('somebody not on the project gets no draft', true);
  end;

  ------------------------------------------------------------------ working
  perform pg_temp.act_as(member_id);
  perform public.save_general_draft_file(repo.id, 'documents/Chapter 1.md', 'changed', 'text',
    'One' || chr(10) || 'Two, reworded' || chr(10) || 'Three');
  perform public.save_general_draft_file(repo.id, 'documents/Chapter 2.md', 'added', 'text',
    'The review of related literature.');

  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('a draft holds every file you changed', n = 2);

  -- Saving the same path again replaces it rather than piling up.
  perform public.save_general_draft_file(repo.id, 'documents/Chapter 2.md', 'added', 'text',
    'The review of related literature, second pass.');
  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('saving the same file again replaces it', n = 2);
  select content into txt from public.general_draft_files
   where draft_id = draft.id and path = 'documents/Chapter 2.md';
  perform pg_temp.ok('the newest wording is what is kept',
                     txt = 'The review of related literature, second pass.');

  ----------------------------------------------------- Main is untouched by a draft
  select content into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Chapter 1.md';
  perform pg_temp.ok('Main still says what it said',
                     txt = 'One' || chr(10) || 'Two' || chr(10) || 'Three');

  select count(*) into n from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Chapter 2.md';
  perform pg_temp.ok('a file only in a draft is not in Main', n = 0);

  ------------------------------------------------------------ a draft is private
  perform pg_temp.act_as(other_id);
  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('another member reads none of your draft', n = 0);

  perform pg_temp.act_as(owner_id);
  select count(*) into n from public.general_drafts where user_id = member_id;
  perform pg_temp.ok('not even an Owner reads somebody else''s draft', n = 0);

  -- Two people draft at once without touching each other.
  perform pg_temp.act_as(other_id);
  perform public.save_general_draft_file(repo.id, 'src/app.ts', 'changed', 'text',
    'export const app = 2');
  perform pg_temp.act_as(member_id);
  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('somebody else drafting does not change yours', n = 2);

  ------------------------------------------------------------------ discarding
  perform public.discard_general_draft_file(repo.id, 'documents/Chapter 2.md');
  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('one file can be dropped from a draft', n = 1);

  ------------------------------------------------------------------ submitting
  chg := public.submit_general_draft(repo.id, 'Reworded chapter 1', 'Second sentence only.', owner_id);
  perform pg_temp.ok('a draft becomes one change', chg.id is not null);
  perform pg_temp.ok('the chosen reviewer is stored', chg.reviewer_id = owner_id);
  perform pg_temp.ok('the change carries the draft''s files',
                     jsonb_array_length(chg.files) = 1);
  perform pg_temp.ok('the change is written against the draft''s commit', chg.base_seq = 1);
  perform pg_temp.ok('the change is waiting for review', chg.status = 'open');

  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('submitting empties the draft', n = 0);

  begin
    perform public.submit_general_draft(repo.id, 'Nothing left', '', owner_id);
    perform pg_temp.ok('an empty draft cannot be submitted', false);
  exception when no_data_found then
    perform pg_temp.ok('an empty draft cannot be submitted', true);
  end;

  ------------------------------------------------------------------ reviewing
  perform pg_temp.act_as(owner_id);
  chg := public.answer_general_repo_change(chg.id, true, 'Reads better.');
  perform pg_temp.ok('an Owner merges a submitted draft', chg.status = 'applied');

  select content into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'documents/Chapter 1.md';
  perform pg_temp.ok('Main now says what the draft said',
                     txt = 'One' || chr(10) || 'Two, reworded' || chr(10) || 'Three');

  select author_id::text into txt from public.general_commits
   where repo_id = repo.id and seq = 2;
  perform pg_temp.ok('the commit is credited to whoever drafted it', txt = member_id::text);

  ------------------------------------------------- a draft that fell behind
  perform pg_temp.act_as(other_id);
  select count(*) into n from public.general_draft_conflicts(repo.id);
  perform pg_temp.ok('a draft touching untouched files reports no clash', n = 0);

  perform public.save_general_draft_file(repo.id, 'documents/Chapter 1.md', 'changed', 'text',
    'A different rewording.');
  select count(*) into n from public.general_draft_conflicts(repo.id);
  perform pg_temp.ok('a draft is told which of its files moved underneath it', n = 1);

  select path into txt from public.general_draft_conflicts(repo.id);
  perform pg_temp.ok('and told which one', txt = 'documents/Chapter 1.md');

  begin
    perform public.submit_general_draft(repo.id, 'From behind', '', owner_id);
    perform pg_temp.ok('a draft behind Main cannot be submitted', false);
  exception when serialization_failure then
    perform pg_temp.ok('a draft behind Main cannot be submitted', true);
  end;

  draft := public.sync_general_draft(repo.id);
  perform pg_temp.ok('bringing a draft up to date moves it to the newest commit',
                     draft.base_seq = 2);

  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('bringing it up to date keeps the work', n = 2);

  chg := public.submit_general_draft_file(repo.id, 'documents/Chapter 1.md', 'Chapter 1 only', '', owner_id);
  perform pg_temp.ok('one draft file can be submitted by itself', jsonb_array_length(chg.files) = 1);
  perform pg_temp.ok('a single-file submission keeps the same base commit', chg.base_seq = 2);

  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('submitting one file keeps the rest in the draft', n = 1);

  chg := public.submit_general_draft(repo.id, 'After catching up', '', owner_id);
  perform pg_temp.ok('the rest submits once it is up to date', chg.base_seq = 2);

  perform public.save_general_draft_file(repo.id, 'folder/a.md', 'added', 'text', 'A');
  perform public.save_general_draft_file(repo.id, 'folder/b.md', 'added', 'text', 'B');
  chg := public.submit_general_draft_folder(repo.id, 'folder', 'Folder ready', '', owner_id);
  perform pg_temp.ok('a draft folder can be submitted together', jsonb_array_length(chg.files) = 2);
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path like 'folder/%';
  perform pg_temp.ok('submitting a folder removes those draft files', n = 0);

  perform public.save_general_draft_file(repo.id, 'scratch/a.md', 'added', 'text', 'A');
  perform public.save_general_draft_file(repo.id, 'scratch/b.md', 'added', 'text', 'B');
  perform public.archive_general_draft_path(repo.id, 'scratch', true);
  select count(*) into n from public.list_archived_general_draft_files(repo.id)
   where path like 'scratch/%';
  perform pg_temp.ok('a draft folder archives before permanent deletion', n = 2);
  perform public.archive_general_draft_path(repo.id, 'scratch', false);
  select count(*) into n from public.list_archived_general_draft_files(repo.id)
   where path like 'scratch/%';
  perform pg_temp.ok('an archived draft folder can be restored', n = 0);
  perform public.archive_general_draft_path(repo.id, 'scratch', true);
  perform public.delete_archived_general_draft_path(repo.id, 'scratch');
  select count(*) into n from public.general_draft_files
   where draft_id = draft.id and path like 'scratch/%';
  perform pg_temp.ok('only archived draft files can be permanently deleted', n = 0);

  ------------------------------------------------------------------ paths
  perform pg_temp.act_as(member_id);
  begin
    perform public.save_general_draft_file(repo.id, '../../etc/passwd', 'added', 'text', 'x');
    perform pg_temp.ok('a draft path cannot climb out of the project', false);
  exception when check_violation then
    perform pg_temp.ok('a draft path cannot climb out of the project', true);
  end;

  begin
    perform public.save_general_draft_file(repo.id, 'x.pdf', 'added', 'binary', '',
      gen_random_uuid()::text || '/files/x');
    perform pg_temp.ok('a draft cannot point at another project''s upload', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a draft cannot point at another project''s upload', true);
  end;

  -- A control: this project's own upload is fine.
  perform public.save_general_draft_file(repo.id, 'x.pdf', 'added', 'binary', '',
    proj.id::text || '/files/x');
  select count(*) into n from public.general_draft_files
   where draft_id = (select id from public.general_drafts
                      where repo_id = repo.id and user_id = member_id)
     and path = 'x.pdf';
  perform pg_temp.ok('this project''s own upload is accepted', n = 1);

  ------------------------------------------------------------------ archived
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, true);

  perform pg_temp.act_as(member_id);
  begin
    perform public.save_general_draft_file(repo.id, 'after.md', 'added', 'text', 'x');
    perform pg_temp.ok('an archived project takes no draft edits', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('an archived project takes no draft edits', true);
  end;

  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, false);

  ------------------------------------------------------- a deactivated account
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = member_id;

  perform pg_temp.act_as(member_id);
  begin
    perform public.save_general_draft_file(repo.id, 'after.md', 'added', 'text', 'x');
    perform pg_temp.ok('a deactivated account cannot work in a draft', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a deactivated account cannot work in a draft', true);
  end;

  -- A control: an active member still can.
  perform pg_temp.act_as(other_id);
  perform public.save_general_draft_file(repo.id, 'after.md', 'added', 'text', 'x');
  select count(*) into n from public.general_draft_files
   where draft_id = (select id from public.general_drafts
                      where repo_id = repo.id and user_id = other_id)
     and path = 'after.md';
  perform pg_temp.ok('an active member still can after that refusal', n = 1);
end $$;

rollback;
