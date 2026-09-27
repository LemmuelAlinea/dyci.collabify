-- Collabify — each person's own colours (Settings → Appearance).
--
--   node scripts/db.mjs supabase/appearance.sql
--
-- A person can recolour a short, fixed list of things for themselves: the page
-- banners, the status set (done, in progress, late, pending), the sidebar
-- icons, progress bars and notification badges — separately for light and
-- dark. The list is fixed on purpose. Everything else keeps the design system's
-- colours, so no choice here can break a layout.
--
-- Two tables, both visible to their owner only. Not columns on `profiles`:
-- classmates and faculty can read a profile row, and a colour scheme is
-- nobody's business but the person who picked it.
--
--   user_appearance      the colours in use now, one row per person
--   appearance_palettes  palettes they saved by name, to go back to later
--
-- `colors` is {"light": {key: "#rrggbb"}, "dark": {...}}; a missing key means
-- the default. `valid_palette_colors` rejects any other key and anything that
-- is not a six-digit hex, so the column can never carry CSS the page would
-- then set on <html>.
--
-- Runs after trash.sql and before anon-lockdown.sql. Idempotent.

begin;

create or replace function public.valid_palette_colors(c jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(c) = 'object'
     and not exists (
       select 1 from jsonb_each(c) m
        where m.key not in ('light', 'dark')
           or jsonb_typeof(m.value) <> 'object'
           or exists (
                select 1 from jsonb_each(m.value) e
                 where e.key not in ('banner', 'bannerAccent', 'success', 'warning', 'danger',
                                     'pending', 'navIcon', 'navActive', 'progress', 'badge')
                    or jsonb_typeof(e.value) <> 'string'
                    or (e.value #>> '{}') !~ '^#[0-9a-f]{6}$'))
$$;

-- ---------------------------------------------------------------- in use now

create table if not exists public.user_appearance (
  user_id    uuid primary key default auth.uid()
             references public.profiles (id) on delete cascade,
  colors     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_appearance_colors_valid check (public.valid_palette_colors(colors))
);

alter table public.user_appearance enable row level security;

drop policy if exists user_appearance_own on public.user_appearance;
create policy user_appearance_own on public.user_appearance
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.user_appearance from public, anon;
grant select, insert, update, delete on public.user_appearance to authenticated;

-- ---------------------------------------------------------------- saved palettes

create table if not exists public.appearance_palettes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
             references public.profiles (id) on delete cascade,
  name       text not null,
  colors     jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appearance_palettes_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint appearance_palettes_colors_valid check (public.valid_palette_colors(colors))
);

create unique index if not exists appearance_palettes_user_name
  on public.appearance_palettes (user_id, lower(btrim(name)));

alter table public.appearance_palettes enable row level security;

drop policy if exists appearance_palettes_own on public.appearance_palettes;
create policy appearance_palettes_own on public.appearance_palettes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.appearance_palettes from public, anon;
grant select, insert, update, delete on public.appearance_palettes to authenticated;

-- Twelve saved palettes each. The lock makes two tabs saving at once count
-- each other instead of both seeing eleven.
create or replace function public.appearance_palettes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('appearance_palettes:' || new.user_id::text));
    if (select count(*) from public.appearance_palettes where user_id = new.user_id) >= 12 then
      raise exception 'You can keep 12 saved palettes. Delete one to save another.'
        using errcode = 'check_violation';
    end if;
  elsif new.user_id <> old.user_id then
    raise exception 'A palette stays with the person who saved it.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists appearance_palettes_guard on public.appearance_palettes;
create trigger appearance_palettes_guard
  before insert or update on public.appearance_palettes
  for each row execute function public.appearance_palettes_guard();

commit;
