-- supabase/tests/file-history.test.sql
-- Revert a commit, undo one file's change and restore a file to an earlier
-- version: what each writes into Main, the origin rows, what each refuses, and
-- the upload check letting a version Main already had back in during a revert
-- or restore only, while a stale copy (that same old object pushed any other
-- way included) stays held. Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/file-history.test.sql
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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 90);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/**
 * A fresh object in the project's files, uploaded by whoever the test is
 * acting as (its storage owner), written as the service role.
 */
create or replace function pg_temp.upload(p_project uuid, p_ext text default 'docx') returns text
language plpgsql as $$
declare
  v_role   text := current_setting('role');
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v_owner  uuid := nullif(nullif(v_claims, '')::json ->> 'sub', '')::uuid;
  v_name   text := p_project::text || '/files/' || gen_random_uuid()::text || '.' || p_ext;
begin
  perform set_config('role', 'none', true);
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values ('general-files', v_name, v_owner, v_owner::text);
  perform set_config('role', v_role, true);
  return v_name;
end;
$$;

/** One text file of a commit. */
create or replace function pg_temp.txt(p_path text, p_action text, p_content text default '')
returns jsonb language sql as $$
  select jsonb_build_object('path', p_path, 'action', p_action, 'kind', 'text', 'content', p_content);
$$;

/** One binary file of a commit, carrying the given uploaded object. */
create or replace function pg_temp.bin(p_path text, p_action text, p_storage text)
returns jsonb language sql as $$
  select jsonb_build_object('path', p_path, 'action', p_action, 'kind', 'binary',
                            'content', '', 'storage_path', p_storage);
$$;

/** The repository's current commit count, the base a caller has loaded. */
create or replace function pg_temp.base(p_repo uuid) returns int
language sql as $$
  select commit_count from public.general_repos where id = p_repo;
$$;

/** Commits the given files to Main as the caller; returns the new commit. */
create or replace function pg_temp.push(p_repo uuid, p_message text, p_files jsonb)
returns public.general_commits language sql as $$
  select public.commit_general_files(p_repo, p_message, pg_temp.base(p_repo), p_files);
$$;

/** The blob a commit wrote for a path. */
create or replace function pg_temp.blob(p_commit uuid, p_path text)
returns public.general_blobs language sql as $$
  select * from public.general_blobs where commit_id = p_commit and path = p_path;
$$;

