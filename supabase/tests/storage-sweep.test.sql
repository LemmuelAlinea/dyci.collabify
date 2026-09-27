-- What the storage sweep treats as unused, and who may run it. Rolls back.
--
--   node scripts/db.mjs supabase/tests/storage-sweep.test.sql

begin;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  prof uuid;
  old_at timestamptz := now() - interval '3 days';
  refused boolean;
  someone uuid;
begin
  select id into prof from public.profiles where role = 'faculty' and status = 'active' order by created_at limit 1;
  select id into someone from public.profiles where status = 'active' order by created_at limit 1;

  insert into storage.objects (bucket_id, name, created_at) values
    ('teaching-resources', 'zz-sweep/orphan.pdf', old_at),
    ('teaching-resources', 'zz-sweep/used.pdf', old_at),
    ('teaching-resources', 'zz-sweep/fresh.pdf', now()),
    ('avatars', 'zz-sweep/face.png', old_at),
    ('general-files', 'zz-sweep/files/draft-only.bin', old_at);

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'Sweep test', 'zz-sweep/used.pdf', 'used.pdf');

  perform pg_temp.ok('an old file nothing points to is swept',
    exists (select 1 from public.storage_orphans(100000) where name = 'zz-sweep/orphan.pdf'));
  perform pg_temp.ok('a file a row points to is kept',
    not exists (select 1 from public.storage_orphans(100000) where name = 'zz-sweep/used.pdf'));
  perform pg_temp.ok('a fresh upload still waiting for its row is kept',
    not exists (select 1 from public.storage_orphans(100000) where name = 'zz-sweep/fresh.pdf'));
  perform pg_temp.ok('avatars are never swept',
    not exists (select 1 from public.storage_orphans(100000) where name = 'zz-sweep/face.png'));
  perform pg_temp.ok('an upload nothing records in a project''s Files is swept',
    exists (select 1 from public.storage_orphans(100000) where name = 'zz-sweep/files/draft-only.bin'));

  -- Signed-in people cannot run it or read what it asked for.
  perform set_config('request.jwt.claims', json_build_object('sub', someone, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.sweep_storage(1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a signed-in person cannot run the sweep', refused);
  begin
    perform public.storage_orphans(1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...or list what it would remove', refused);
  begin
    perform 1 from public.storage_sweep_requests limit 1;
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...or read its request log', refused);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.ok('the job runs every fifteen minutes',
    exists (select 1 from cron.job where jobname = 'collabify-storage-sweep' and schedule = '*/15 * * * *'));
end $$;

rollback;
