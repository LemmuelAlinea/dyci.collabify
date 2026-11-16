-- supabase/tests/word-previews.test.sql
-- One PDF preview per Word version in use: which previews stay (Main's current
-- version, drafts, open requests, shares), which a commit, removal or restore
-- drops at once, and what the hourly sweep lists. Rolls back; nothing survives,
-- and the pg_net requests it queues are rolled back with it.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/word-previews.test.sql
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

/** A fresh object in the project's files, owned by whoever the test acts as. */
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

/** A stored preview for an object, made p_age ago. */
create or replace function pg_temp.preview(p_object text, p_age interval default interval '1 hour') returns void
language plpgsql as $$
declare
  v_role text := current_setting('role');
begin
  perform set_config('role', 'none', true);
  insert into storage.objects (bucket_id, name, created_at, updated_at)
  values ('file-previews', p_object || '.pdf', now() - p_age, now() - p_age);
  perform set_config('role', v_role, true);
end;
$$;

/** True when this transaction queued a Storage delete naming that object's preview. */
create or replace function pg_temp.dropped(p_object text) returns boolean
language plpgsql as $$
declare
  v_role text := current_setting('role');
  v_got  boolean;
begin
  perform set_config('role', 'none', true);
  select exists (
    select 1 from net.http_request_queue q
     where q.method = 'DELETE' and q.url like '%/storage/v1/object/file-previews'
       and convert_from(q.body, 'UTF8') like '%' || p_object || '.pdf%') into v_got;
  perform set_config('role', v_role, true);
  return v_got;
end;
$$;

/** What the hourly sweep would remove right now, ignoring the grace period. */
create or replace function pg_temp.orphan(p_object text, p_grace interval default interval '0 seconds')
returns boolean language plpgsql as $$
declare
  v_role text := current_setting('role');
  v_got  boolean;
begin
  perform set_config('role', 'none', true);
  select exists (select 1 from public.word_preview_orphans(5000, p_grace) o
                  where o.name = p_object || '.pdf') into v_got;
  perform set_config('role', v_role, true);
  return v_got;
end;
$$;

create or replace function pg_temp.bin(p_path text, p_action text, p_storage text)
returns jsonb language sql as $$
  select jsonb_build_object('path', p_path, 'action', p_action, 'kind', 'binary',
                            'content', '', 'storage_path', p_storage);
$$;

create or replace function pg_temp.push(p_repo uuid, p_files jsonb)
returns public.general_commits language sql as $$
  select public.commit_general_files(p_repo, 'Zz preview test',
    (select commit_count from public.general_repos where id = p_repo), p_files);
$$;

do $$
declare
  v_ana   uuid := gen_random_uuid();
  v_space uuid;
  v_proj  uuid;
  v_repo  uuid;
  v_x     text;
  v_y     text;
  v_z     text;
  v_d     text;
  v_pdf   text;
  v_old   text;
  n_vault int;
