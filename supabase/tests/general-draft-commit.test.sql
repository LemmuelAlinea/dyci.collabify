-- Committing a draft file or folder straight to Main. Rolls back.
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
  proj     public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  draft    public.general_drafts%rowtype;
  c        public.general_commits%rowtype;
  n        int;
  txt      text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Commit', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'dcommit-owner@test.local', 'Owner'),
                 (member, 'dcommit-member@test.local', 'Member')) as v(id, em, ln);
  update public.profiles set status = 'active' where created_at = now() and role = 'faculty' and status = 'pending';

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Draft commit project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'First', 0, jsonb_build_array(
    jsonb_build_object('path', 'docs/one.md', 'action', 'added', 'kind', 'text', 'content', 'One')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level) values (proj.id, member, 'member');

  ------------------------------------------------------------------ a file
  perform pg_temp.act_as(owner_id);
  draft := public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'docs/one.md', 'changed', 'text', 'One, edited');
  perform public.save_general_draft_file(repo.id, 'ch/a.md', 'added', 'text', 'A');
  perform public.save_general_draft_file(repo.id, 'ch/b.md', 'added', 'text', 'B');
  perform public.save_general_draft_file(repo.id, 'ch_x/c.md', 'added', 'text', 'C');

  c := public.commit_general_draft_path(repo.id, 'docs/one.md', false, '');
  perform pg_temp.ok('an Owner commits one draft file', c.seq = 2);
  select content into txt from public.general_repo_tree where repo_id = repo.id and path = 'docs/one.md';
  perform pg_temp.ok('...and Main has the edit', txt = 'One, edited');
  perform pg_temp.ok('...with a default message', c.message = 'Committed docs/one.md');
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'docs/one.md';
  perform pg_temp.ok('...and it leaves the draft', n = 0);
  select base_seq into n from public.general_drafts where id = draft.id;
  perform pg_temp.ok('...and the draft stays up to date', n = 2);

  ------------------------------------------------------------------ a folder
  c := public.commit_general_draft_path(repo.id, 'ch', true, '');
  select count(*) into n from public.general_blobs where commit_id = c.id;
  perform pg_temp.ok('a folder commits every file under it', n = 2);
  select count(*) into n from public.general_draft_files where draft_id = draft.id and path = 'ch_x/c.md';
  perform pg_temp.ok('...and a lookalike folder stays in the draft', n = 1);

  ------------------------------------------------------------------ refusals
  begin
    perform public.commit_general_draft_path(repo.id, 'nowhere.md', false, '');
    perform pg_temp.ok('a path not in the draft is refused', false);
  exception when no_data_found then
    perform pg_temp.ok('a path not in the draft is refused', true);
  end;

  perform pg_temp.act_as(member);
  perform public.my_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'mine.md', 'added', 'text', 'M');
  begin
    perform public.commit_general_draft_path(repo.id, 'mine.md', false, '');
    perform pg_temp.ok('a Member without edit_files cannot commit', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('a Member without edit_files cannot commit', true);
  end;
  select count(*) into n from public.general_draft_files f
    join public.general_drafts d on d.id = f.draft_id
   where d.user_id = member and f.path = 'mine.md';
  perform pg_temp.ok('...and their draft keeps the file', n = 1);

  perform pg_temp.act_as(owner_id);
  perform public.save_general_draft_file(repo.id, 'late.md', 'added', 'text', 'L');
  perform public.commit_general_files(repo.id, 'Someone else', 3, jsonb_build_array(
    jsonb_build_object('path', 'other.md', 'action', 'added', 'kind', 'text', 'content', 'O')));
  begin
    perform public.commit_general_draft_path(repo.id, 'late.md', false, '');
    perform pg_temp.ok('a draft behind Main is refused', false);
  exception when serialization_failure then
    perform pg_temp.ok('a draft behind Main is refused', true);
  end;
end $$;

rollback;
