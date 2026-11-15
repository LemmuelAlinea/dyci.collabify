-- supabase/tests/file-pulls.test.sql
-- Word file pulls: who pulls, what a pull records, and the push from a stale
-- copy that every way into Main refuses. Rolls back; nothing survives.
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

/** The one file a push carries: a Word file is binary, anything else text. */
create or replace function pg_temp.file(p_project uuid, p_path text, p_action text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'path', p_path, 'action', p_action,
    'kind', case when p_path ~ '\.docx$' then 'binary' else 'text' end,
    'content', case when p_path ~ '\.docx$' then '' else 'Zz ' || p_action end,
    'storage_path', case when p_path ~ '\.docx$'
                         then p_project::text || '/files/' || gen_random_uuid()::text || '.docx' end);
$$;

/** Commits one file to Main as the caller; returns the new commit's seq. */
create or replace function pg_temp.push(p_repo uuid, p_project uuid, p_path text, p_action text)
returns int language plpgsql as $$
declare
  n int;
begin
  select commit_count into n from public.general_repos where id = p_repo;
  return (public.commit_general_files(p_repo, 'Zz ' || p_action || ' ' || p_path, n,
    jsonb_build_array(pg_temp.file(p_project, p_path, p_action)))).seq;
end;
$$;

do $$
declare
  v_ana   uuid := gen_random_uuid();  -- the project manager
  v_ben   uuid := gen_random_uuid();  -- a member
  v_sam   uuid := gen_random_uuid();  -- a stakeholder
  v_space uuid;
  v_proj  uuid;
  v_repo  uuid;
  v_chg   uuid;
  v_seq   int;
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
  perform pg_temp.must_be('ben pushes chap.docx at seq 2 from his pull at 1',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 2);
  perform pg_temp.must_be('...and his pull ends with the push',
    not exists (select 1 from public.general_file_pulls
                 where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));

  ------------------------------------------------------------ 3. a push from a stale copy
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_refuse_with('ana''s push from her copy at 1 is held',
    format($q$select pg_temp.push(%L, %L, 'chap.docx', 'changed')$q$, v_repo, v_proj),
    'Main has a newer version of chap.docx than the copy this was made from');
  perform pg_temp.must_be('...and nothing landed', public.general_main_seq(v_repo, 'chap.docx') = 2);
  select * into st from public.general_file_push_state(v_repo, 'chap.docx');
  perform pg_temp.must_be('push state names the newer version and ben',
    st.base_seq = 1 and st.main_seq = 2 and st.main_author = v_ben and not st.main_removed
    and st.main_at is not null);

  perform pg_temp.must_be('pulling again without Main keeps base 1',
    (public.pull_general_file(v_repo, 'chap.docx', false)).base_seq = 1);
  perform pg_temp.must_be('getting the newer version moves base to 2',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 2);
  perform pg_temp.must_be('...and ana''s push then goes through at seq 3',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 3);

  ------------------------------------------------------------ 4. a removal in Main
  perform pg_temp.must_be('ana pulls the new version at base 3',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 3);
  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_be('ben removes chap.docx at seq 4',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'removed') = 4);
  perform pg_temp.act_as(v_ana);
  select * into st from public.general_file_push_state(v_repo, 'chap.docx');
  perform pg_temp.must_be('ana''s push state shows it removed, by ben',
    st.base_seq = 3 and st.main_seq = 4 and st.main_removed and st.main_author = v_ben);
  perform pg_temp.must_refuse_with('a removed file cannot be pulled',
    format($q$select public.pull_general_file(%L, 'chap.docx', true)$q$, v_repo), 'not in Main yet');

  ------------------------------------------------------------ 5. a pull older than 7 days
  perform pg_temp.act_as_service();
  update public.general_file_pulls set pulled_at = now() - interval '8 days'
   where repo_id = v_repo and path = 'chap.docx' and user_id = v_ana;
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('an 8-day-old pull is not read from the table',
    not exists (select 1 from public.general_file_pulls where repo_id = v_repo and path = 'chap.docx'));
  perform pg_temp.must_be('...nor in push state',
    not exists (select 1 from public.general_file_push_state(v_repo, 'chap.docx')));
  perform pg_temp.must_be('...and does not hold ana''s push at seq 5',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'added') = 5);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...which ends the old row too',
    not exists (select 1 from public.general_file_pulls
                 where repo_id = v_repo and path = 'chap.docx' and user_id = v_ana));

  ------------------------------------------------------------ 6. the merge path
  perform pg_temp.act_as(v_ben);
  perform pg_temp.must_be('ben pulls at base 5',
    (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 5);
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('ana pushes seq 6 with no pull of her own',
    pg_temp.push(v_repo, v_proj, 'chap.docx', 'changed') = 6);
  perform pg_temp.act_as(v_ben);
  perform public.save_general_draft_file(v_repo, 'chap.docx', 'changed', 'binary', '',
    v_proj::text || '/files/' || gen_random_uuid()::text || '.docx');
  v_chg := (public.submit_general_draft_file(v_repo, 'chap.docx', 'Zz ben''s chapter', '', v_ana)).id;
  perform pg_temp.must_be('ben''s change is written against seq 6',
    (select base_seq = 6 from public.general_repo_changes where id = v_chg));
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_refuse_with('merging ben''s change from his stale pull is held',
    format($q$select public.answer_general_repo_change(%L, true, '')$q$, v_chg),
    'Main has a newer version of chap.docx than the copy this was made from');
  perform pg_temp.must_be('...the change stays open and Main stays at 6',
    (select status = 'open' from public.general_repo_changes where id = v_chg)
    and public.general_main_seq(v_repo, 'chap.docx') = 6);

  ------------------------------------------------------------ 7. heads-up and ending a pull
  perform pg_temp.must_be('ana pulls at base 6', (public.pull_general_file(v_repo, 'chap.docx', true)).base_seq = 6);
  perform pg_temp.must_be('ana reads ben''s pull as a heads-up',
    exists (select 1 from public.general_file_pulls
             where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));
  select * into st from public.general_file_push_state(v_repo, 'chap.docx', v_ben);
  perform pg_temp.must_be('...and his push state', st.base_seq = 5 and st.main_seq = 6);
  perform public.end_general_file_pull(v_repo, 'chap.docx');
  select count(*) into n from public.general_file_pulls where repo_id = v_repo and path = 'chap.docx';
  perform pg_temp.must_be('ending a pull removes only ana''s own',
    n = 1 and exists (select 1 from public.general_file_pulls
                       where repo_id = v_repo and path = 'chap.docx' and user_id = v_ben));

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_be('a stakeholder reads the heads-up too',
    exists (select 1 from public.general_file_pulls where repo_id = v_repo and user_id = v_ben));
end;
$$;

rollback;
