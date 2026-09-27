-- Collabify — one-workplace cleanup.
--
--   node scripts/db.mjs supabase/cleanup.sql
--
-- Runs after one-workplace.sql and before anon-lockdown.sql. Removes the old
-- sign-in landing state now that every account lands in the one shell.

begin;

do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'professor'
  ) and not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'faculty'
  ) then
    alter type public.user_role rename value 'professor' to 'faculty';
  end if;
end
$$;

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
