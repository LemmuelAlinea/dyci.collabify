# Spaces, and a sidebar to move around them

## Context

General projects today are a flat list. `/general` shows every project you are a
member of, in one column, with an "Include archived" toggle — a student's thesis
sits beside an org's intramurals with nothing to say they are different kinds of
work. There is no container above a project and no way to keep two sets of work
apart.

This adds one: a **Space**. A space holds projects, and everything a project
already holds — tasks, files, progress, members, teams, positions, the join code
— stays exactly where it is. Nothing about the inside of a project changes.

Alongside it, navigation moves from the top bar to a **collapsible left sidebar**
carrying a space switcher and a project tree, so somebody can jump from one
project's Files to another project's Tasks without going back to a list first.

### The word "space"

"Workplace" is already taken. `public.workplace` is the enum with two values,
Education and General; `profiles.home_workplace` is which one you land in;
`src/lib/workplace.ts` and `WorkplaceSwitcher` toggle between them. A second
meaning for the same word would be a bug factory. Everything user-facing says
**space**: "Create space", "Your spaces", "Space members".

### Decisions already taken

| Question | Answer |
|---|---|
| What is the container called? | **Space** |
| Who sees a project in a space? | **Everyone in the space**, read-only unless they are also a project member |
| How do people join a space? | **Invitation and join code** — the same two doors a project already has |
| Where do today's projects go? | **One space per creator**, with a safety check (below) |
| Does the sidebar replace the top bar in Education too? | **Yes** — one shell, both workplaces |
| How is this delivered? | **One spec, three sequenced plans** |

## Scope of the read change

This is the load-bearing part, so it is stated before anything else.

Today, roughly 25 General tables gate their SELECT policy on
`is_general_member(project_id)` — a row in `general_members`. "Everyone in the
space sees every project" means a space member who is *not* a project member must
be able to read that project and its contents.

**Do not widen `is_general_member`.** It is also used by
`shares_general_project_with`, which decides who may read a profile row — and
profile rows carry email addresses. Widening it would hand every space member the
email of every person in every project in that space. That exact leak has already
shipped once in this codebase.

Instead add a second function and swap only the SELECT policies to it:

```sql
create or replace function public.can_read_general_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project)
      or public.is_general_space_member(public.space_of_project(p_project));
$$;
```

- **SELECT** policies on project-scoped tables → `can_read_general_project`.
- **INSERT / UPDATE / DELETE** policies, and `general_has` / `general_can`, stay
  keyed on `general_members.level`. Untouched.
- `shares_general_project_with` stays keyed on `is_general_member`. Untouched.

Result: a space member reads every project in the space and writes to none of
them, and profile visibility does not change at all.

`general_level(p_project)` returns null for a space-only viewer. Check
`src/lib/general/permissions.ts` and every caller handles a null level as "no
permissions" rather than throwing — this is the client-side half of the same
change and the most likely place for a runtime error.

---

# Plan 1 — Spaces in the database

`supabase/general-spaces.sql`, idempotent, one file.

### Tables

```sql
create table public.general_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint general_spaces_name_len check (char_length(btrim(name)) between 1 and 80)
);

create table public.general_space_members (
  space_id uuid not null references public.general_spaces (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  level    public.general_level not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
```

Plus `general_space_invitations` and `general_space_join_codes`, shaped exactly
like `general_invitations` (`supabase/general.sql:176`) and
`general_join_codes` (`:74`), including the partial unique index on one pending
invitation per person.

Reuse `public.general_level` and `public.general_invite_status`. No new enums —
a new enum value needs its own committed transaction, and none is needed here.

### Space permissions

Three levels, each earning its place:

| | Owner | Manager | Member |
|---|---|---|---|
| Rename, describe, archive the space | ✅ | | |
| Invite, join code, remove, change level | ✅ | ✅ | |
| Create a project in the space | ✅ | ✅ | ✅ |
| Read every project in the space | ✅ | ✅ | ✅ |

Helper functions mirroring the project set in `supabase/general.sql:215-277`:
`is_general_space_member`, `is_general_space_owner`, `general_space_is_archived`,
`general_space_level`, `general_space_has`, `general_space_can`, and
`space_of_project(p_project uuid)`.

### The column, and the migration

`general_projects.space_id` is added nullable, backfilled, and set `not null`
**in one transaction**. A previous migration in this project split a two-step
change across two transactions, the second step failed, and a re-run folded live
data in twice. One transaction.

One space per creator. Every existing member of that creator's projects joins
that creator's space: the creator at `owner`, everyone else at `member`.

**Before backfilling, refuse to guess.** If any creator has two projects whose
member sets differ, merging them into one space would show person B a project
they were never in. The migration runs this first and raises if it returns a row:

