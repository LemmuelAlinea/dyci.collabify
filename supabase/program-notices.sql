-- Collabify — one notice from the program office, to everybody in it.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/program-notices.sql

/**
 * A class announcement reaches one class. A chair sometimes has to reach the
 * whole program — a defense schedule, a suspension of classes, a deadline the
 * registrar moved — and today that means messaging every professor and asking
 * them to repeat it.
 *
 * This is deliberately a separate table from `announcements` rather than a
 * nullable `class_id` on it. Every policy, index and trigger on that table
 * assumes a class; making the column optional would weaken each of them at
 * once, and the pinned-per-class index would quietly become pinned-per-null.
 *
 * Who may do what:
 *
 *   - **Anybody signed in may read.** A notice to the program is a notice to
 *     everyone in it; there is nothing to scope.
 *   - **Only an admin may write.** The chair speaks for the program office and
 *     nobody else does, so insert, update and delete are all `is_admin()`.
 *
 * It carries no attachment. A class announcement takes files because coursework
 * needs them; a program notice that needs a file needs a class.
 */

begin;

create table if not exists public.program_announcements (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_announcements_title_present check (length(btrim(title)) > 0),
  constraint program_announcements_body_present check (length(btrim(body)) > 0)
);

create index if not exists program_announcements_recent_idx
  on public.program_announcements (pinned desc, created_at desc);

-- One pinned notice at a time. Two things at the top of everybody's dashboard
-- is neither of them being the important one.
create unique index if not exists program_announcements_one_pin
  on public.program_announcements ((true)) where pinned;

alter table public.program_announcements enable row level security;

drop policy if exists program_announcements_read on public.program_announcements;
create policy program_announcements_read on public.program_announcements
  for select using (auth.uid() is not null);

drop policy if exists program_announcements_write on public.program_announcements;
create policy program_announcements_write on public.program_announcements
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.program_announcements to authenticated;
grant insert, update, delete on public.program_announcements to authenticated;

drop trigger if exists program_announcements_touch on public.program_announcements;
create trigger program_announcements_touch before update on public.program_announcements
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ the notice

/**
 * Everybody active, minus whoever wrote it, and minus anybody who turned
 * announcements off. The same `notification_prefs.announcements` switch the
 * class notifier respects — a person who muted announcements meant all of them.
 */
create or replace function public.notify_program_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, preview)
  select p.id,
         'announcement',
         new.title,
         left(regexp_replace(new.body, '\s+', ' ', 'g'), 140)
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
   where p.status = 'active'
     and np.announcements
     and p.id <> new.author_id;
  return new;
end;
$$;

drop trigger if exists program_announcements_notify on public.program_announcements;
create trigger program_announcements_notify after insert on public.program_announcements
  for each row execute function public.notify_program_announcement();

-- ---------------------------------------------------------------- reading

/**
 * The notice with the name of whoever sent it.
 *
 * Not `security_invoker`, and the join is the reason. `profiles_select_own`
 * lets somebody read a profile only if they share a live class with it, and the
 * chair shares a class with nobody — so read as the caller this view returned
 * no rows at all to the students it was written for. The only thing it opens is
 * the name and avatar of whoever signed a notice everybody is meant to read.
 */
drop view if exists public.program_notices;

create view public.program_notices
with (security_barrier = true) as
select a.id,
       a.title,
       a.body,
       a.pinned,
       a.created_at,
       a.edited_at,
       a.author_id,
       btrim(p.first_name || ' ' || p.last_name) as author_name,
       p.avatar_url as author_avatar
  from public.program_announcements a
  join public.profiles p on p.id = a.author_id;

revoke all on public.program_notices from anon;
grant select on public.program_notices to authenticated;

commit;
