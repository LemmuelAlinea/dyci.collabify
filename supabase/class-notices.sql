-- Collabify — a class announcement is for a day, like a program notice.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/class-notices.sql

/**
 * The same rule the program office already lives under, now for the professor:
 * an announcement is on a student's screen for 24 hours and then it is not.
 *
 * A class announcement is a thing that is true today — the room has moved, the
 * deadline slipped, bring a laptop on Thursday. A feed that still carries last
 * month's room change teaches the class to stop reading the feed, which costs
 * more than the announcement was ever worth.
 *
 * **Enforced in the policy, not in a view.** The program notices took a view
 * because they were already read through one. These are read straight from the
 * table with PostgREST embedding — `attachments:announcement_attachments(...)`
 * and `author:profiles(...)` — and those relationships are resolved against the
 * base table. A view would have to redeclare every one of them, and the first
 * page anybody forgot to move would keep showing everything.
 *
 * Who sees what, after this file:
 *
 *   a student            the last 24 hours, and nothing older
 *   the class professor  all of them, always — they wrote them, they manage
 *                        them, and "what did I tell this class in October" is
 *                        a real question
 *   the program office   all of them, unchanged
 *
 * The clock runs from `created_at`. Editing an announcement whose day has gone
 * corrects the record; it does not put it back on anybody's screen. To say a
 * thing again, say it again.
 *
 * Nothing is deleted. This is a visibility rule, and the professor's own feed
 * is the record.
 */

begin;

-- The window filter reads this; the existing index leads with `pinned`.
create index if not exists announcements_live_idx
  on public.announcements (class_id, created_at desc);

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (
    -- The professor of the class keeps the whole history.
    public.is_class_professor(class_id)
    or (
      public.is_active_member(class_id)
      and exists (select 1 from public.classes c where c.id = class_id and c.archived_at is null)
      -- ...a student gets the day.
      and created_at > now() - interval '24 hours'
    )
  );

commit;