```sql
select created_by
  from (
    select p.created_by,
           (select array_agg(m.user_id order by m.user_id)
              from public.general_members m
             where m.project_id = p.id) as members
      from public.general_projects p
  ) s
 group by created_by
having count(distinct members) > 1;
```

The subquery has to be in a derived table, not inline in the `having`: `p.id` is
not in the `group by`, so the obvious one-statement version does not parse.

Verified today: all 7 live projects have exactly one member and one creator, so
this returns nothing and the backfill produces one space holding all 7. The check
stays in the file anyway, because the data can change before it runs.

Space named `<first_name> <last_name>'s space` — `public.profiles` has no
`full_name` column — falling back to `My space` when both are blank.

### RPCs

- `create_general_space(p_name, p_description)` — creates, makes the caller owner.
- `set_general_space_join_code(p_space, p_open, p_regenerate)` — copy of
  `set_general_join_code` (`supabase/general.sql:915`), same alphabet with no
  `0/O/1/I/L`, same `rate_limit` call.
- `join_general_space(p_code)` — copy of `join_general_project`
  (`:969`), same rate limit counted *before* the code is read.
- `invite_to_general_space` / `answer_general_space_invitation`.
- `remove_general_space_member`, `set_general_space_level` — an owner cannot
  demote or remove the last owner.
- `archive_general_space(p_space, p_archived)`.
- `create_general_project` gains a **first** parameter `p_space uuid`. It is
  currently defined in three files — `general.sql:658`, `presets.sql:39`,
  `general-files.sql:464` — and the last one wins. Redefine the
  `general-files.sql` version inside `general-spaces.sql`; do not edit the older
  ones. It must raise unless the caller is a member of `p_space` and the space is
  not archived.

Every RPC `security definer`, `set search_path = public`, and
`revoke all … from public, anon`.

### Deleting a space

`on delete cascade` from `general_projects.space_id` means dropping a space drops
every project in it and everything inside them. **There is no delete RPC.**
Spaces archive, like projects do. Archiving a space hides it from the switcher
and makes `general_space_can` false, so the whole space goes read-only.

### Tests

`supabase/tests/general-spaces.test.sql`, following the 31 suites already there:

- A space member who is not a project member **reads** the project, its tasks,
  its files, its members and its progress view.
- The same person **cannot** write any of them — one negative test per verb.
- The same person **cannot** read the project members' profile emails.
- A stranger to the space reads nothing.
- A project invitee with no space membership still reads the project (the
  existing pending-invitation path in `general_projects_select` survives).
- Join code: wrong code fails, rate limit trips, a closed code fails.
- The last owner cannot be demoted or removed.
- Archiving a space makes every project inside it read-only.
- The pre-migration safety check fires on planted divergent data.
- `create_general_project` refuses a space the caller is not in.

### Registration

Add `general-spaces` to the `ORDER` array in `scripts/schema-drift.mjs`, after
`general-schedule-guard`. Add the file to `docs/07-backup.md`.

### Verification

- `node scripts/db.mjs supabase/general-spaces.sql` twice; the second run is a
  no-op. Use the standard SQL shell preamble; never print `SUPABASE_DB_URL`.
- New suite passes; all 464 existing assertions across 31 suites still pass.
- Migration proof, read back from live: 7 projects, 1 space, 1 owner, 0 orphans,
  and `space_id is not null` on every row.
- `npm run check` green; lint holds at 23 warnings / 0 errors.

---

# Plan 2 — General becomes space-aware

Depends on Plan 1. No sidebar yet — this plan keeps the existing top bar and
proves the data model through the pages.

### Routes

`src/App.tsx:117-122`, inside the existing `<ProtectedRoute workplace="general">`:

