-- Collabify — one-workplace cleanup.
--
--   node scripts/db.mjs supabase/cleanup.sql
--
-- Runs after one-workplace.sql and before anon-lockdown.sql. Removes the old
-- sign-in landing state now that every account lands in the one shell.

begin;

alter table public.profiles
  drop column if exists home_workplace;

do $$
begin
  drop type if exists public.workplace;
exception when dependent_objects_still_exist then
  raise notice 'public.workplace still has dependents; leaving it in place';
end
$$;

commit;
