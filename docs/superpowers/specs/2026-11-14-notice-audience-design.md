# Admin upgrade, phase 4: notices by office or group

Date: 2026-11-14. Status: approved in conversation. Phases 1–3 (offices, offboarding, office heads)
are live.

## Why

Program notices go to every active account and show only on professor and student Homes. The
school's offices now run work in Collabify, so the admin needs to reach one office ("Registrar
only") or one group ("all students") without notifying everyone, and office staff who don't teach
should see the notices meant for them on their own Home.

## Goals

- Each notice has one audience: **Everyone**, chosen **Offices**, or chosen **Groups**.
- The database enforces it: only the audience (and the admin) can read a notice, and only the
  audience is notified.
- The notice card shows on every Home that should show it: professor, student, the regular member
  Home and the stakeholder Home.
- The admin sees each notice's audience and how many people a new one will reach.

## Non-goals

- Office heads sending notices (they stay read-only).
- Scheduled or expiring notices.
- Combining offices and groups in one audience.
- Changing a sent notice's audience (title and body stay editable).
- Class announcements (a class's own notices are unchanged).

## Anti-goals

- **A notice reaches or is readable by someone outside its audience**, through the app, the views,
  realtime or a direct query.
- **Existing notices change who sees them.** They become Everyone.
- **A notice aimed at nobody.** Sending refuses an empty office or group list.

## Decisions made with the user

- Audience is one of Everyone / Offices / Groups (rejected: offices and groups combined; offices only).

## Decisions I made (open to overturn)

- **Groups:** Students (`role = 'student'`), Teaching faculty (`role = 'member'` and `can_teach`),
  Office staff (`role = 'member'` and not `can_teach`). Every active non-admin account is in exactly
  one group.
- **Notification at send time** to the current audience; **the card at read time**, so someone filed
  into an office later sees that office's live notices.
- **Pin:** still one at a time, shown only to its audience.
- **Admin Home** doesn't get the card; the Notices page is the admin's view.

## Approaches

1. **Audience columns on the notice, one shared membership check used by the read policy, the
   views and the notifier, and an admin-only reach count (chosen).**
2. Filtering in the browser: anyone could read every notice through the database.
3. A row per recipient: takedowns and edits fan out, and "read at read time" is lost.

## Design

### Data (`supabase/notice-audience.sql`, new; after `office-heads.sql`, before `anon-lockdown.sql`)

It needs `offices` / `office_members`, so it cannot live in `program-notices.sql` (which runs much
earlier). It takes ownership of four objects from `program-notices.sql` — the read policy, the two
views and the notifier — so re-running `program-notices.sql` means re-running this file after it.

- Columns on `program_announcements` (`add column if not exists`): `audience text not null default
  'everyone'` checked in (`everyone`, `offices`, `groups`); `audience_offices uuid[] not null
  default '{}'`; `audience_groups text[] not null default '{}'` with elements in (`students`,
  `teaching`, `staff`). A check: `offices` needs a non-empty office list and an empty group list,
  `groups` the reverse, `everyone` both empty. Existing rows default to everyone.
- `notice_reaches(p_notice program_announcements, p_user uuid) returns boolean` (stable, security
  definer): true for everyone; for offices, the person's `office_members` row is in the list; for
  groups, the person's group (above) is in the list. Inactive accounts: false (pending accounts can't
  open a Home today anyway). It must stay executable by `authenticated`, because the read policy,
  the `program_notices` view and Realtime's RLS check call it as the caller. So that nobody can probe
  another person's office or group with a hand-built row, it answers false unless `p_user =
  auth.uid()` or the caller is an admin (the notifier runs with the authoring admin's identity).
- Read policy `program_announcements_read` becomes `is_admin() or notice_reaches(row, auth.uid())`.
- `program_notices` (the Home view) keeps its columns and adds `audience`, filtering by
  `notice_reaches(a, auth.uid())` (it is `security_barrier` and not invoker, so the filter must be in
  the view). `program_notices_all` (admin) adds `audience`, `audience_offices`, `audience_groups` and
  the office names.
- `notify_program_announcement` notifies `notice_reaches(new, p.id)` instead of every active person,
  keeping the author exclusion and the announcements switch.
- Writes stay admin-only (existing policy). A trigger refuses an update that changes the audience
  columns: "A sent notice keeps its audience. Take it down and send a new one."
- `admin_notice_reach(p_audience text, p_offices uuid[], p_groups text[]) returns int`: active
  admin only; *my call:* exactly the number the notifier would notify — active accounts in the
  audience with announcements on, excluding the sending admin (other admins count when the audience
  is Everyone) — for the existing "This will notify N people" line.
- `rate-limit.sql`'s refusal copy says a notice "reaches every professor and student"; this file
  doesn't own that function, so the copy fix is noted in Deferred unless it is a string the app
  shows (the builder checks; if the app shows it, the app maps it).
- Suite `supabase/tests/notice-audience.test.sql`.

### App

- `lib/api/program.ts`: `postNotice` takes `audience`, `audienceOffices`, `audienceGroups`;
  `noticeReach(...)`; types carry the audience fields.
- **Notices page** (`pages/app/admin/Notices.tsx`): the compose dialog gets **Send to** (Everyone /
  Offices with a multi-select of live offices / Groups with three checkboxes) and the live reach
  count; confirm is disabled for an empty choice; each sent notice shows its audience ("Everyone",
  office names, or group names); editing shows the audience read-only.
- **ProgramNotices** (`components/app/ProgramNotices.tsx`) already reads `program_notices`, which
  now filters by audience. *My call* on placement (`Home.tsx` has no single member Home): add it to
  `WaitingHome` (a member with no work yet — new office staff land here), to `WorkOverview` only
  when `standalone` (the non-teaching member Home; the stacked work view under the professor and
  student Homes must not show it twice), and to `StakeholderHome`. Professor and student Homes keep
  it as today.
- **Existing bug, fixed here:** `listAllNotices` in `lib/api/program.ts` orders by an `expired`
  column that `program_notices_all` hasn't had since commit d64601c (the live view confirms it), so
  the admin Notices list fails to load today. Drop that order.

### Tests

- SQL: each audience kind reaches exactly the right accounts (students, teaching, staff, office
  members, someone in no office); an inactive account and an author are never notified; a person
  outside the audience reads nothing through the table, `program_notices`, or a direct select; the
  admin reads all; an office audience with an empty list, a group outside the three, or mixed lists
  are refused; changing a sent notice's audience is refused; title/body edits still work; existing
  notices read as everyone; `admin_notice_reach` matches the notified count and refuses non-admins;
  someone filed into an office after sending sees the notice.
- Frontend: Send to choices and the reach line; confirm disabled when empty; the audience label on
  each notice; the card on the member and stakeholder Homes.

## Left to the builder

- The multi-select control for offices (reuse an existing pattern).
- The exact wording of audience labels, within the copy rules.
