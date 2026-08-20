-- Collabify — the third role is called `admin`, not `superadmin`.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/admin-rename.sql

/**
 * A rename, and nothing else changes hands: the same person keeps the same
 * powers under a shorter name.
 *
 * Two things do not follow the enum automatically and have to be rewritten by
 * hand here:
 *
 *   - A function body is stored as text. `role = 'superadmin'` inside one is an
 *     untyped literal cast at execution, so after the label is renamed it stops
 *     matching anything and starts raising instead.
 *   - A call by name, `public.is_superadmin()`, likewise.
 *
 * Policies are the exception: they hold the function's OID, so renaming the
 * function carries all four of them along without being touched.
 */

begin;

do $$ begin
  if exists (
    select 1 from pg_enum
     where enumtypid = 'public.user_role'::regtype and enumlabel = 'superadmin'
  ) then
    alter type public.user_role rename value 'superadmin' to 'admin';
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'is_superadmin') then
    alter function public.is_superadmin() rename to is_admin;
  end if;
end $$;

/** The program admin. Same test, shorter name. */
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;

/** Role and status are the admin's to set, and nobody else's. */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  -- Pinned back rather than raised: a client that tries this is not owed an
  -- error message describing the rule it just failed to break.
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

create or replace function public.decide_professor(
  p_user    uuid,
  p_approve boolean
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin approves professor accounts'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role <> 'professor' then
    raise exception 'Only professor accounts go through approval'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set status     = case when p_approve then 'active' else 'rejected' end::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

commit;