do $$
declare
  v_ana   uuid := gen_random_uuid();  -- the project manager (commit_main)
  v_qin   uuid := gen_random_uuid();  -- QA: on the project, without commit_main
  v_sam   uuid := gen_random_uuid();  -- a stakeholder
  v_out   uuid := gen_random_uuid();  -- not on the project
  v_space uuid;
  v_proj  uuid;
  v_repo  uuid;
  c1      public.general_commits%rowtype;
  c2      public.general_commits%rowtype;
  c3      public.general_commits%rowtype;
  c4      public.general_commits%rowtype;
  c5      public.general_commits%rowtype;
  cn      public.general_commits%rowtype;  -- a commit under test
  cr      public.general_commits%rowtype;  -- what a revert or restore wrote
  v_x     text;                            -- c.docx's object at #4
  v_y     text;                            -- c.docx's object at #5
  v_g     text;
  v_w     text;
  b       public.general_blobs%rowtype;
  o       public.general_commit_origins%rowtype;
  n       int;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_ana), (v_qin), (v_sam), (v_out)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_ana, v_ana::text || '@test.invalid', 'Zz', 'History ana', 'member', 'active', false, true),
         (v_qin, v_qin::text || '@test.invalid', 'Zz', 'History qin', 'member', 'active', false, false),
         (v_sam, v_sam::text || '@test.invalid', 'Zz', 'History sam', 'member', 'active', false, false),
         (v_out, v_out::text || '@test.invalid', 'Zz', 'History out', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_ana);
  v_space := (public.create_general_space('Zz History space', '')).id;
  v_proj := (public.create_general_project('Zz History project', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, role) values
    (v_space, v_qin, 'member'), (v_space, v_sam, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (v_proj, v_qin, 'qa'), (v_proj, v_sam, 'stakeholder');
  select id into v_repo from public.general_repos where project_id = v_proj;

  perform pg_temp.act_as(v_ana);
  if v_repo is null then
    v_repo := (public.create_general_repo(v_proj, 'Files', '')).id;
  end if;

  ------------------------------------------------------------ the history
  c1 := pg_temp.push(v_repo, 'Zz one', jsonb_build_array(
          pg_temp.txt('a.md', 'added', 'one'), pg_temp.txt('b.md', 'added', 'bee')));
  c2 := pg_temp.push(v_repo, 'Zz two', jsonb_build_array(pg_temp.txt('a.md', 'changed', 'two')));
  c3 := pg_temp.push(v_repo, 'Zz drop b', jsonb_build_array(pg_temp.txt('b.md', 'removed')));
  v_x := pg_temp.upload(v_proj);
  -- X carries a base (0) older than every later version of c.docx, so putting it
  -- back passes the upload check only through the new rule.
  perform public.record_general_file_base(v_repo, 'c.docx', v_x, 0);
  c4 := pg_temp.push(v_repo, 'Zz add c', jsonb_build_array(pg_temp.bin('c.docx', 'added', v_x)));
  v_y := pg_temp.upload(v_proj);
  c5 := pg_temp.push(v_repo, 'Zz change c', jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_y)));
  perform pg_temp.must_be('the history is #1 to #5',
    c1.seq = 1 and c2.seq = 2 and c3.seq = 3 and c4.seq = 4 and c5.seq = 5 and pg_temp.base(v_repo) = 5);

  ------------------------------------------------------------ an old object outside a put-back
  -- X was Main's c.docx at #4, from base 0; Main moved on to Y at #5. Pushing X
  -- again by any other way is a stale copy (a share keeps the sharer's object),
  -- so it is held even though Main once had it at this path.
  perform pg_temp.must_refuse_with('a direct commit of X, an object Main once had at c.docx, is held',
    format($q$select public.commit_general_files(%L, 'Zz old x', 5, %L::jsonb)$q$,
           v_repo, jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_x))),
    'Main has a newer version of c.docx');
  perform public.save_general_draft_file(v_repo, 'c.docx', 'changed', 'binary', '', v_x);
  perform pg_temp.must_refuse_with('...and so is committing a draft carrying X, as a share copy would',
    format($q$select public.commit_general_draft_path(%L, 'c.docx', false)$q$, v_repo),
    'Main has a newer version of c.docx');
  perform public.discard_general_draft_file(v_repo, 'c.docx');
  perform pg_temp.must_be('...and nothing landed', pg_temp.base(v_repo) = 5);

  ------------------------------------------------------------ who may revert
  perform pg_temp.must_refuse_with('a stale base is refused',
    format($q$select public.revert_general_commit(%L, 4)$q$, c2.id), 'Somebody committed');

  perform pg_temp.act_as(v_qin);
  perform pg_temp.must_refuse_with('a member without commit_main cannot revert',
    format($q$select public.revert_general_commit(%L, 5)$q$, c2.id), 'cannot commit to Main');
  perform pg_temp.must_refuse_with('...nor restore',
    format($q$select public.restore_general_file(%L, 'a.md', 1, 5)$q$, v_repo), 'cannot commit to Main');

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_refuse_with('a stakeholder cannot revert',
    format($q$select public.revert_general_commit(%L, 5)$q$, c2.id), 'cannot commit to Main');
  perform pg_temp.must_refuse_with('...nor restore',
    format($q$select public.restore_general_file(%L, 'a.md', 1, 5)$q$, v_repo), 'cannot commit to Main');

  perform pg_temp.act_as(v_out);
  perform pg_temp.must_refuse_with('someone not on the project is told the commit is gone',
    format($q$select public.revert_general_commit(%L, 5)$q$, c1.id), 'That commit is gone');
  perform pg_temp.must_refuse_with('...and the repository',
    format($q$select public.restore_general_file(%L, 'a.md', 1, 5)$q$, v_repo), 'That repository is gone');

  ------------------------------------------------------------ revert of a change
  perform pg_temp.act_as(v_ana);
  perform pg_temp.must_be('none of the refusals wrote anything', pg_temp.base(v_repo) = 5);
  cr := public.revert_general_commit(c2.id, 5);
  b := pg_temp.blob(cr.id, 'a.md');
  perform pg_temp.must_be('revert of a change puts a.md back to "one" at #6',
    cr.seq = 6 and b.action = 'changed' and b.content = 'one' and b.kind = 'text'
    and (select count(*) = 1 from public.general_blobs where commit_id = cr.id));
  perform pg_temp.must_be('...with the default message', cr.message = 'Revert #2: Zz two' and cr.author_id = v_ana);
  select * into o from public.general_commit_origins where commit_id = cr.id;
  perform pg_temp.must_be('...and an origin row: revert of #2, no path',
    o.kind = 'revert' and o.source_seq = 2 and o.source_commit_id = c2.id and o.path is null
    and o.project_id = v_proj);

  ------------------------------------------------------------ revert of a removal
  cr := public.revert_general_commit(c3.id, 6, null, '  Zz bring b back  ');
  b := pg_temp.blob(cr.id, 'b.md');
  perform pg_temp.must_be('revert of a removal brings b.md back with #1''s content',
    cr.seq = 7 and b.action = 'added' and b.content = 'bee');
  perform pg_temp.must_be('...under the message given', cr.message = 'Zz bring b back');

  ------------------------------------------------------------ later edits
  perform pg_temp.must_refuse_with('reverting #1 is refused, naming a.md and b.md',
    format($q$select public.revert_general_commit(%L, 7)$q$, c1.id), 'Later commits changed a.md, b.md');
  perform pg_temp.must_be('...and nothing was written', pg_temp.base(v_repo) = 7);

  ------------------------------------------------------------ revert of an add
  cn := pg_temp.push(v_repo, 'Zz add d', jsonb_build_array(pg_temp.txt('d.md', 'added', 'dee')));
  cr := public.revert_general_commit(cn.id, pg_temp.base(v_repo));
  b := pg_temp.blob(cr.id, 'd.md');
  perform pg_temp.must_be('revert of an add removes d.md',
    b.action = 'removed' and not exists (
      select 1 from public.general_repo_tree where repo_id = v_repo and path = 'd.md'));

  v_g := pg_temp.upload(v_proj);
  cn := pg_temp.push(v_repo, 'Zz add g', jsonb_build_array(pg_temp.bin('g.docx', 'added', v_g)));
  cr := public.revert_general_commit(cn.id, pg_temp.base(v_repo));
  b := pg_temp.blob(cr.id, 'g.docx');
  perform pg_temp.must_be('revert of a Word add removes it, carrying its object',
    b.action = 'removed' and b.kind = 'binary' and b.storage_path = v_g);

  ------------------------------------------------------------ a later removal
  cn := pg_temp.push(v_repo, 'Zz add e', jsonb_build_array(pg_temp.txt('e.md', 'added', 'ee')));
  perform pg_temp.push(v_repo, 'Zz drop e', jsonb_build_array(pg_temp.txt('e.md', 'removed')));
  perform pg_temp.must_refuse_with('reverting an add removed later is refused, naming e.md',
    format($q$select public.revert_general_commit(%L, %s)$q$, cn.id, pg_temp.base(v_repo)),
    'Later commits changed e.md.');

  ------------------------------------------------------------ one-path undo
  perform pg_temp.must_refuse_with('undoing c.docx in #4 is refused: #5 changed it',
    format($q$select public.revert_general_commit(%L, %s, 'c.docx')$q$, c4.id, pg_temp.base(v_repo)),
    'Later commits changed c.docx');
  perform pg_temp.must_refuse_with('undoing a file the commit did not touch is refused',
    format($q$select public.revert_general_commit(%L, %s, 'a.md')$q$, c5.id, pg_temp.base(v_repo)),
    'did not change a.md');
  perform pg_temp.must_be('X carries a base older than Main''s c.docx (the old check would hold it)',
    (select base_seq = 0 from public.general_file_bases where storage_path = v_x)
    and public.general_main_seq(v_repo, 'c.docx') = 5);
  cr := public.revert_general_commit(c5.id, pg_temp.base(v_repo), ' c.docx ');
  b := pg_temp.blob(cr.id, 'c.docx');
  perform pg_temp.must_be('undoing c.docx in #5 puts object X back',
    b.action = 'changed' and b.kind = 'binary' and b.storage_path = v_x);
  perform pg_temp.must_be('...with the default message', cr.message = 'Undo #5 on c.docx');
  select * into o from public.general_commit_origins where commit_id = cr.id;
  perform pg_temp.must_be('...and an origin row naming the path',
    o.kind = 'revert' and o.source_seq = 5 and o.source_commit_id = c5.id and o.path = 'c.docx');

  ------------------------------------------------------------ restore a binary
  perform pg_temp.push(v_repo, 'Zz change c again', jsonb_build_array(
    pg_temp.bin('c.docx', 'changed', pg_temp.upload(v_proj))));
  cr := public.restore_general_file(v_repo, 'c.docx', 4, pg_temp.base(v_repo));
  b := pg_temp.blob(cr.id, 'c.docx');
  perform pg_temp.must_be('restoring c.docx to #4 after a later change passes the upload check with X',
    b.action = 'changed' and b.kind = 'binary' and b.storage_path = v_x);
  perform pg_temp.must_be('...with the default message', cr.message = 'Restore c.docx to #4');
  select * into o from public.general_commit_origins where commit_id = cr.id;
  perform pg_temp.must_be('...and an origin row: restore from #4, the path',
    o.kind = 'restore' and o.source_seq = 4 and o.source_commit_id = c4.id and o.path = 'c.docx');
  perform pg_temp.must_be('...and the put-back flag is off again after it',
    current_setting('collabify.file_history_put_back', true) = 'off');
  perform pg_temp.push(v_repo, 'Zz change c once more', jsonb_build_array(
    pg_temp.bin('c.docx', 'changed', pg_temp.upload(v_proj))));
  perform pg_temp.must_refuse_with('...so a direct commit of X after the restore is held again',
    format($q$select public.commit_general_files(%L, 'Zz old x again', %s, %L::jsonb)$q$,
           v_repo, pg_temp.base(v_repo), jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_x))),
    'Main has a newer version of c.docx');

  v_w := pg_temp.upload(v_proj);
  perform public.record_general_file_base(v_repo, 'c.docx', v_w, 5);
  perform pg_temp.must_refuse_with('a copy made from an older version than Main''s is still held',
    format($q$select public.commit_general_files(%L, 'Zz stale', %s, %L::jsonb)$q$,
           v_repo, pg_temp.base(v_repo), jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_w))),
    'Main has a newer version of c.docx');
  -- An object Main had only under another path is no version of this one.
  perform pg_temp.push(v_repo, 'Zz add h', jsonb_build_array(
    pg_temp.bin('h.docx', 'added', pg_temp.upload(v_proj))));
  perform public.record_general_file_base(v_repo, 'h.docx', v_g, 0);
  perform pg_temp.must_refuse_with('...and so is g.docx''s old object pushed as h.docx from a stale base',
    format($q$select public.commit_general_files(%L, 'Zz stale h', %s, %L::jsonb)$q$,
           v_repo, pg_temp.base(v_repo), jsonb_build_array(pg_temp.bin('h.docx', 'changed', v_g))),
    'Main has a newer version of h.docx');

  ------------------------------------------------------------ restore a text file
  perform pg_temp.push(v_repo, 'Zz drop b again', jsonb_build_array(pg_temp.txt('b.md', 'removed')));
  cr := public.restore_general_file(v_repo, 'b.md', 1, pg_temp.base(v_repo));
  b := pg_temp.blob(cr.id, 'b.md');
  perform pg_temp.must_be('restoring a deleted b.md to #1 adds it back',
    b.action = 'added' and b.content = 'bee');
  perform pg_temp.must_be('...with the default message', cr.message = 'Restore b.md to #1');
  perform pg_temp.must_refuse_with('restoring to a version that removed the file is refused',
    format($q$select public.restore_general_file(%L, 'b.md', 3, %s)$q$, v_repo, pg_temp.base(v_repo)),
    'removed b.md');
  perform pg_temp.must_refuse_with('restoring to a version the file never had is refused',
    format($q$select public.restore_general_file(%L, 'b.md', 2, %s)$q$, v_repo, pg_temp.base(v_repo)),
    'did not change b.md');
  perform pg_temp.must_refuse_with('restoring to what is already current is refused',
    format($q$select public.restore_general_file(%L, 'b.md', 1, %s)$q$, v_repo, pg_temp.base(v_repo)),
    'already');
  perform pg_temp.must_refuse_with('...the current version itself too',
    format($q$select public.restore_general_file(%L, 'b.md', %s, %s)$q$, v_repo, cr.seq, pg_temp.base(v_repo)),
    'already');
  perform pg_temp.must_refuse_with('a stale base is refused on restore',
    format($q$select public.restore_general_file(%L, 'a.md', 2, %s)$q$, v_repo, pg_temp.base(v_repo) - 1),
    'Somebody committed');

  ------------------------------------------------------------ files already as they were
  -- a.md is "one" (put back by the revert at #6); this commit "changes" it to
  -- the same "one", and adds f.md.
  cn := pg_temp.push(v_repo, 'Zz same a, add f', jsonb_build_array(
          pg_temp.txt('a.md', 'changed', 'one'), pg_temp.txt('f.md', 'added', 'eff')));
  cr := public.revert_general_commit(cn.id, pg_temp.base(v_repo));
  perform pg_temp.must_be('a revert skips a file already as it was and writes only the other',
    (select count(*) = 1 from public.general_blobs where commit_id = cr.id)
    and (pg_temp.blob(cr.id, 'f.md')).action = 'removed');
  perform pg_temp.must_refuse_with('...and is refused when no file is left',
    format($q$select public.revert_general_commit(%L, %s, 'a.md')$q$, cn.id, pg_temp.base(v_repo)),
    'Nothing to undo. a.md is already as it was before');

  ------------------------------------------------------------ the origins table
  perform pg_temp.must_refuse_with('nobody writes an origin row directly',
    format($q$insert into public.general_commit_origins (commit_id, project_id, kind, source_seq)
              values (%L, %L, 'revert', 1)$q$, c5.id, v_proj), 'denied');
  perform pg_temp.must_refuse_with('...nor changes one',
    'update public.general_commit_origins set source_seq = 99', 'denied');
  perform pg_temp.must_refuse_with('...nor deletes one',
    'delete from public.general_commit_origins', 'denied');

  perform pg_temp.act_as(v_sam);
  perform pg_temp.must_be('a stakeholder reads the origin rows',
    (select count(*) = 8 from public.general_commit_origins where project_id = v_proj));
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_be('someone not on the project reads none',
    not exists (select 1 from public.general_commit_origins where project_id = v_proj));

  ------------------------------------------------------------ an archived project
  perform pg_temp.act_as_service();
  update public.general_projects set archived_at = now() where id = v_proj;
  perform pg_temp.act_as(v_ana);
  n := pg_temp.base(v_repo);
  perform pg_temp.must_refuse_with('an archived project refuses a revert',
    format($q$select public.revert_general_commit(%L, %s)$q$, c2.id, n), 'archived');
  perform pg_temp.must_refuse_with('...and a restore',
    format($q$select public.restore_general_file(%L, 'a.md', 2, %s)$q$, v_repo, n), 'archived');

  ------------------------------------------------------------ anon
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform pg_temp.must_refuse_with('anon cannot revert',
    format($q$select public.revert_general_commit(%L, 1)$q$, c2.id), 'permission denied');
  perform pg_temp.must_refuse_with('...nor restore',
    format($q$select public.restore_general_file(%L, 'a.md', 1, 1)$q$, v_repo), 'permission denied');
  perform pg_temp.must_refuse_with('...nor read the origins',
    'select count(*) from public.general_commit_origins', 'permission denied');
end;
$$;

rollback;
