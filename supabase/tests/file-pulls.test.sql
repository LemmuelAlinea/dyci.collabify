-- supabase/tests/file-pulls.test.sql
-- Word file pulls and copy bases: who pulls, what a pull records, the base an
-- uploaded copy carries, and the push from a stale copy that every way into
-- Main refuses. Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/file-pulls.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/** A fresh uploaded object in the project's files. */
create or replace function pg_temp.upload(p_project uuid) returns text
language sql as $$
  select p_project::text || '/files/' || gen_random_uuid()::text || '.docx';
$$;

/** The one file a push carries: a Word file is binary, anything else text. */
create or replace function pg_temp.file(p_project uuid, p_path text, p_action text, p_storage text default null)
returns jsonb
language sql as $$
  select jsonb_build_object(
    'path', p_path, 'action', p_action,
    'kind', case when p_path ~ '\.docx$' then 'binary' else 'text' end,
    'content', case when p_path ~ '\.docx$' then '' else 'Zz ' || p_action end,
    'storage_path', case when p_path ~ '\.docx$'
                         then coalesce(p_storage, pg_temp.upload(p_project)) end);
$$;

/** Commits one file to Main as the caller (the given upload, or a fresh one); returns the new commit's seq. */
create or replace function pg_temp.push(p_repo uuid, p_project uuid, p_path text, p_action text, p_storage text default null)
returns int language plpgsql as $$
declare
  n int;
begin
  select commit_count into n from public.general_repos where id = p_repo;
  return (public.commit_general_files(p_repo, 'Zz ' || p_action || ' ' || p_path, n,
    jsonb_build_array(pg_temp.file(p_project, p_path, p_action, p_storage)))).seq;
end;
$$;

