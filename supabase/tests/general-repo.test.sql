-- The code repository. Rolls back; nothing here survives.
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

create or replace function pg_temp.files(variadic p text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', p[i], 'action', p[i + 1], 'content', p[i + 2])), '[]'::jsonb)
    from generate_series(1, array_length(p, 1), 3) i;
$$;

do $$
declare
  owner_id  uuid := gen_random_uuid();
  dev_id    uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider  uuid := gen_random_uuid();
  proj      public.general_projects%rowtype;
  repo      public.general_repos%rowtype;
  cmt       public.general_commits%rowtype;
  chg       public.general_repo_changes%rowtype;
  n         int;
  txt       text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Repo', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'repo-owner@test.local', 'Owner'),
                 (dev_id, 'repo-dev@test.local', 'Dev'),
                 (member_id, 'repo-member@test.local', 'Member'),
                 (outsider, 'repo-out@test.local', 'Out')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Repo project', '');

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, dev_id, 'member'), (proj.id, member_id, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (proj.id, dev_id, 'edit_files', owner_id);

  ------------------------------------------------------------------ starting
  perform pg_temp.act_as(member_id);
  begin
    perform public.create_general_repo(proj.id, 'Mine');
    perform pg_temp.ok('a Member without edit_files cannot start a repository', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member without edit_files cannot start a repository', true);
  end;

  perform pg_temp.act_as(dev_id);
  repo := public.create_general_repo(proj.id, 'Capstone', 'The system itself');
  perform pg_temp.ok('a grant of edit_files starts a repository', repo.id is not null);
  perform pg_temp.ok('a new repository has no commits', repo.commit_count = 0);

  begin
    perform public.create_general_repo(proj.id, 'Second');
    perform pg_temp.ok('a project gets one repository', false);
  exception when unique_violation then
    perform pg_temp.ok('a project gets one repository', true);
  end;

  ------------------------------------------------------------------ committing
  cmt := public.commit_general_files(repo.id, 'First files', 0,
    pg_temp.files('src/app.ts', 'added', 'export const app = 1',
                  'README.md', 'added', '# Capstone'));
  perform pg_temp.ok('the first commit is number 1', cmt.seq = 1);

  select count(*) into n from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('the tree shows both files', n = 2);

  select content into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'src/app.ts';
  perform pg_temp.ok('a file reads back what was committed', txt = 'export const app = 1');

  cmt := public.commit_general_files(repo.id, 'Changed the app', 1,
    pg_temp.files('src/app.ts', 'changed', 'export const app = 2'));
  perform pg_temp.ok('a second commit is number 2', cmt.seq = 2);

  select content into txt from public.general_repo_tree
   where repo_id = repo.id and path = 'src/app.ts';
  perform pg_temp.ok('the tree shows the newest content', txt = 'export const app = 2');

  select count(*) into n from public.general_blobs
   where repo_id = repo.id and path = 'src/app.ts';
  perform pg_temp.ok('both versions of the file are still in the history', n = 2);

  ------------------------------------------------------------------ removing
  cmt := public.commit_general_files(repo.id, 'Dropped the readme', 2,
    pg_temp.files('README.md', 'removed', ''));
  select count(*) into n from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('a removed file leaves the tree', n = 1);

  select count(*) into n from public.general_blobs
   where repo_id = repo.id and path = 'README.md';
  perform pg_temp.ok('a removed file is still in the history', n = 2);

  begin
    perform public.commit_general_files(repo.id, 'Change a ghost', 3,
      pg_temp.files('README.md', 'changed', 'back'));
    perform pg_temp.ok('a file that is gone cannot be changed', false);
  exception when no_data_found then
    perform pg_temp.ok('a file that is gone cannot be changed', true);
  end;

  -- A control: it can be added again.
  cmt := public.commit_general_files(repo.id, 'Brought the readme back', 3,
    pg_temp.files('README.md', 'added', '# Capstone, again'));
  perform pg_temp.ok('a removed file can be added again', cmt.seq = 4);

  begin
    perform public.commit_general_files(repo.id, 'Add it twice', 4,
      pg_temp.files('README.md', 'added', 'dupe'));
    perform pg_temp.ok('a file that exists cannot be added', false);
  exception when unique_violation then
    perform pg_temp.ok('a file that exists cannot be added', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Same file twice', 4,
      pg_temp.files('src/app.ts', 'changed', 'a', 'src/app.ts', 'changed', 'b'));
    perform pg_temp.ok('one commit cannot carry the same path twice', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('one commit cannot carry the same path twice', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Nothing at all', 4, '[]'::jsonb);
    perform pg_temp.ok('an empty commit is refused', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('an empty commit is refused', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Escape', 4,
      pg_temp.files('../../etc/passwd', 'added', 'x'));
    perform pg_temp.ok('a path cannot climb out of the repository', false);
  exception when check_violation then
    perform pg_temp.ok('a path cannot climb out of the repository', true);
  end;

  begin
    perform public.commit_general_files(repo.id, 'Absolute', 4,
      pg_temp.files('/etc/passwd', 'added', 'x'));
    perform pg_temp.ok('an absolute path is refused', false);
  exception when check_violation then
    perform pg_temp.ok('an absolute path is refused', true);
  end;

  ------------------------------------------------------- two people at once
  begin
    perform public.commit_general_files(repo.id, 'Working from an old copy', 2,
      pg_temp.files('src/app.ts', 'changed', 'stale'));
    perform pg_temp.ok('a commit against an older state is refused', false);
  exception when serialization_failure then
    perform pg_temp.ok('a commit against an older state is refused', true);
  end;

  ------------------------------------------------------------------ permissions
  perform pg_temp.act_as(member_id);
  begin
    perform public.commit_general_files(repo.id, 'Sneaky', 4,
      pg_temp.files('src/app.ts', 'changed', 'mine'));
    perform pg_temp.ok('a Member cannot commit straight to the repository', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member cannot commit straight to the repository', true);
  end;

  ------------------------------------------------------------------ history is a record
  perform pg_temp.act_as(owner_id);
  update public.general_commits set message = 'Rewritten' where repo_id = repo.id and seq = 1;
  select message into txt from public.general_commits where repo_id = repo.id and seq = 1;
  perform pg_temp.ok('an Owner cannot rewrite a commit message', txt = 'First files');

  delete from public.general_commits where repo_id = repo.id and seq = 1;
  select count(*) into n from public.general_commits where repo_id = repo.id and seq = 1;
  perform pg_temp.ok('an Owner cannot delete a commit', n = 1);

  update public.general_blobs set content = 'tampered' where repo_id = repo.id and seq = 1;
  select count(*) into n from public.general_blobs
   where repo_id = repo.id and content = 'tampered';
  perform pg_temp.ok('an Owner cannot rewrite a committed file', n = 0);

  ------------------------------------------------------------------ changes
  perform pg_temp.act_as(member_id);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, body, base_seq, files)
  values (repo.id, proj.id, member_id, 'Add the login screen', 'First pass.', 4,
          pg_temp.files('src/login.ts', 'added', 'export const login = true'))
  returning * into chg;
  perform pg_temp.ok('a Member who cannot commit can still open a change', chg.id is not null);

  begin
    insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files)
    values (repo.id, proj.id, owner_id, 'Not mine', 4, '[]'::jsonb);
    perform pg_temp.ok('a change cannot be opened in somebody else''s name', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a change cannot be opened in somebody else''s name', true);
  end;

  begin
    perform public.answer_general_repo_change(chg.id, true, '');
    perform pg_temp.ok('the author cannot merge their own change without edit_files', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('the author cannot merge their own change without edit_files', true);
  end;

  insert into public.general_repo_comments (change_id, project_id, author_id, path, body)
  values (chg.id, proj.id, member_id, 'src/login.ts', 'Should this be a class?');
  select count(*) into n from public.general_repo_comments where change_id = chg.id;
  perform pg_temp.ok('a comment can be left on one file of a change', n = 1);

  perform pg_temp.act_as(outsider);
  select count(*) into n from public.general_repo_tree where repo_id = repo.id;
  perform pg_temp.ok('a stranger sees no files', n = 0);
  select count(*) into n from public.general_repo_changes where id = chg.id;
  perform pg_temp.ok('a stranger sees no changes', n = 0);
  select count(*) into n from public.general_repo_comments where change_id = chg.id;
  perform pg_temp.ok('a stranger sees no comments', n = 0);

  ------------------------------------------------------------------ merging
  perform pg_temp.act_as(dev_id);
  chg := public.answer_general_repo_change(chg.id, true, 'Good.');
  perform pg_temp.ok('somebody with edit_files merges a change', chg.status = 'applied');

  select commit_count into n from public.general_repos where id = repo.id;
  perform pg_temp.ok('merging a change makes a commit', n = 5);

  select author_id::text into txt from public.general_commits where repo_id = repo.id and seq = 5;
  perform pg_temp.ok('the merge commit is credited to whoever opened the change',
                     txt = member_id::text);

  select count(*) into n from public.general_repo_tree
   where repo_id = repo.id and path = 'src/login.ts';
  perform pg_temp.ok('the merged file is in the tree', n = 1);

  insert into public.general_repo_changes
    (repo_id, project_id, author_id, reviewer_id, title, body, base_seq, files)
  values (repo.id, proj.id, dev_id, member_id, 'Add review handoff', '', 5,
          pg_temp.files('src/review.ts', 'added', 'export const review = true'))
  returning * into chg;

  begin
    perform public.answer_general_repo_change(chg.id, true, '');
    perform pg_temp.ok('authors with edit_files cannot merge their own assigned change', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('authors with edit_files cannot merge their own assigned change', true);
  end;

  perform pg_temp.act_as(member_id);
  chg := public.answer_general_repo_change(chg.id, true, 'Reviewed.');
  perform pg_temp.ok('the assigned reviewer can merge without edit_files', chg.status = 'applied');

  select count(*) into n from public.general_commits
   where repo_id = repo.id and seq = 6 and change_id = chg.id;
  perform pg_temp.ok('the commit points back at the change it came from', n = 1);

  begin
    perform public.answer_general_repo_change(chg.id, false, 'Changed my mind');
    perform pg_temp.ok('a change cannot be answered twice', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('a change cannot be answered twice', true);
  end;

  ------------------------------------------------------- a stale change is refused
  perform pg_temp.act_as(member_id);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files)
  values (repo.id, proj.id, member_id, 'Written against commit 5', 5,
          pg_temp.files('src/old.ts', 'added', 'stale'))
  returning * into chg;

  perform pg_temp.act_as(dev_id);
  begin
    perform public.answer_general_repo_change(chg.id, true, '');
    perform pg_temp.ok('a change written against an older commit cannot be merged', false);
  exception when serialization_failure then
    perform pg_temp.ok('a change written against an older commit cannot be merged', true);
  end;

  chg := public.answer_general_repo_change(chg.id, false, 'Rebase it onto commit 6.');
  perform pg_temp.ok('a stale change can still be declined', chg.status = 'declined');

  select commit_count into n from public.general_repos where id = repo.id;
  perform pg_temp.ok('declining makes no commit', n = 6);

  ------------------------------------------------------------------ withdrawing
  perform pg_temp.act_as(member_id);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files)
  values (repo.id, proj.id, member_id, 'Second thoughts', 6, '[]'::jsonb)
  returning * into chg;

  update public.general_repo_changes
     set status = 'withdrawn'::public.general_change_status where id = chg.id;
  select status::text into txt from public.general_repo_changes where id = chg.id;
  perform pg_temp.ok('an author withdraws their own change', txt = 'withdrawn');

  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files)
  values (repo.id, proj.id, member_id, 'Still open', 6, '[]'::jsonb)
  returning * into chg;

  perform pg_temp.act_as(owner_id);
  begin
    update public.general_repo_changes
       set status = 'withdrawn'::public.general_change_status where id = chg.id;
    select count(*) into n from public.general_repo_changes
     where id = chg.id and status = 'withdrawn';
    perform pg_temp.ok('an Owner cannot withdraw somebody else''s change', n = 0);
  exception when insufficient_privilege then
    perform pg_temp.ok('an Owner cannot withdraw somebody else''s change', true);
  end;

  begin
    update public.general_repo_changes
       set status = 'applied'::public.general_change_status where id = chg.id;
    perform pg_temp.ok('a change cannot be merged by a bare update', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a change cannot be merged by a bare update', true);
  end;

  ------------------------------------------------------------------ archived
  perform public.archive_general_project(proj.id, true);

  perform pg_temp.act_as(dev_id);
  begin
    perform public.commit_general_files(repo.id, 'After archiving', 6,
      pg_temp.files('src/app.ts', 'changed', 'x'));
    perform pg_temp.ok('an archived project takes no commits', false);
  exception when others then
    perform pg_temp.ok('an archived project takes no commits', true);
  end;

  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, false);

  ------------------------------------------------------- a deactivated account
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = dev_id;

  perform pg_temp.act_as(dev_id);
  begin
    perform public.commit_general_files(repo.id, 'From a dead account', 6,
      pg_temp.files('src/app.ts', 'changed', 'x'));
    perform pg_temp.ok('a deactivated account cannot commit', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a deactivated account cannot commit', true);
  end;

  -- A control: an active Owner still can.
  perform pg_temp.act_as(owner_id);
  cmt := public.commit_general_files(repo.id, 'From a live Owner', 6,
    pg_temp.files('src/app.ts', 'changed', 'still working'));
  perform pg_temp.ok('an active Owner still commits after that refusal', cmt.seq = 7);

  ------------------------------------------------------------------ the overview
  select file_count into n from public.general_repo_overview where id = repo.id;
  perform pg_temp.ok('the overview counts the files in the tree', n = 4);

  select open_change_count into n from public.general_repo_overview where id = repo.id;
  perform pg_temp.ok('the overview counts the one change still open', n = 1);

  perform pg_temp.act_as(outsider);
  select count(*) into n from public.general_repo_overview where id = repo.id;
  perform pg_temp.ok('the overview shows a stranger nothing', n = 0);
end $$;

rollback;
