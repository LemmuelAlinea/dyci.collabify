-- Collabify — PDF previews of Word files.
--
--   node scripts/db.mjs supabase/word-previews.sql supabase/anon-lockdown.sql
--
-- A Word file (.docx, .doc, .odt, .rtf) stays exactly as uploaded in general-files.
-- The `word-pdf` Edge Function turns it into a PDF once, with the Gotenberg
-- converter on Azure Container Apps, and keeps that PDF in the private
-- `file-previews` bucket at `<the Word file's object name>.pdf`. Uploaded objects
-- never change (every upload gets a new name), so a preview never goes stale.
--
-- Nobody reads or writes file-previews directly: the bucket has no policies, so
-- only the service role touches it. The function first proves the caller may read
-- the Word file (signing it with the caller's own token, so storage policies
-- decide), then hands back a 10-minute signed link to the PDF.
--
-- One PDF per version that is in use, never one per old version. A preview is kept,
-- with no expiry, for an object that is (word_preview_keep):
--   * the current version of a path in Main (its newest blob, not a removal),
--   * a file in someone's draft (My workspace),
--   * a file in an open review request, or
--   * a file in a share.
-- Every other preview goes:
--   * at once, when a commit, merged request, revert or restore replaces a Word
--     file's version in Main (general_blobs_word_preview_drop, through pg_net), and
--   * hourly otherwise (collabify-preview-sweep): a discarded draft, a closed
--     request, a removed share, a file whose object is gone. A preview younger than
--     15 minutes is left alone, so an upload's preview survives until its draft
--     row or commit lands.
-- A restored version's PDF is remade by the app right after the restore.
--
-- Deletes go through the Storage API with the same Vault secrets the storage sweep
-- uses. storage_orphans is left alone: it never lists this bucket.
--
-- Runs after file-pulls.sql, before file-history.sql and anon-lockdown.sql. Idempotent.
-- Suite: supabase/tests/word-previews.test.sql.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('file-previews', 'file-previews', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** True for a Word file's path or object name. */
create or replace function public.is_word_path(p_path text)
returns boolean language sql immutable as $$
  select coalesce(p_path ~* '\.(docx|doc|odt|rtf)$', false);
$$;

/** The general-files objects whose PDF preview stays. */
create or replace function public.word_preview_keep()
returns table (storage_path text)
language sql stable security definer set search_path = public as $$
  select t.storage_path
    from (
      select distinct on (b.repo_id, b.path) b.action, b.storage_path
        from public.general_blobs b
       order by b.repo_id, b.path, b.seq desc
    ) t
   where t.action <> 'removed' and t.storage_path is not null
  union
  select d.storage_path from public.general_draft_files d where d.storage_path is not null
  union
  select x ->> 'storage_path'
    from public.general_repo_changes ch, jsonb_array_elements(ch.files) x
   where ch.status = 'open' and x ->> 'storage_path' is not null
  union
  select x ->> 'storage_path'
    from public.general_shares sh, jsonb_array_elements(sh.files) x
   where x ->> 'storage_path' is not null;
$$;

drop function if exists public.word_preview_orphans(int);

/** Previews of objects no longer in use, oldest first, past the grace period. */
create or replace function public.word_preview_orphans(
  p_limit int default 500,
  p_grace interval default interval '15 minutes'
) returns table (name text)
language sql stable security definer set search_path = public as $$
  with keep as materialized (select k.storage_path || '.pdf' as name from public.word_preview_keep() k)
  select p.name
    from storage.objects p
   where p.bucket_id = 'file-previews'
     and p.created_at < now() - p_grace
     and not exists (select 1 from keep where keep.name = p.name)
   order by p.created_at
   limit p_limit;
$$;

/** Asks Storage to remove these previews (names in file-previews); answers how many it asked for. */
create or replace function public.drop_word_previews(p_names text[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_key text;
begin
  if p_names is null or cardinality(p_names) = 0 then
    return 0;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collabify_supabase_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'collabify_service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;

  -- pg_net sends after this transaction commits, and never if it rolls back.
  perform net.http_delete(
    url     := rtrim(v_url, '/') || '/storage/v1/object/file-previews',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_key,
                 'apikey', v_key,
                 'Content-Type', 'application/json'),
    body    := jsonb_build_object('prefixes', to_jsonb(p_names)),
    timeout_milliseconds := 30000);
  return cardinality(p_names);
end;
$$;

/** Removes up to p_limit previews nothing uses any more; answers how many. */
create or replace function public.sweep_word_previews(p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_names text[];
begin
  select array_agg(o.name) into v_names from public.word_preview_orphans(p_limit) o;
  return public.drop_word_previews(v_names);
end;
$$;

/**
 * The object whose preview a new Main blob makes stale: the version it replaces,
 * when that was a stored Word object and nothing else still uses it. Null otherwise.
 */
create or replace function public.word_preview_replaced(p_blob public.general_blobs)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_old  text;
  v_live text := case when p_blob.action = 'removed' then null else p_blob.storage_path end;
begin
  if not public.is_word_path(p_blob.path) then
    return null;
  end if;

  select case when b.action = 'removed' then null else b.storage_path end into v_old
    from public.general_blobs b
   where b.repo_id = p_blob.repo_id and b.path = p_blob.path and b.seq < p_blob.seq
   order by b.seq desc
   limit 1;

  if v_old is null or v_old = v_live then
    return null;
  end if;

  -- Still in use elsewhere: a draft, an open request, a share, or another path's
  -- current version. The hourly sweep looks again once it is not.
  if exists (select 1 from public.general_draft_files d where d.storage_path = v_old)
     or exists (select 1 from public.general_repo_changes ch, jsonb_array_elements(ch.files) x
                 where ch.status = 'open' and x ->> 'storage_path' = v_old)
     or exists (select 1 from public.general_shares sh, jsonb_array_elements(sh.files) x
                 where x ->> 'storage_path' = v_old)
     or exists (select 1 from public.general_blobs o
                 where o.storage_path = v_old
                   and (o.repo_id, o.path) is distinct from (p_blob.repo_id, p_blob.path)) then
    return null;
  end if;

  return v_old;
end;
$$;

/** A Word file's new version in Main: its old version's preview goes now. */
create or replace function public.general_blobs_word_preview_drop()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old text := public.word_preview_replaced(new);
begin
  if v_old is not null then
    perform public.drop_word_previews(array[v_old || '.pdf']);
  end if;
  return null;
end;
$$;

drop trigger if exists general_blobs_word_preview_drop on public.general_blobs;
create trigger general_blobs_word_preview_drop
  after insert on public.general_blobs
  for each row execute function public.general_blobs_word_preview_drop();

revoke all on function public.word_preview_keep() from public, anon, authenticated;
revoke all on function public.word_preview_orphans(int, interval) from public, anon, authenticated;
revoke all on function public.drop_word_previews(text[]) from public, anon, authenticated;
revoke all on function public.sweep_word_previews(int) from public, anon, authenticated;
revoke all on function public.word_preview_replaced(public.general_blobs) from public, anon, authenticated;
revoke all on function public.general_blobs_word_preview_drop() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'collabify-preview-sweep') then
    perform cron.unschedule('collabify-preview-sweep');
  end if;
  perform cron.schedule('collabify-preview-sweep', '17 * * * *', 'select public.sweep_word_previews(500)');
end;
$$;

commit;