do $$
declare
  v_ana   uuid := gen_random_uuid();  -- the project manager
  v_ben   uuid := gen_random_uuid();  -- a member
  v_sam   uuid := gen_random_uuid();  -- a stakeholder
  v_space uuid;
  v_proj  uuid;
  v_other uuid;                       -- another project ana runs
  v_repo  uuid;
  v_chg   uuid;
  v_seq   int;
  v_copy  text;                       -- an uploaded copy with a base on record
  v_bens  text;
  n       int;
  st      record;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_ana), (v_ben), (v_sam)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_ana, v_ana::text || '@test.invalid', 'Zz', 'Pull ana', 'member', 'active', false, true),
         (v_ben, v_ben::text || '@test.invalid', 'Zz', 'Pull ben', 'member', 'active', false, false),
         (v_sam, v_sam::text || '@test.invalid', 'Zz', 'Pull sam', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_ana);
  v_space := (public.create_general_space('Zz Pull space', '')).id;
  v_proj := (public.create_general_project('Zz Pull project', '', null, null, null, null, v_space)).id;
  v_other := (public.create_general_project('Zz Pull other', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, role) values
    (v_space, v_ben, 'member'), (v_space, v_sam, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (v_proj, v_ben, 'member'), (v_proj, v_sam, 'stakeholder');
  select id into v_repo from public.general_repos where project_id = v_proj;

  perform pg_temp.act_as(v_ana);
  if v_repo is null then
    v_repo := (public.create_general_repo(v_proj, 'Files', '')).id;
  end if;
  v_seq := (public.commit_general_files(v_repo, 'Zz first', 0, jsonb_build_array(
    pg_temp.file(v_proj, 'chap.docx', 'added'),
    pg_temp.file(v_proj, 'Thesis/two.docx', 'added'),
    pg_temp.file(v_proj, 'notes.txt', 'added')))).seq;
  perform pg_temp.must_be('chap.docx is in Main at seq 1 as binary', v_seq = 1
    and (select kind = 'binary' from public.general_blobs where repo_id = v_repo and path = 'chap.docx'));
  perform pg_temp.must_be('...and Main''s seq for it reads 1', public.general_main_seq(v_repo, 'chap.docx') = 1);
  perform pg_temp.must_be('...or 0 below it', public.general_main_seq(v_repo, 'chap.docx', 1) = 0);

  ------------------------------------------------------------ 1. pulling
  perform pg_temp.must_be('ana pulls from Main at base 1',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 1);
  perform pg_temp.must_be('...and reads her pull',
    exists (select 1 from public.general_file_pulls
             where repo_id = v_repo and path = 'chap.docx' and user_id = v_ana and base_seq = 1));
  perform pg_temp.must_refuse_with('nobody writes a pull directly',
    format($q$insert into public.general_file_pulls (repo_id, project_id, path, user_id, base_seq)
              values (%L, %L, 'notes.txt', %L, 1)$q$, v_repo, v_proj, v_ana), 'denied');

  perform pg_temp.must_refuse_with('pulling a file that is not Word is refused',
    format($q$select public.pull_general_file(%L, 'notes.txt', true)$q$, v_repo), 'Word');
  perform pg_temp.must_refuse_with('pulling a Word file that is not in Main is refused',
    format($q$select public.pull_general_file(%L, 'missing.docx', true)$q$, v_repo), 'not in Main yet');

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_refuse_with('a stakeholder cannot pull',
    format($q$select public.pull_general_file(%L, 'chap.docx', true)$q$, v_repo), 'Stakeholders');

  ------------------------------------------------------------ 2. a push from the pulled copy
  perform pg_temp.act_as(v_ben);
  perform public.pull_general_file(v_repo, 'chap.docx', true);
  v_bens := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'chap.docx', v_bens, 1);
  perform pg_temp.must_be('ben records his upload''s base at 1',
    exists (select 1 from public.general_file_bases
             where storage_path = v_bens and base_seq = 1 and user_id = v_ben and path = 'chap.docx'));
  perform pg_temp.must_be('ben pushes chap.docx at seq 2 from his copy at 1',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed', v_bens) = 2);
  perform pg_temp.must_be('...and his pull ends with the push',
    not exists (select 1 from public.general_file_pulls
                 where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));

  ------------------------------------------------------------ 3. a push from a stale copy
  perform pg_temp.act_as(v_ana);
  select * into st from public.general_file_push_state(v_repo, 'chap.docx');
  perform pg_temp.must_be('ana''s push state names the newer version and ben',
    st.base_seq = 1 and st.main_seq = 2 and st.main_author = v_ben and not st.main_removed
    and st.main_at is not null);

  v_copy := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'chap.docx', v_copy, 1);
  select * into st from public.general_file_base_state(v_copy);
  perform pg_temp.must_be('the copy''s base state names its base 1, Main at 2 and ben',
    st.base_seq = 1 and st.main_seq = 2 and st.main_author = v_ben and not st.main_removed);
  perform pg_temp.must_refuse_with('ana''s commit of her copy made at 1 is held',
    format($q$select pg_temp.push(%L, %L, 'chap.docx', 'changed', %L)$q$, v_repo, v_proj, v_copy),
    'Main has a newer version of chap.docx than the copy this was made from');
  perform pg_temp.must_be('...and nothing landed', public.general_main_seq(v_repo, 'chap.docx') = 2);

  perform pg_temp.must_be('getting the newer version moves her pull to base 2',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 2);
  perform pg_temp.must_refuse_with('...which does not lift the hold on the copy',
    format($q$select pg_temp.push(%L, %L, 'chap.docx', 'changed', %L)$q$, v_repo, v_proj, v_copy),
    'Main has a newer version of');
  perform public.end_general_file_pull(v_repo, 'chap.docx');
  perform pg_temp.must_refuse_with('...nor does ending the pull',
    format($q$select pg_temp.push(%L, %L, 'chap.docx', 'changed', %L)$q$, v_repo, v_proj, v_copy),
    'Main has a newer version of');

  perform public.save_general_draft_file(v_repo, 'chap.docx', 'changed', 'binary', '', v_copy);
  perform pg_temp.must_refuse_with('committing the copy from her draft is held',
    format($q$select public.commit_general_draft_path(%L, 'chap.docx', false)$q$, v_repo),
    'Main has a newer version of chap.docx');
  perform pg_temp.must_be('...and Main stays at 2', public.general_main_seq(v_repo, 'chap.docx') = 2);

  perform public.record_general_file_base(v_repo, 'chap.docx', v_copy, 2);
  perform pg_temp.must_be('recording base 2 (Replace anyway) lets the draft commit through at seq 3',
    (public.commit_general_draft_path(v_repo, 'chap.docx', false)).seq = 3);

  ------------------------------------------------------------ 4. who records a base
  perform pg_temp.must_be('a binary upload with no base on record passes at seq 4',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 4);
  perform pg_temp.must_be('...even with ana''s own old pull live: the pull no longer holds anything',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 4);
  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_be('...as ben moves Main to 5',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 5);
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('...and ana''s next unbased push lands at 6',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 6);

  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_refuse_with('ben cannot overwrite the base of ana''s copy',
    format($q$select public.record_general_file_base(%L, 'chap.docx', %L, 6)$q$, v_repo, v_copy),
    'only they can change');
  perform pg_temp.must_be('...which keeps base 2',
    (select base_seq = 2 and user_id = v_ana from public.general_file_bases where storage_path = v_copy));
  perform pg_temp.must_refuse_with('nobody writes a base directly',
    format($q$insert into public.general_file_bases (storage_path, repo_id, project_id, path, base_seq)
              values (%L, %L, %L, 'chap.docx', 6)$q$, pg_temp.upload(v_proj), v_repo, v_proj), 'denied');
  perform pg_temp.must_refuse_with('a base is only for a Word file',
    format($q$select public.record_general_file_base(%L, 'notes.txt', %L, 1)$q$, v_repo, pg_temp.upload(v_proj)), 'Word');
  perform pg_temp.must_refuse_with('a base is only for one of this project''s files',
    format($q$select public.record_general_file_base(%L, 'chap.docx', %L, 1)$q$, v_repo, pg_temp.upload(v_other)),
    'not one of this project');
  perform pg_temp.must_refuse_with('a base is a version Main has had',
    format($q$select public.record_general_file_base(%L, 'chap.docx', %L, 99)$q$, v_repo, pg_temp.upload(v_proj)),
    'not in Main');

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_refuse_with('a stakeholder cannot record a base',
    format($q$select public.record_general_file_base(%L, 'chap.docx', %L, 1)$q$, v_repo, pg_temp.upload(v_proj)),
    'Stakeholders');
  perform pg_temp.must_be('...but reads the bases of the project',
    exists (select 1 from public.general_file_bases where storage_path = v_copy));

  ------------------------------------------------------------ 5. a removal in Main
  perform pg_temp.act_as(v_ana);
  v_copy := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'chap.docx', v_copy, 6);
  perform pg_temp.must_be('ana pulls the new version at base 6',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 6);
  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_be('ben removes chap.docx at seq 7',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'removed') = 7);
  perform pg_temp.act_as(v_ana);
  select * into st from public.general_file_push_state(v_repo, 'chap.docx');
  perform pg_temp.must_be('ana''s push state shows it removed, by ben',
    st.base_seq = 6 and st.main_seq = 7 and st.main_removed and st.main_author = v_ben);
  select * into st from public.general_file_base_state(v_copy);
  perform pg_temp.must_be('...and so does her copy''s base state',
    st.base_seq = 6 and st.main_seq = 7 and st.main_removed and st.main_author = v_ben);
  perform pg_temp.must_refuse_with('a removed file cannot be pulled',
    format($q$select public.pull_general_file(%L, 'chap.docx', true)$q$, v_repo), 'not in Main yet');
  perform pg_temp.must_refuse_with('putting her copy back from base 6 is held',
    format($q$select pg_temp.push(%L, %L, 'chap.docx', 'added', %L)$q$, v_repo, v_proj, v_copy),
    'Main has a newer version of');
  perform public.record_general_file_base(v_repo, 'chap.docx', v_copy, 7);
  perform pg_temp.must_be('...until she replaces it knowingly, at seq 8',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'added', v_copy) = 8);

  ------------------------------------------------------------ 6. a pull older than 7 days
  perform public.pull_general_file(v_repo, 'chap.docx', true);
  perform pg_temp.act_as_service();
  update public.general_file_pulls set pulled_at = now() - interval '8 days'
   where repo_id = v_repo and path = 'chap.docx' and user_id = v_ana;
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('an 8-day-old pull is not read from the table',
    not exists (select 1 from public.general_file_pulls where repo_id = v_repo and path = 'chap.docx'));
  perform pg_temp.must_be('...nor in push state',
    not exists (select 1 from public.general_file_push_state(v_repo, 'chap.docx')));
  perform pg_temp.must_be('...and ana pushes at seq 9',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 9);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...which ends the old row too',
    not exists (select 1 from public.general_file_pulls
                 where repo_id = v_repo and path = 'chap.docx' and user_id = v_ana));

  ------------------------------------------------------------ 7. the merge path
  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_be('ben pulls at base 9',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 9);
  v_bens := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'chap.docx', v_bens, 9);
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('ana pushes seq 10',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 10);
  perform pg_temp.act_as(v_ben);
  perform public.save_general_draft_file(v_repo, 'chap.docx', 'changed', 'binary', '', v_bens);
  v_chg := (public.submit_general_draft_file(v_repo, 'chap.docx', 'Zz ben''s chapter', '', v_ana)).id;
  perform pg_temp.must_be('ben''s change is written against seq 10',
    (select base_seq = 10 from public.general_repo_changes where id = v_chg));
  perform public.end_general_file_pull(v_repo, 'chap.docx');
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_refuse_with('merging ben''s change of a copy made at 9 is held, his pull ended or not',
    format($q$select public.answer_general_repo_change(%L, true, '')$q$, v_chg),
    'Main has a newer version of chap.docx than the copy this was made from');
  perform pg_temp.must_be('...the change stays open and Main stays at 10',
    (select status = 'open' from public.general_repo_changes where id = v_chg)
    and public.general_main_seq(v_repo, 'chap.docx') = 10);

  ------------------------------------------------------------ 8. heads-up and ending a pull
  perform pg_temp.act_as(v_ben);
  perform public.pull_general_file(v_repo, 'chap.docx', false);
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('ana pulls at base 10', (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 10);
  perform pg_temp.must_be('ana reads ben''s pull as a heads-up',
    exists (select 1 from public.general_file_pulls
             where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));
  select * into st from public.general_file_push_state(v_repo, 'chap.docx', v_ben);
  perform pg_temp.must_be('...and his push state', st.base_seq = 10 and st.main_seq = 10);
  perform public.end_general_file_pull(v_repo, 'chap.docx');
  select count(*) into n from public.general_file_pulls where repo_id = v_repo and path = 'chap.docx';
  perform pg_temp.must_be('ending a pull removes only ana''s own',
    n = 1 and exists (select 1 from public.general_file_pulls
                       where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_be('a stakeholder reads the heads-up too',
    exists (select 1 from public.general_file_pulls where repo_id = v_repo and user_id = v_ben));

  ------------------------------------------------------------ 9. a folder that carries a held copy
  perform pg_temp.act_as(v_ana);
  perform public.discard_general_draft(v_repo);
  v_copy := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'Thesis/two.docx', v_copy, 0);
  perform public.save_general_draft_file(v_repo, 'Thesis/two.docx', 'changed', 'binary', '', v_copy);
  perform pg_temp.must_refuse_with('committing the folder that carries a copy made before Main''s version is held',
    format($q$select public.commit_general_draft_path(%L, 'Thesis', true)$q$, v_repo),
    'Main has a newer version of Thesis/two.docx');
  perform pg_temp.must_be('...and Main stays at 1 for it', public.general_main_seq(v_repo, 'Thesis/two.docx') = 1);
  perform public.record_general_file_base(v_repo, 'Thesis/two.docx', v_copy, 1);
  perform pg_temp.must_be('...until the copy''s base is Main''s version, at seq 11',
    (public.commit_general_draft_path(v_repo, 'Thesis', true)).seq = 11);

  ------------------------------------------------------------ 10. anon
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform pg_temp.must_refuse_with('anon cannot record a base',
    format($q$select public.record_general_file_base(%L, 'chap.docx', %L, 1)$q$, v_repo, pg_temp.upload(v_proj)),
    'permission denied');
  perform pg_temp.must_refuse_with('...nor read a copy''s base state',
    format($q$select * from public.general_file_base_state(%L)$q$, v_copy), 'permission denied');
  perform pg_temp.must_refuse_with('...nor read the bases',
    'select count(*) from public.general_file_bases', 'permission denied');
end;
$$;

rollback;
