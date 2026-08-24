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
 *
 * **A notice is visible for 24 hours and then it is not.** The program office
 * announces things that are true for a day — classes suspended, a defense
 * moved, a deadline the registrar shifted — and a dashboard that still carries
 * last month's suspension teaches everybody to stop reading the section. The
 * window is enforced by `program_notices` rather than by the pages, so there is
 * no view of the product where an old notice is still on somebody's dashboard.
 *
 * The clock runs from `created_at`, not from `updated_at`: editing a notice
 * that has already gone corrects the record, it does not re-announce it. To
 * say a thing again, say it again.
 *
 * Nothing is deleted. `program_notices_all` keeps every notice for the chair,
 * because "what did the office announce last term" is a real question and the
 * answer should not be "whatever is still inside the window".
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
--
-- Pinning orders the notices inside the 24-hour window; it does not exempt one
-- from it. A pin that outlived the window would be the one stale notice on
-- every dashboard, which is the thing the window exists to prevent.
create unique index if not exists program_announcements_one_pin
  on public.program_announcements ((true)) where pinned;

-- The window filter reads this; the index above leads with `pinned`.
create index if not exists program_announcements_live_idx
  on public.program_announcements (created_at desc);

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

/**
 * What is on a dashboard right now: the last 24 hours, newest first, pinned
 * before the rest.
 *
 * The window lives here and not in the pages that read it. A page could forget
 * it, a second page could implement it differently, and neither would be
 * visible until somebody noticed a month-old notice on a student's dashboard.
 */
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
  join public.profiles p on p.id = a.author_id
 where a.created_at > now() - interval '24 hours';

revoke all on public.program_notices from anon;
grant select on public.program_notices to authenticated;

-- ------------------------------------------------------------- the record

drop view if exists public.program_notices_all;

/**
 * Every notice the office has ever sent, for the office alone.
 *
 * The chair needs this to answer "what did we announce, and when" and to take
 * down something posted in error after its day has passed. `expired` says which
 * side of the window a notice is on, so the console can show what is live now
 * without recomputing the rule and getting it slightly different.
 *
 * `security_barrier` for the same reason as above — the chair shares a class
 * with nobody, so reading `profiles` as the caller returns nothing. The gate is
 * `is_admin()` in the where clause, and it is the only thing standing between
 * this and everybody, so it does not move.
 */
create view public.program_notices_all
with (security_barrier = true) as
select a.id,
       a.title,
       a.body,
       a.pinned,
       a.created_at,
       a.edited_at,
       a.author_id,
       btrim(p.first_name || ' ' || p.last_name) as author_name,
       p.avatar_url as author_avatar,
       (a.created_at <= now() - interval '24 hours') as expired
  from public.program_announcements a
  join public.profiles p on p.id = a.author_id
 where public.is_admin();

revoke all on public.program_notices_all from anon;
grant select on public.program_notices_all to authenticated;

commit;
