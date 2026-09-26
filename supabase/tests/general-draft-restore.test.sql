-- Bringing a declined or withdrawn request back into My draft. Rolls back.
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
  proj      public.general_projects%rowtype;
  repo      public.general_repos%rowtype;
  draft     public.general_drafts%rowtype;
  chg       public.general_repo_changes%rowtype;
  gone      public.general_repo_changes%rowtype;
  n         int;
  txt       text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Restore', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'restore-owner@test.local', 'Owner'),
                 (member_id, 'restore-member@test.local', 'Member'),
                 (other_id, 'restore-other@test.local', 'Other')) as v(id, em, ln);
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Restore project', '');
  repo := public.create_general_repo(proj.id, 'Files');
  perform public.commit_general_files(repo.id, 'The first files', 0, jsonb_build_array(
    jsonb_build_object('path', 'docs/intro.md', 'action', 'added', 'kind', 'text', 'content', 'Intro'),
    jsonb_build_object('path', 'notes.md', 'action', 'added', 'kind', 'text', 'content', 'Notes')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, member_id, 'member'), (proj.id, other_id, 'member');

  -------------------------------------------------- a request, declined
  perform pg_temp.act_as(member_id);
  perform public.save_general_draft_file(repo.id, 'docs/intro.md', 'changed', 'text', 'Intro, reworked');
  perform public.save_general_draft_file(repo.id, 'docs/methods.md', 'added', 'text', 'Methods');
  perform public.save_general_draft_file(repo.id, 'notes.md', 'changed', 'text', 'Notes, reworked');
  chg := public.submit_general_draft(repo.id, 'Rework the docs', '', owner_id);

  -- Refused while it is still open.
  begin
    perform public.restore_general_repo_change(chg.id);
    perform pg_temp.ok('an open request cannot be brought back', false);
  exception when invalid_parameter_value then
    perform pg_temp.ok('an open request cannot be brought back', true);
  end;

  perform pg_temp.act_as(owner_id);
  chg := public.answer_general_repo_change(chg.id, false, 'Not yet.');

  -- Only the author can bring it back.
  perform pg_temp.act_as(other_id);
  begin
    perform public.restore_general_repo_change(chg.id);
    perform pg_temp.ok('somebody else cannot bring back your request', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('somebody else cannot bring back your request', true);
  end;

  -------------------------------------------------- one file, then a folder
  perform pg_temp.act_as(member_id);
  n := public.restore_general_repo_change(chg.id, 'notes.md');
  perform pg_temp.ok('one file comes back by itself', n = 1);

  draft := public.my_general_draft(repo.id);
  select content into txt from public.general_draft_files
   where draft_id = draft.id and path = 'notes.md';
  perform pg_temp.ok('it comes back with what the request said', txt = 'Notes, reworked');

  n := public.restore_general_repo_change(chg.id, 'docs');
  perform pg_temp.ok('a folder brings back everything under it', n = 2);

  select count(*) into n from public.general_draft_files where draft_id = draft.id;
  perform pg_temp.ok('the draft now holds the whole request', n = 3);

  -------------------------------------------------- nothing is replaced
  begin
    perform public.restore_general_repo_change(chg.id);
    perform pg_temp.ok('a clash with the draft stops the restore', false);
  exception when unique_violation then
    get stacked diagnostics txt = message_text;
    perform pg_temp.ok('a clash with the draft stops the restore', true);
    perform pg_temp.ok('and names the clashing paths', txt like '%docs/intro.md%');
  end;

  -------------------------------------------------- whole request, empty draft
  perform public.discard_general_draft(repo.id);
  perform pg_temp.act_as(owner_id);
  perform public.commit_general_files(repo.id, 'Owner edits notes', 1, jsonb_build_array(
    jsonb_build_object('path', 'notes.md', 'action', 'changed', 'kind', 'text', 'content', 'Owner notes')));

  perform pg_temp.act_as(member_id);
  n := public.restore_general_repo_change(chg.id);
  perform pg_temp.ok('the whole request comes back at once', n = 3);

  draft := public.my_general_draft(repo.id);
  perform pg_temp.ok('an empty draft takes the request''s starting commit', draft.base_seq = chg.base_seq);

  select count(*) into n from public.general_draft_conflicts(repo.id);
  perform pg_temp.ok('and is told what Main changed underneath it', n = 1);

  -------------------------------------------------- Main moved past a busy draft
  perform public.discard_general_draft(repo.id);
  perform public.sync_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'other.md', 'added', 'text', 'Unrelated');
  begin
    perform public.restore_general_repo_change(chg.id, 'notes.md');
    perform pg_temp.ok('a path Main changed since cannot land in a newer draft', false);
  exception when serialization_failure then
    perform pg_temp.ok('a path Main changed since cannot land in a newer draft', true);
  end;

  n := public.restore_general_repo_change(chg.id, 'docs/methods.md');
  perform pg_temp.ok('a path Main left alone still can', n = 1);

  -------------------------------------------------- withdrawn works too
  perform public.discard_general_draft(repo.id);
  perform public.sync_general_draft(repo.id);
  perform public.save_general_draft_file(repo.id, 'late.md', 'added', 'text', 'Late');
  gone := public.submit_general_draft(repo.id, 'Late idea', '', owner_id);
  update public.general_repo_changes set status = 'withdrawn' where id = gone.id;
  n := public.restore_general_repo_change(gone.id);
  perform pg_temp.ok('a withdrawn request comes back too', n = 1);

  -------------------------------------------------- archived project
  perform public.discard_general_draft(repo.id);
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, true);
  perform pg_temp.act_as(member_id);
  begin
    perform public.restore_general_repo_change(chg.id);
    perform pg_temp.ok('nothing comes back in an archived project', false);
  exception when insufficient_privilege then
    perform pg_temp.ok('nothing comes back in an archived project', true);
  end;
end $$;

rollback;
