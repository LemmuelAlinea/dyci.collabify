-- Every table in public has row-level security. Rolls back, touches nothing.
--
--   node scripts/db.mjs supabase/tests/rls-coverage.test.sql
--
-- Supabase grants anon and authenticated full rights on every new table, so a
-- table made without row-level security is readable and writable by anyone
-- holding the public anon key. This fails the moment one slips through.

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
  missing text;
  refused boolean;
begin
  select string_agg(c.relname, ', ' order by c.relname) into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform pg_temp.ok('every table in public has row-level security'
    || coalesce(' (missing: ' || missing || ')', ''), missing is null);

  perform pg_temp.ok('the public roles hold no rights on general_report_settings',
    not exists (select 1 from information_schema.role_table_grants
                 where table_schema = 'public' and table_name = 'general_report_settings'
                   and grantee in ('anon', 'authenticated', 'PUBLIC')));

  perform set_config('role', 'anon', true);
  begin
    update public.general_report_settings set history_since = now();
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('the anon key cannot change the reports'' history date', refused);

  perform pg_temp.ok('reports still read their history date',
    public.general_report_history_since() is not null);
end;
$$;

rollback;
