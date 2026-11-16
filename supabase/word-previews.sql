-- Collabify — PDF previews of Word files.
--
--   node scripts/db.mjs supabase/word-previews.sql supabase/anon-lockdown.sql
--
-- A Word file (.docx, .doc, .odt, .rtf) stays exactly as uploaded in general-files.
-- The `word-pdf` Edge Function turns it into a PDF once, with the Gotenberg
-- converter on Cloud Run, and keeps that PDF in the private `file-previews`
-- bucket at `<the Word file's object name>.pdf`. Uploaded objects never change
-- (every upload gets a new name), so a preview never goes stale.
--
-- Nobody reads or writes file-previews directly: the bucket has no policies, so
-- only the service role touches it. The function first proves the caller may read
-- the Word file (signing it with the caller's own token, so storage policies
-- decide), then hands back a 10-minute signed link to the PDF.
--
-- A preview whose Word file is gone (the storage sweep took it) is removed by the
-- `collabify-preview-sweep` job, through the Storage API with the same Vault
-- secrets the storage sweep uses. storage_orphans is left alone: it never lists
-- this bucket.
--
-- Runs after file-pulls.sql, before anon-lockdown.sql. Idempotent.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('file-previews', 'file-previews', false, 104857600, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** Previews whose Word file is no longer stored, oldest first. */
create or replace function public.word_preview_orphans(p_limit int default 500)
returns table (name text)
language sql stable security definer set search_path = public as $$
  select p.name
    from storage.objects p
   where p.bucket_id = 'file-previews'
     and p.created_at < now() - interval '1 hour'
     and not exists (
       select 1 from storage.objects s
        where s.bucket_id = 'general-files'
          and s.name = left(p.name, length(p.name) - 4)
     )
   order by p.created_at
   limit p_limit;
$$;

/** Asks Storage to remove up to p_limit orphaned previews; answers how many. */
create or replace function public.sweep_word_previews(p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_url   text;
  v_key   text;
  v_names text[];
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collabify_supabase_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'collabify_service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;

  select array_agg(o.name) into v_names from public.word_preview_orphans(p_limit) o;
  if v_names is null then
    return 0;
  end if;

  perform net.http_delete(
    url     := rtrim(v_url, '/') || '/storage/v1/object/file-previews',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_key,
                 'apikey', v_key,
                 'Content-Type', 'application/json'),
    body    := jsonb_build_object('prefixes', to_jsonb(v_names)),
    timeout_milliseconds := 30000);
  return cardinality(v_names);
end;
$$;

revoke all on function public.word_preview_orphans(int) from public, anon, authenticated;
revoke all on function public.sweep_word_previews(int) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'collabify-preview-sweep') then
    perform cron.unschedule('collabify-preview-sweep');
  end if;
  perform cron.schedule('collabify-preview-sweep', '17 * * * *', 'select public.sweep_word_previews(500)');
end;
$$;

commit;
