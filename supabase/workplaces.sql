-- Collabify — two workplaces.
--
--   node scripts/db.mjs supabase/workplaces.sql
--
-- Everything that existed before this file is the Education workplace. The
-- General workplace is for projects anybody at the school runs, and needs no
-- student or professor role. One account uses both; `home_workplace` is only
-- where sign-in lands.
--
-- `role` becomes nullable: null means the account has not entered Education.
-- Entering it later goes through `enter_education`, once, and a professor still
-- waits for approval exactly as at registration.
--
-- Runs after consent.sql, whose `handle_new_user` this redefines as a superset,
-- and after admin-rename.sql, whose `guard_privileged_columns` it redefines.

begin;

do $$ begin
  create type public.workplace as enum ('education', 'general');
exception when duplicate_object then null; end $$;

alter table public.profiles
  add column if not exists home_workplace public.workplace not null default 'education';

alter table public.profiles alter column role drop not null;
alter table public.profiles alter column role drop default;

-- ---------------------------------------------------------------- privilege guard

/**
 * Role and status are the admin's to set, with one exception: an account that
 * has no role may take student or professor once, through `enter_education`.
 * That function raises a transaction-local flag; the flag is not reachable
 * through the REST interface, and even with it the guard still insists the
 * status matches the role, so a professor can never arrive active.
 */
create or replace function public.guard_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Computed before the IF, not inside it: PL/pgSQL ends an IF condition at
  -- the first THEN it meets, including the THEN inside a CASE expression.
  wanted public.account_status;
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    wanted := case when new.role = 'professor' then 'pending' else 'active' end;
    if old.role is null
       and old.status = 'active'
       and current_setting('collabify.enter_education', true) = 'on'
       and new.role in ('student', 'professor')
       and new.status = wanted then
      return new;
    end if;
    -- Pinned back rather than raised: a client that tries this is not owed an
    -- error message describing the rule it just failed to break.
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

/**
 * Onboarding writes the profile row itself, and `profiles_insert_own` checks
 * nothing but the id. Without this a Google account could insert itself as an
 * active admin, or as a professor who skipped approval.
 */
create or replace function public.guard_profile_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'You can only create your own profile'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is not null and new.role not in ('student', 'professor') then
    raise exception 'Choose student or professor'
      using errcode = 'check_violation';
  end if;
  new.status := case when new.role = 'professor' then 'pending' else 'active' end
                ::public.account_status;
  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert before insert on public.profiles
  for each row execute function public.guard_profile_insert();

-- ---------------------------------------------------------------- signup

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  meta_workplace text := nullif(new.raw_user_meta_data ->> 'workplace', '');
  resolved_role public.user_role;
  doc text;
  ver text;
begin
  /**
   * Consent first, and outside the role check.
   *
   * A Google account arrives with no role and returns early below, but it can
   * still carry consent versions if it ever comes through a path that collects
   * them. Putting this after the early return would make that silently do
   * nothing.
   */
  foreach doc in array array['privacy', 'terms'] loop
    ver := nullif(new.raw_user_meta_data ->> ('consent_' || doc), '');
    if ver is not null then
      if not exists (
        select 1 from public.legal_versions
         where document = doc and version = ver
      ) then
        raise exception
          'Consent to unpublished % version %. Add it to legal_versions in supabase/consent.sql.',
          doc, ver
          using errcode = 'foreign_key_violation';
      end if;

      insert into public.consent_records (user_id, document, version, surface)
      values (new.id, doc, ver, 'register')
      on conflict (user_id, document, version) do nothing;
    end if;
  end loop;

  -- General needs no role, and nobody approves it.
  if meta_workplace = 'general' then
    insert into public.profiles
      (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
    values (
      new.id,
      coalesce(new.email, ''),
      coalesce(new.raw_user_meta_data ->> 'first_name', ''),
      nullif(new.raw_user_meta_data ->> 'middle_name', ''),
      coalesce(new.raw_user_meta_data ->> 'last_name', ''),
      null,
      'active',
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      'general'
    )
    on conflict (id) do nothing;

    insert into public.notification_prefs (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    return new;
  end if;

  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles
    (id, email, first_name, middle_name, last_name, role, status, avatar_url, home_workplace)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    'education'
  )
  on conflict (id) do nothing;

  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- entering Education

create or replace function public.enter_education(p_role public.user_role)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('student', 'professor') then
    raise exception 'Choose student or professor' using errcode = 'check_violation';
  end if;

  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null then
    raise exception 'Finish setting up your account first';
  end if;
  if me.status = 'rejected' then
    raise exception 'This account is deactivated. Contact the program admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if me.role is not null then
    raise exception 'You already have a role in Education. The program admin can change it.'
      using errcode = 'check_violation';
  end if;

  perform set_config('collabify.enter_education', 'on', true);
  update public.profiles
     set role = p_role,
         status = case when p_role = 'professor' then 'pending' else 'active' end
                  ::public.account_status
   where id = auth.uid()
  returning * into me;
  perform set_config('collabify.enter_education', 'off', true);

  return me;
end;
$$;

grant execute on function public.enter_education(public.user_role) to authenticated;

commit;