begin
  perform pg_temp.act_as_service();
  select count(*) into n_vault from vault.decrypted_secrets
   where name in ('collabify_supabase_url', 'collabify_service_role_key');
  perform pg_temp.must_be('the Vault secrets the deletes use are set', n_vault = 2);

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_ana, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          v_ana::text || '@test.invalid', '', now(), now());
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_ana, v_ana::text || '@test.invalid', 'Zz', 'Preview ana', 'member', 'active', false, true)
  on conflict (id) do update set role = excluded.role, status = excluded.status,
    can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_ana);
  v_space := (public.create_general_space('Zz Preview space', '')).id;
  v_proj := (public.create_general_project('Zz Preview project', '', null, null, null, null, v_space)).id;
  select id into v_repo from public.general_repos where project_id = v_proj;
  if v_repo is null then
    v_repo := (public.create_general_repo(v_proj, 'Files', '')).id;
  end if;

  ------------------------------------------------------------ a new version drops the old one's preview
  v_x := pg_temp.upload(v_proj);
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('c.docx', 'added', v_x)));
  perform pg_temp.preview(v_x);
  perform pg_temp.must_be('a first version drops nothing', not pg_temp.dropped(v_x));
  perform pg_temp.must_be('Main''s current version keeps its preview', not pg_temp.orphan(v_x));

  v_y := pg_temp.upload(v_proj);
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_y)));
  perform pg_temp.preview(v_y);
  perform pg_temp.must_be('a commit replacing c.docx drops the old version''s preview at once', pg_temp.dropped(v_x));
  perform pg_temp.must_be('...and the sweep lists the old version too', pg_temp.orphan(v_x));
  perform pg_temp.must_be('...while the new current version keeps its own', not pg_temp.orphan(v_y));

  ------------------------------------------------------------ a version still in a draft stays
  perform public.save_general_draft_file(v_repo, 'notes/c.docx', 'added', 'binary', '', v_y);
  v_z := pg_temp.upload(v_proj);
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('c.docx', 'changed', v_z)));
  perform pg_temp.must_be('a replaced version still in someone''s draft is not dropped', not pg_temp.dropped(v_y));
  perform pg_temp.must_be('...and the sweep keeps it while the draft holds it', not pg_temp.orphan(v_y));
  perform public.discard_general_draft_file(v_repo, 'notes/c.docx');
  perform pg_temp.must_be('...then lists it once the draft lets go', pg_temp.orphan(v_y));

  ------------------------------------------------------------ drafts, requests and shares
  v_d := pg_temp.upload(v_proj);
  perform public.save_general_draft_file(v_repo, 'draft.docx', 'added', 'binary', '', v_d);
  perform pg_temp.preview(v_d);
  perform pg_temp.must_be('a draft file keeps its preview', not pg_temp.orphan(v_d));
  perform pg_temp.act_as_service();
  insert into public.general_shares (project_id, repo_id, sender_id, type, path, files)
  values (v_proj, v_repo, v_ana, 'file', 'shared.docx',
          jsonb_build_array(pg_temp.bin('shared.docx', 'added', v_x)));
  perform pg_temp.must_be('a shared copy keeps its preview, even of an old Main version', not pg_temp.orphan(v_x));
  delete from public.general_shares where repo_id = v_repo;
  perform pg_temp.act_as(v_ana);

  ------------------------------------------------------------ the grace period
  v_pdf := pg_temp.upload(v_proj);
  perform pg_temp.preview(v_pdf, interval '1 minute');
  perform pg_temp.must_be('a fresh upload''s preview is not swept in its first 15 minutes',
    not pg_temp.orphan(v_pdf, interval '15 minutes'));
  perform pg_temp.must_be('...but is once it is older and nothing uses it', pg_temp.orphan(v_pdf));

  ------------------------------------------------------------ a restore and a removal
  perform public.restore_general_file(v_repo, 'c.docx', 2,
    (select commit_count from public.general_repos where id = v_repo));
  perform pg_temp.must_be('restoring c.docx to an older version drops the replaced version''s preview',
    pg_temp.dropped(v_z));
  perform pg_temp.must_be('...and the restored version is current again, so its preview stays',
    not pg_temp.orphan(v_y));

  v_old := v_y;
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('c.docx', 'removed', v_old)));
  perform pg_temp.must_be('removing c.docx drops its current version''s preview', pg_temp.dropped(v_old));

  ------------------------------------------------------------ not Word
  v_pdf := pg_temp.upload(v_proj, 'pdf');
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('report.pdf', 'added', v_pdf)));
  v_x := pg_temp.upload(v_proj, 'pdf');
  perform pg_temp.push(v_repo, jsonb_build_array(pg_temp.bin('report.pdf', 'changed', v_x)));
  perform pg_temp.must_be('a PDF file''s new version queues no preview delete', not pg_temp.dropped(v_pdf));

  raise notice 'Done: word-previews suite passed.';
end;
$$;

rollback;
