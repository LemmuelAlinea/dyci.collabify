# Admin upgrade, phase 3: office heads

Date: 2026-11-14. Status: approved in conversation. Phases 1 (offices, overview) and 2
(offboarding) are live.

## Why

Offices run their own work, and the person who leads one (the registrar's chief, the IT head)
should see how their office is doing without being an admin and without asking the admin for
figures. Phase 1 decided the head is read-only.

## Goals

- The admin names one head per office, from that office's own active members.
- The head gets a **My office** page: their office's figures, the projects that need attention, its
  spaces and its people, by name.
- The admin sees each office's head on the Offices page and Admin Home.

## Non-goals

- A head changing anything (accounts, offices, spaces, PMs, notices). Notices by office is phase 4.
- Several heads or deputies per office.
- Heads for students or admins.
- Any new read inside a project.

## Anti-goals

- **The head reads inside a project they are not on.** Only names, counts, the quiet date and the
  no-PM reason reach them, exactly what Admin Home shows the admin. Projects they are on link as
  usual; others are plain names.
- **Another office's data reaches a head.** Every head read answers for the caller's own office only.
- **A head seat outlives the head's place in the office** and keeps showing the page.

## Decisions made with the user

- **Counts plus names** on My office (rejected: counts only; names plus each project's PM).
- **One head per office** (rejected: several heads).

## Approaches

1. **A `head_id` column on `offices`, admin-only setter, and head-only read functions that share the
   admin's logic through an internal helper (chosen).**
2. A separate heads table: only needed for several heads.
3. Loosening the phase 1 admin reads to also admit heads: one mistake would open the whole
   organization to a head.

## Design

### Data

- **`supabase/offices.sql` (owner, edited):** extract the attention logic of
  `admin_attention_projects` into an internal, ungated helper `office_attention_rows()` (revoked
  from `authenticated`) returning the same columns; `admin_attention_projects` keeps its signature
  and gate and selects from it. No behaviour change; the phase 1 suite must still pass.
- **`supabase/office-heads.sql` (new; after `offboarding.sql`, before `anon-lockdown.sql`):**
  - `alter table offices add column if not exists head_id uuid references profiles(id) on delete
    set null`.
  - `set_office_head(p_office uuid, p_user uuid)` (null clears): active admin only; the office is
    live; the person is an active `member` filed in that office (`office_members`). Writes a new
    `office_head_changed` audit row (subject the office, before/after the head names, `''` for none).
  - **Seat clears itself** (*my call*), by a trigger on `office_members` (delete, or update to
    another office) and the existing role trigger path: when the head leaves the office or stops
    being a member, `head_id` is set null and `office_head_changed` is written with a null actor.
    A deactivated head keeps the seat, but every read treats an inactive head as no head.
    Archiving an office clears its head.
  - `my_headed_office()` returns `(office_id uuid, office_name text)` for the caller when they are
    the active head of a live office; zero rows otherwise.
  - Head reads, each answering for the caller's headed office only (zero rows otherwise):
    `my_office_overview()` (spaces, running_projects, people, needs_attention — the same counts as
    that office's `admin_org_overview` row), `my_office_attention()` (project_id, project_name,
    space_name, no_pm, quiet_since, plus `i_am_on boolean` so the page can link only those),
    `my_office_spaces()` (space_id, space_name, running_projects; live spaces), `my_office_people()`
    (id, name; active members filed in the office).
  - `admin_office_heads()` returns `(office_id, head_id, head_name)` for the admin (active heads
    only), for the Offices page and Admin Home.
- Suite `supabase/tests/office-heads.test.sql`.

### App

- **Offices page** (`OfficeDetail`): a **Head** select listing the office's active members plus
  "No head", calling `set_office_head`; refusals shown as-is.
- **Admin Home** Offices band: the head's name under each office (or "No head").
- **Rail:** a member who heads an office gets a **My office** entry (icon `briefcase`) in their
  main group, linking to `/office` (new path `paths.office`). The rail reads `my_headed_office()`
  once, alongside the membership it already loads.
- **My office page** (`pages/app/MyOffice.tsx`, inside `ProtectedRoute` + `AppShell`, members
  only): the banner names the office; four bands (figures, needs attention, spaces, people), each
  with its own loading, empty and failed-with-retry state, in Admin Home's band style. A project
  line links to the project only when `i_am_on`. Someone who is not a head is sent Home.
- Audit log labels `office_head_changed` ("Office head changed").

### Tests

- SQL: only an admin sets a head; the head must be an active member of that office; a student,
  an admin, a member of another office and an inactive member are refused; moving the head to
  another office, removing their office or making them a student clears the seat and audits it;
  archiving clears it; an inactive head reads as none and their reads return nothing; every head
  read returns only the head's office and nothing to anyone else (another office's head, a member,
  the admin); the counts match `admin_org_overview` for that office; `i_am_on` is true only for
  projects the head is a member of; the phase 1 suite still passes after the helper extraction.
- Frontend: the Head select; the rail shows My office only for a head; the page renders each band
  and its failure on its own; a project line links only when `i_am_on`.

## Left to the builder

- Component split for the My office page.
- Whether the rail's head check joins an existing hook or adds a small one.
