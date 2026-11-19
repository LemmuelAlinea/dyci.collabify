# Active now in the Inbox — design

Date: 2026-11-20. Status: approved.

## Intent

Like Messenger's active list: the Inbox shows which of the people you share a place with are online right
now, and tapping one opens a direct chat with them. Today only a teacher can start a direct message, and
only with their own students; this widens direct messages to anyone you share a place with.

## Goals

- An "Active now" strip in the Inbox: people you share a place with who are online, with a green dot.
- Tapping a person opens (or creates) your direct chat with them.
- Everyone gets it: students, teachers, members, stakeholders, the admin (when they share a place).
- A person can hide their active status.

## Non-goals

- Typing indicators, read receipts, "seen" on messages.
- Blocking or reporting a person (see Risks).
- Presence anywhere outside the Inbox (task pages, member lists). Easy to add later from the same data.
- Instant (sub-second) dots.

## Anti-goals

- Anyone learning who is online beyond the people they share a place with.
- A hidden person showing up anywhere, even by id.
- Spending realtime channels: the 12-per-tab cap in `useLive.ts` stays for the live views.

## Who counts as a contact (decided)

Two people are contacts when both accounts are active and admitted and they share at least one live place:

- **Class**: both active members of the same class, or one teaches it (`is_class_professor`, so co-teachers
  count) and the other is an active student or teacher in it. Groups sit inside a class, so group mates are
  covered.
- **Work space**: both members of the same live work space (`general_space_members`).
- **Work project**: both members of the same live work project (`general_members`), stakeholders and QA
  included.

*My call:* archived or trashed classes, spaces and projects do not count, and neither do rejected or removed
memberships. A class's own space does not count as a work space (classes count through `class_members`), so
one teacher's space never links students across different classes.

## Approaches

- **A. One shared Supabase Presence channel.** Instant dots and one channel per tab, but every signed-in
  person could see who is online school-wide, and the hide switch would only be enforced by the browser.
- **B. One Presence channel per class, space and project.** Instant and correctly scoped, but a teacher in
  ten places uses up the 12-channel cap and the rest of the app falls back to polling.
- **C. Heartbeat (chosen).** Each open tab records a last-seen time about once a minute, and a database
  function returns only your contacts. The database enforces every rule, as the rest of Collabify does, the
  hide switch is real, and "Active 5m ago" comes for free. Dots can lag up to about a minute. Chosen by the
  user after comparing it with how Messenger works (a server-side last-seen plus filtering to friends).

## Design

### Database: `supabase/active-status.sql`

Runs after `send-to-planner.sql` and before `anon-lockdown.sql`; it is added to the run lists in
`docs/07-backup.md` and to `CLAUDE.md`. It redefines nothing another file owns.

- Table `user_presence`: `user_id` (pk, references profiles, on delete cascade), `last_seen_at timestamptz`,
  `show_active boolean not null default true`. RLS on, no policies: it is read and written only through the
  functions below. *My call:* a side table rather than columns on `profiles`, so a write once a minute never
  touches `profiles_guard_privileged`, `updated_at` or anything that listens to `profiles`.
- `shares_place(a uuid, b uuid) returns boolean`: the contact rule above, in one place.
- `touch_presence()`: sets the caller's `last_seen_at = now()`. It skips the write when the last one was less
  than 45 seconds ago, and stores nothing while `show_active` is off.
- `set_active_status(p_show boolean)`: the caller's own switch. Turning it off clears `last_seen_at`.
- `my_active_contacts()`: returns `id`, display name, `avatar_url` and `last_seen_at` for contacts who have
  `show_active` on and were seen within the last hour, newest first. *My call:* like Messenger, a person who
  hides their own status sees nobody else's either (the function returns no rows for them).
- `start_contact_conversation(p_person uuid)`: opens or creates the direct chat when `shares_place(me,
  p_person)` is true. It reuses the `direct_key` format of `start_direct_conversation` (`least|greatest`), so a
  teacher and student keep one thread whichever of them starts it. `start_direct_conversation` and the
  teacher's New message dialog stay as they are.
- Suite: `supabase/tests/active-status.test.sql`. It covers each place type, archived and removed exclusions,
  the class-space exclusion, hiding (both directions), the 45-second skip, a stranger refused by
  `start_contact_conversation`, and the same thread from either side.

### App

- **Heartbeat**: a hook in `AppShell` (active, admitted accounts only) calls `touch_presence` on mount, every
  60 seconds while the tab is visible, and on focus or a return to the tab. A hidden tab stops writing, so a
  forgotten tab goes quiet within a couple of minutes.
- **Active now strip**: at the top of the Inbox's conversation list, a horizontal row of avatars with names
  under them, which scrolls sideways when there are many. A green `presence` dot means seen in the last 2
  minutes; otherwise a small muted "12m" label shows. It reads `my_active_contacts` through `useLive` with a
  60-second poll and no realtime tables. It is hidden when nobody qualifies.

  ```
  Active now
  (●AB) (●CD) (●EF) (GH 12m) (IJ 40m)  →
  ─────────────────────────────────────
  Classes …
  ```
- **Tap**: calls `start_contact_conversation`, reloads conversations and navigates to the thread, the same
  way `NewDirectDialog`'s `onStarted` does.
- **Direct rows**: *my call:* a direct conversation in `ConversationList` also gets the green dot when that
  person is active now (same data, no extra request).
- **Settings → Profile**: a switch, "Show when you're active". The note under it says that turning it off
  also hides other people's active status from you.
- Copy: "Active now", "Active 5m ago", "Show when you're active". Sentence case, no exclamation marks.
- Layout: desktop first. The strip sits inside the 320–360 px list column; on a phone it is the same row at
  the top of the full-width list.

## Constraints

- Tokens only: `bg-presence` (already defined for light and dark), `text-muted` and `text-faint`.
- Motion through `Reveal` or `useReducedMotion`; the strip needs none.
- `npm run build` and the SQL suite pass; the live database gets the new file, then `anon-lockdown.sql`.

## Risks

- **Student-to-student direct chats are new**, and a teacher cannot see or moderate them (moderation covers
  class and group chats only). Blocking and reporting are not part of this work; worth deciding before
  launch whether that is acceptable.
- Write load: one small, skipped-when-recent write per signed-in tab per minute. Light at a school's scale.

## Left to the builder

- The exact status values that mean "removed" or "rejected" in each membership table.
- How many avatars to show before scrolling, and the strip's empty-state behavior beyond hiding.
- Whether `ConversationList` takes the active ids as a prop or reads them from a shared hook.
