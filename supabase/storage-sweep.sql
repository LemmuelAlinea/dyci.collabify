-- Collabify — clearing uploaded files nothing points to any more.
--
--   node scripts/db.mjs supabase/storage-sweep.sql
--   node scripts/sweeper-secrets.mjs      (once, and after rotating the service key)
--
-- A file is uploaded first and recorded second, and deleted rows never take
-- their Storage objects with them: a deleted space, class, project, task,
-- announcement or message, a discarded draft, a file replaced in a draft. Each
-- left its bytes behind, readable by nobody and still stored.
--
-- Storage refuses a plain SQL delete (storage.protect_delete) because that
-- would drop the row and keep the bytes. So a pg_cron job asks the Storage API
-- to remove them, through pg_net, with the service role key kept in Supabase
-- Vault — never in this file, the frontend, Vercel or git.
--
-- What counts as used is listed per bucket in storage_orphans below. A file is
-- only a candidate a day after upload, so an upload still waiting for its row
-- (a draft being edited, a message being written) is never taken. Avatars are
-- left out: a profile points at its picture by URL, not by path.
--
-- Also fixes general_files_remove_orphans (general-project-archive-rbac.sql),
-- whose subquery read `name` as general_projects.name and so never matched.

begin;

create extension if not exists pg_net;

-- ---------------------------------------------------------------- what is used

/** Every uploaded file nothing refers to, older than the grace period. */
create or replace function public.storage_orphans(
  p_limit int default 500,
  p_grace interval default interval '1 day'
) returns table (bucket_id text, name text)
language sql stable security definer set search_path = public as $$
  with used (bucket_id, path) as (
              select 'general-files', f.file_path from public.general_task_files f
    union all select 'general-files', b.storage_path from public.general_blobs b where b.storage_path is not null
    union all select 'general-files', d.storage_path from public.general_draft_files d where d.storage_path is not null
    union all select 'general-files', x ->> 'storage_path'
                from public.general_repo_changes ch, jsonb_array_elements(ch.files) x
               where x ->> 'storage_path' is not null
    union all select 'general-files', x ->> 'storage_path'
                from public.general_shares sh, jsonb_array_elements(sh.files) x
               where x ->> 'storage_path' is not null
    union all select 'task-files', t.file_path from public.task_files t
    union all select 'project-files', a.file_path from public.project_attachments a
    union all select 'class-files', a.file_path from public.announcement_attachments a
    union all select 'chat-files', m.file_path from public.message_attachments m
    union all select 'teaching-resources', r.file_path from public.teaching_resources r
    union all select 'discussion-voice', m.audio_path
                from public.general_discussion_messages m where m.audio_path is not null
  )
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('general-files', 'task-files', 'project-files', 'class-files',
                         'chat-files', 'teaching-resources', 'discussion-voice')
     and o.created_at < now() - p_grace
     and not exists (select 1 from used u where u.bucket_id = o.bucket_id and u.path = o.name)
   order by o.created_at
   limit p_limit;
$$;

-- ---------------------------------------------------------------- the sweep

/** What was asked for, so a slow answer is not asked for again every run. */
create table if not exists public.storage_sweep_requests (
  bucket_id    text not null,
  name         text not null,
  request_id   bigint,
  requested_at timestamptz not null default now(),
  primary key (bucket_id, name)
);
alter table public.storage_sweep_requests enable row level security;
revoke all on public.storage_sweep_requests from anon, authenticated;

/**
 * Asks Storage to remove up to p_limit orphans, one request per bucket, and
 * answers how many were asked for. Nothing happens until the Vault holds the
 * project URL and the service key.
 */
create or replace function public.sweep_storage(p_limit int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_url  text;
  v_key  text;
  b      record;
  n      int := 0;
  rid    bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'collabify_supabase_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'collabify_service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;

  -- A request older than a day that did not take is tried again.
  delete from public.storage_sweep_requests where requested_at < now() - interval '1 day';

  for b in
    select o.bucket_id, array_agg(o.name) as names
      from public.storage_orphans(p_limit) o
     where not exists (select 1 from public.storage_sweep_requests s
                        where s.bucket_id = o.bucket_id and s.name = o.name)
     group by o.bucket_id
  loop
    rid := net.http_delete(
      url     := rtrim(v_url, '/') || '/storage/v1/object/' || b.bucket_id,
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' || v_key,
                   'apikey', v_key,
                   'Content-Type', 'application/json'),
      body    := jsonb_build_object('prefixes', to_jsonb(b.names)),
      timeout_milliseconds := 30000);
    insert into public.storage_sweep_requests (bucket_id, name, request_id)
    select b.bucket_id, x, rid from unnest(b.names) x
    on conflict (bucket_id, name) do update set request_id = excluded.request_id, requested_at = now();
    n := n + cardinality(b.names);
  end loop;

  return n;
end;
$$;

revoke all on function public.storage_orphans(int, interval) from public, anon, authenticated;
revoke all on function public.sweep_storage(int) from public, anon, authenticated;

-- Every fifteen minutes. Rescheduled by name, so re-running this file is safe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'collabify-storage-sweep') then
    perform cron.unschedule('collabify-storage-sweep');
  end if;
  perform cron.schedule('collabify-storage-sweep', '*/15 * * * *', 'select public.sweep_storage(500)');
end;
$$;

-- ---------------------------------------------------------------- the orphan policy, fixed

/**
 * general-project-archive-rbac.sql's policy with its column qualified. Unqualified,
 * `name` inside the subquery meant general_projects.name, so a deleted project's
 * files were never removable from the app. The sweep would get them a day
 * later regardless; this lets the delete clear them at once, as intended.
 */
drop policy if exists general_files_remove_orphans on storage.objects;
create policy general_files_remove_orphans on storage.objects
  for delete to authenticated using (
    bucket_id = 'general-files'
    and public.general_safe_uuid((storage.foldername(objects.name))[1]) is not null
    and not exists (
      select 1 from public.general_projects gp
       where gp.id = public.general_safe_uuid((storage.foldername(objects.name))[1])
    )
  );

commit;
