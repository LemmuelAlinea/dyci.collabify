-- Collabify — a class announcement stays on the class feed until it is taken down.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/class-notices.sql

/**
 * Class announcements used to leave a student's screen after 24 hours. They no
 * longer do: an announcement stays on the class feed, and on a student's
 * dashboard, until the professor deletes it.
 *
 * What replaced the window is length, not time. A long announcement is shown
 * shortened with a "See more" that opens the whole of it in a dialog, so a
 * dashboard that keeps announcements does not turn into a wall of text.
 *
 * Who sees what:
 *
 *   a student            every announcement of a class they are active in
 *   the class professor  all of them, as before
 *   the program office   all of them, unchanged
 *
 * A class that has been archived still shows its students nothing, as before.
 *
 * This file used to narrow `announcements_select` to the last 24 hours. It now
 * puts the policy back to the one `classes.sql` defines, so running it on a
 * database that still has the narrowed policy lifts the window.
 */

begin;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (
    public.is_class_professor(class_id)
    or (
      public.is_active_member(class_id)
      and exists (select 1 from public.classes c where c.id = class_id and c.archived_at is null)
    )
  );

-- The window filter's index is no longer read by anything special; the plain
-- (class, newest first) order is still what the feed asks for.
create index if not exists announcements_live_idx
  on public.announcements (class_id, created_at desc);

commit;