| Route | Page |
|---|---|
| `/general` | redirects to your last space, or the picker |
| `/general/spaces` | every space you are in, plus Create and Join |
| `/general/spaces/:spaceId` | the space home — its projects (today's `GeneralHome`) |
| `/general/spaces/:spaceId/members` | space members, invitations, join code |
| `/general/spaces/:spaceId/archive` | archived projects in this space |
| `/general/projects/:projectId` | **unchanged** |

**Project routes stay flat.** A project id is globally unique, so nesting it
under a space would buy nothing and would break every existing link, every
notification deep link, and every `?tab=` URL already in the wild. The space is
derived from the project.

Last space remembered in `localStorage`, validated against your memberships on
read — a stale id must fall through to the picker, not to a blank page.

### Pages and components

- `src/pages/general/GeneralHome.tsx` becomes the space home. Its archived-project
  filter (`:90-94`) moves out to the archive page; the `showArchived` toggle goes.
- New: `SpacePicker.tsx`, `SpaceMembers.tsx`, `SpaceArchive.tsx`.
- New: `src/components/general/SpaceDialog.tsx` (create / rename),
  `JoinSpace.tsx`.
- `src/lib/api/general.ts` gains the space calls; project calls carry `space_id`.
- New: `src/hooks/useGeneralSpaces.ts` beside the existing General hooks.

Reuse rather than rebuild: `Modal`, `ConfirmDialog`, `Tabs`, `useLive`,
`useToast`, `authErrorMessage`, `Reveal`, and the whole members/invitations/join
code UI already written for projects — the space versions are the same screens
against different tables.

### Archive page

Archived projects in the current space, newest first, with who archived them and
when. Restoring is an owner action and uses the existing project-archive RPC.
This page is the reason the `showArchived` toggle can go: an archive somebody
visits deliberately beats a checkbox that changes a list in place.

### Verification

- `npm run check` green, lint holding.
- Browser, signed in: create a second space; create a project in it; confirm the
  first space's projects are not listed in it and vice versa; archive a project
  and find it on the archive page; restore it.
- Second account: join by code, see every project in the space, open one, and
  confirm every edit control is absent rather than present-and-failing.
- 375px and 1440px, both themes, no page-level sideways scroll.

---

# Plan 3 — The sidebar

Depends on Plan 2 for the tree's content. Touches both workplaces.

### The shell

`src/components/app/AppShell.tsx` becomes a two-column flex: sidebar, then
`<main>`. It already renders the whole nav vertically in its phone drawer
(`DrawerNav`, `:30-108`) — that component is the sidebar, pulled out.

- New `src/components/app/SideNav.tsx`, extracted from `DrawerNav` verbatim, then
  extended. The drawer renders it; the desktop column renders it. One renderer,
  so the two can never drift.
- Persistent from `lg:` up. Below that the phone drawer stays exactly as it is,
  including `useFocusTrap` and the `Escape` handler.
- Collapsed state: 64px, icons only, accessible name on every row, real tooltips.
  Persisted in `localStorage`; `aria-expanded` on the toggle. Motion through
  `Reveal` or `useReducedMotion` — reduced motion stays honoured.
- `overflow-x-clip` on the shell (`:175`) stays. `<main>`'s gutters
  (`:255`) are re-tuned now that the column is not full width.

`src/components/app/TopNav.tsx` keeps the logo, search, theme toggle, account
menu, and the phone drawer button. Its nav-group rendering is deleted, not
duplicated — the file should get materially shorter.

### What the sidebar holds

Top to bottom:

1. `WorkplaceSwitcher` — Education ↔ General, unchanged component.
2. **General only —** a Space row showing the current space with a chevron.
   Clicking it opens a modal listing your spaces with a **Create space** button;
   choosing one switches and closes. The modal is the existing `Modal` with focus
   trapping, not a bespoke popover.
3. **General only —** a **Projects** section: every project in the current space,
   each collapsible into **Overview · Tasks · Files · Progress · Members**,
   linking to `/general/projects/:id?tab=…`. This is the "hop between projects
   from anywhere" the request is really about.
4. **General only —** an **Archive** row for the current space.
5. The role's nav groups from `src/components/app/nav.ts`, unchanged.

**`nav.ts` stays static.** `NavItem.to` is a plain string (`nav.ts:5-13`), and
rows 2–4 all need the current space id, so they cannot live there — the sidebar's
General block builds them from the loaded space. This also settles a stale link:
`GENERAL_NAV`'s Projects row points at `/general` (`nav.ts:161`), which after
Plan 2 only redirects. `GENERAL_NAV` shrinks to **Messages** plus `SETTINGS`;
Projects and Archive become space-scoped rows the block renders itself. Education
keeps `BY_ROLE` exactly as it is.

The tree costs no new reads: the space's project list is already loaded, and the
five tab rows are static links.

Education renders steps 1 and 5 only. The professor's rail is the tallest
thing the sidebar will hold — four groups plus Account — so it is the one to
check for scrolling at 768px height.

### Verification

- `npm run check` green, lint holding at 23/0.
- `npm run motion-lint` and `npm run a11y-names` green — the collapsed rail is
  exactly the case those two catch.
- Browser, signed in, **both workplaces and all three Education roles**: 375px,
  1024px, 1440px; both themes; sidebar expanded and collapsed; keyboard only,
  including the space modal's focus trap and `Escape`.
- Reduced motion on: no slide, no layout shift.
- The tree: expand two projects, jump from one project's Files to another's
  Tasks without touching a list page.

---

## Out of scope

Recorded so the decisions are on file rather than rediscovered:

- **Moving a project between spaces.** Real, and its own design — it has to
  reconcile two member sets, and the honest version asks what happens to people
  who lose access.
- **Nested spaces**, space templates, per-space branding.
- **Space-level roles above the three above.** If a space ever needs its own
  positions and grants the way a project does, that is the project's model
  copied, not extended here.
- **Education gaining spaces.** Classes already are its container.
