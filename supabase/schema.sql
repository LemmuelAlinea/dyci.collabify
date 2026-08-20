-- Collabify — phase 1 schema (profiles, notification prefs, avatars, RLS).
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/schema.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.user_role as enum ('student', 'professor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_status as enum ('active', 'pending', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.theme_mode as enum ('light', 'dark', 'system');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  first_name  text not null default '',
  middle_name text,
  last_name   text not null default '',
  role        public.user_role   not null default 'student',
  status      public.account_status not null default 'active',
  avatar_url  text,
  theme       public.theme_mode  not null default 'system',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_status_idx on public.profiles (role, status);

create table if not exists public.notification_prefs (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  task_assignments   boolean not null default true,
  deadline_reminders boolean not null default true,
  comments_mentions  boolean not null default true,
  project_invites    boolean not null default true,
  progress_digest    boolean not null default false,
  announcements      boolean not null default true,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

-- Security definer so RLS policies can ask "is this caller an admin?"
-- without re-entering the policy on public.profiles and recursing.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists notification_prefs_touch on public.notification_prefs;
create trigger notification_prefs_touch before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

-- New auth user -> profile + default notification prefs.
-- Role and names ride in on raw_user_meta_data from the signup form.
-- Google users arrive with no role, so they get no profile row and the app
-- routes them to /onboarding to pick one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_role text := nullif(new.raw_user_meta_data ->> 'role', '');
  resolved_role public.user_role;
begin
  if meta_role is null or meta_role not in ('student', 'professor') then
    return new;
  end if;

  resolved_role := meta_role::public.user_role;

  insert into public.profiles (id, email, first_name, middle_name, last_name, role, status, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'middle_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    resolved_role,
    case when resolved_role = 'professor' then 'pending' else 'active' end::public.account_status,
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
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

-- ---------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.notification_prefs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists prefs_select_own on public.notification_prefs;
create policy prefs_select_own on public.notification_prefs
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists prefs_insert_own on public.notification_prefs;
create policy prefs_insert_own on public.notification_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists prefs_update_own on public.notification_prefs;
create policy prefs_update_own on public.notification_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A user must not be able to promote themselves or self-approve. Column-level
-- guard: role/status may only change when an admin is doing the update.
create or replace function public.guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged before update on public.profiles
  for each row execute function public.guard_privileged_columns();

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

-- Files live under <user-id>/… so a user can only touch their own folder.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
