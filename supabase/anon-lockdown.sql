-- Collabify — the anonymous role runs nothing in public.
--
--   node scripts/db.mjs supabase/anon-lockdown.sql
--
-- Every screen that talks to the database does so signed in. Signing up,
-- signing in and resetting a password go through Supabase Auth; sign-up's
-- handle_new_user is a trigger, and PostgreSQL never checks EXECUTE on a
-- trigger function. The edge functions forward the caller's token. So anon
-- needs no function here, and a function it can run is one more way in for
-- someone who is not signed in at all.
--
-- Signed-in access is kept exactly as it is: authenticated and service_role
-- get an explicit grant on every function they can run today (so losing the
-- PUBLIC grant costs them nothing), and nothing they can't run today is granted.
--
-- Runs LAST. Supabase's default privileges hand anon EXECUTE on every function
-- created afterwards, and a drop + create re-grants it, so re-run this file after
-- adding or redefining any function. supabase/tests/anon-lockdown.test.sql fails
-- until you do.
--
-- Idempotent. Safe to re-run.

begin;

do $$
declare
  f record;
begin
  for f in
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       -- Functions an extension owns belong to the extension, not to us.
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
  loop
    if has_function_privilege('authenticated', f.oid, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if has_function_privilege('service_role', f.oid, 'execute') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

commit;
