# Build "Spaces" for Collabify's General workplace

You are being handed a feature to build in an existing codebase. This document
is the whole brief: the product, the rules, what already exists, the design, the
traps, and how to prove it works. Read it all before writing anything.

---

## 1. What you are building

Today, General projects are one flat list. There is no container above a project
and no way to keep two sets of work apart.

Add one: a **Space**.

- A space holds projects. Everything a project already holds — tasks, files,
  progress, members, teams, positions, the join code — stays exactly where it is.
  **Nothing inside a project changes.**
- **Everyone in a space can read every project in it.** Writing still requires
  project membership. A space member who is not on a project reads it completely
  and changes nothing.
- People join a space by **invitation or join code**, the same two doors a
  project already has.
- Projects from one space must never be visible in another.
- Add an **archive page** for archived projects.
- Convert the top bar into a **collapsible left sidebar** carrying a space
  switcher and a project tree, so somebody can jump from one project's Files to
  another project's Tasks without going back to a list.

### Why "space" and not "workplace"

The word "workplace" is already taken in this codebase and means something else.
`public.workplace` is a Postgres enum with two values — Education and General —
and `profiles.home_workplace` is which one a user lands in. A second meaning
would be a bug factory. Everything user-facing says **space**: "Create space",
"Your spaces", "Space members".

---

## 2. The product

Collabify is a project-management web app for BSIT programs in the Philippines,
at Dr. Yanga's Colleges. It has two halves:

- **Education** — classes, groups, projects, tasks, submissions, grading.
  Roles: `student`, `professor`, `admin`.
- **General** — a lighter, role-free workplace for anything that is not a class:
  student council, intramurals, research, outreach. This is the half you are
  changing.

### Stack

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite 7, React Router |
| Styling | Tailwind CSS v4, **tokens only, no config file** |
| Backend | Supabase — Postgres 17.6, Auth, Storage, Realtime, pg_cron |
| Animation | Motion (`motion/react`) |
| Tests | vitest (node environment, pure logic only) + SQL suites |
| Hosting | Vercel |

### Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run typecheck
npm run test
npm run check        # typecheck && lint && test && build && contrast && a11y-names && schema-drift && motion-lint && legal-ready
node scripts/db.mjs supabase/<file>.sql      # run SQL as superuser
node scripts/db.mjs -c "select 1"            # run one statement
```

`scripts/db.mjs` reads `SUPABASE_DB_URL` from `.env.local`, which is gitignored.

**Lint baseline is 23 warnings, 0 errors.** Run it as:

```bash
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
```

(The plain `npm run lint` picks up a stray untracked file in `docs/redesign/`
and reports 3 spurious `no-undef` errors. Ignore that file.)

---

## 3. Rules you must follow

These come from the project's `CLAUDE.md` and are not negotiable.

**Design system.** Never hardcode a colour. Everything reads tokens from
`src/styles/index.css`: surfaces `surface` / `surface-raised` / `surface-sunken`;
text `text-ink` / `text-muted` / `text-faint`; lines `border-line` /
`border-line-strong`; brand ramps `navy-*` (600 is the brand) and `amber-*` (400
is the accent). Light and dark are defined in the same block, so a raw hex breaks
one of them.

**Type.** Display face `font-display` (Outfit), body `font-sans` (Instrument
Sans), utility `font-mono` (JetBrains Mono) for eyebrows and numerals. `.eyebrow`
for small mono uppercase labels, `.shell` for page gutters, `.blueprint` for the
grid motif.

**Dark mode** is the `.dark` class on `<html>`, set pre-paint by an inline script
in `index.html`. Never switch on a media query alone.

**Motion** goes through `components/motion/Reveal.tsx` or Motion's
`useReducedMotion`. Reduced motion must stay honoured. `npm run motion-lint`
enforces this.

**Layout order: desktop first, then tablet, then phone.** Not a widened mobile
column.

**Copy style:** sentence case, active voice, no exclamation marks, no "please",
no "successfully". Errors say what happened and what to do next.

**SQL files must stay idempotent** — they get re-run.

**Security invariants:**
- `role` and `status` are changeable only by an admin, enforced by the
  `profiles_guard_privileged` trigger, not just by UI.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend
  code, in Vercel, or in any committed file. Never print them.
- Avatar uploads are scoped to `avatars/<user-id>/…` by storage policy.

**Conventions:**
- Auth state comes from `useAuth()`; theme from `useTheme()`.
- New protected pages go inside `<ProtectedRoute>` + `<AppShell>` in `App.tsx`.
- Every RPC is `security definer set search_path = public`, followed by
  `revoke all on function … from public, anon` and
  `grant execute … to authenticated`.

---

## 4. What already exists

**Read this section carefully — some of this work is done.**

A branch named `general-spaces` exists with two commits, and **the database
migration has already been applied to the live Supabase database.**

| Commit | What it did |
|---|---|
| `d9f5efd` | `supabase/general-spaces.sql` + `supabase/tests/general-spaces.test.sql`. The tables, helpers, migration, the read widening, the RPCs. 53 passing assertions. |
| `a5efc4a` | The space-aware pages: routes, picker, space home, members, archive. |

`main` carries only the design document
(`docs/superpowers/specs/2026-09-20-general-spaces-and-sidebar-design.md`).

**Live database state:** the space tables exist, `general_projects.space_id` is
`not null`, the seven existing projects sit in one space named after their
creator, and twenty SELECT policies already point at
`can_read_general_project`.

So: **Section 6 (the data model) and Section 7 (the pages) are built.**
**Section 8 (the sidebar) is not.** Decide with the repo owner whether to build
on that branch or start again; if you start again, you must first roll the
database back, which means dropping the new tables and the `space_id` column and
re-running `supabase/general.sql`, `supabase/general-tasks.sql` and
`supabase/general-repo.sql` to restore the original policies.

---

## 5. The one decision that matters

This is the load-bearing part of the whole feature. Get it wrong and you leak
personal data.

Roughly 25 General tables gate their SELECT policy on
`is_general_member(project_id)` — meaning "there is a row for me in
`general_members`":

```sql
create or replace function public.is_general_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;
```

"Everyone in a space reads every project in it" means a space member who is *not*
a project member must get past those policies.

### Do NOT widen `is_general_member`

It also backs this, which decides who may read a **profile row** — and profile
rows carry **email addresses**:

```sql
create or replace function public.shares_general_project_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_viewer_active() and exists (
    select 1
      from public.general_members mine
      join public.general_members theirs on theirs.project_id = mine.project_id
     where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;
```

Widening `is_general_member` would hand every space member the email address of
every person in every project in that space. **An email leak of exactly this
shape has already shipped in this codebase once.**

### Do this instead

Add a second function and move only the **SELECT** policies to it:

```sql
create or replace function public.can_read_general_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_general_member(p_project)
      or public.is_general_space_member(
           (select space_id from public.general_projects where id = p_project));
$$;
```

- **SELECT** policies on project-scoped tables → `can_read_general_project`.
- **INSERT / UPDATE / DELETE** policies, and `general_has` / `general_can`, stay
  keyed on `general_members.level`. Untouched.
- `shares_general_project_with` stays keyed on `is_general_member`. Untouched.

Result: a space member reads everything and writes nothing, and profile
visibility does not change at all.

### Exactly twenty policies move

Eighteen tables carry a plain `project_id` and can be done in one loop, the same
shape `supabase/general.sql` already uses for teams and positions:

```sql
do $$
declare
  t text;
begin
  foreach t in array array[
    'general_members', 'general_teams', 'general_team_members',
    'general_positions', 'general_position_holders', 'general_grants',
    'general_fields',
    'general_tasks', 'general_task_assignees', 'general_task_comments',
    'general_task_files', 'general_task_logs', 'general_task_events',
    'general_repos', 'general_commits', 'general_blobs',
    'general_repo_changes', 'general_repo_comments'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.can_read_general_project(project_id))',
      t || '_select', t);
  end loop;
end $$;
```

Two are shaped differently and are written out by hand. `general_projects`
must keep its pending-invitation door, or somebody invited to a project can no
longer see what they were invited to:

```sql
drop policy if exists general_projects_select on public.general_projects;
create policy general_projects_select on public.general_projects
  for select using (
    public.can_read_general_project(id)
    or (
      public.general_viewer_active()
      and exists (
        select 1 from public.general_invitations i
         where i.project_id = general_projects.id
           and i.invitee = auth.uid() and i.status = 'pending'
      )
    )
  );

drop policy if exists general_field_values_select on public.general_field_values;
create policy general_field_values_select on public.general_field_values
  for select using (
    public.can_read_general_project(public.general_field_project(field_id)));
```

**Five are deliberately left alone.** Do not touch them:

| Policy | Why it stays narrow |
|---|---|
| `general_join_codes_select` | a space member must not be handed the code to join a project they are only watching |
| `general_access_requests_select` | own row, or the project's Owner |
| `general_invitations_select` | own row, or whoever may invite |
| `general_drafts_own` | a person's own unsubmitted work |
| `general_draft_files_own` | likewise |
| `profiles_select_general_peer` | the email guard — the whole reason for the function split |

---

## 6. Piece one — the data model

One new file, `supabase/general-spaces.sql`, idempotent, wrapped in a single
`begin; … commit;`.

### Tables

```sql
create table if not exists public.general_spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  created_by  uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_spaces_name_len check (char_length(btrim(name)) between 1 and 80)
);

create table if not exists public.general_space_members (
  space_id  uuid not null references public.general_spaces (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  level     public.general_level not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);
```

Plus `general_space_invitations` and `general_space_join_codes`, shaped exactly
like the existing `general_invitations` and `general_join_codes` in
`supabase/general.sql`, including the partial unique index enforcing one pending
invitation per person:

```sql
create unique index if not exists general_space_invitations_one_pending
  on public.general_space_invitations (space_id, invitee) where status = 'pending';
```

**Reuse the existing enums** `public.general_level` (`owner` / `manager` /
`member`) and `public.general_invite_status` (`pending` / `accepted` /
`declined` / `withdrawn`). Do not create new ones — adding a value to a Postgres
enum requires its own committed transaction, and nothing here needs it.

### Levels

| | Owner | Manager | Member |
|---|---|---|---|
| Rename, describe, archive the space | ✅ | | |
| Invite, join code, remove, change level | ✅ | ✅ | |
| Create a project in the space | ✅ | ✅ | ✅ |
| Read every project in the space | ✅ | ✅ | ✅ |

Mirror the project helpers in `supabase/general.sql`, including the `has` / `can`
split — `has` ignores archiving so a refused write can still reach a message
saying why, `can` is what a policy uses:

`is_general_space_member`, `is_general_space_owner`,
`general_space_is_archived`, `general_space_has_manage`,
`general_space_can_manage`, `general_space_has_invite`,
`general_space_can_invite`.

### The migration

`space_id` is added nullable, backfilled, and set `not null` **in one
transaction**. A previous migration in this project split a two-step change
across two transactions; the second step failed on a dependency, and the re-run
folded live data in twice, duplicating documents in two real projects. One
transaction.

Guard the whole thing on "is there a project without a space", so it runs once
and is a no-op forever after — including for spaces users create themselves,
which a re-run must never touch.

**Before backfilling, refuse to guess.** One space per creator is only private
if that creator's projects all have the same people in them. If creator A has P1
(members A, B) and P2 (members A, C), folding both into A's space shows B a
project they were never on:

```sql
select count(*) into stray from (
  select created_by
    from (
      select p.created_by,
             (select array_agg(m.user_id order by m.user_id)
                from public.general_members m
               where m.project_id = p.id) as members
        from public.general_projects p
       where p.created_by is not null
    ) s
   group by created_by
  having count(distinct members) > 1
) t;

if stray > 0 then
  raise exception 'Cannot place existing projects into spaces: % creator(s) own projects with different member lists. …', stray
    using errcode = 'check_violation';
end if;
```

The subquery must live in a derived table — `p.id` is not in the `group by`, so
the obvious one-statement version does not parse.

Then: one space per creator, named `<first_name> <last_name>'s space` (there is
no `full_name` column on `profiles`), falling back to `My space`. Every existing
member of that creator's projects joins the space, the creator as `owner` and
everyone else as `member`.

### RPCs

`create_general_space`, `update_general_space`, `archive_general_space`,
`set_general_space_join_code`, `join_general_space`, `invite_to_general_space`,
`respond_general_space_invitation`, `withdraw_general_space_invitation`,
`set_general_space_level`, `remove_general_space_member`,
`list_my_general_space_invitations`, `list_general_space_invitations`,
`list_general_space_members`, `list_general_project_members`.

Copy the join-code and join-by-code logic from `set_general_join_code` and
`join_general_project` in `supabase/general.sql` verbatim, including:

- the alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no `0/O` or `1/I/L`, because a
  code gets read aloud across a room;
- the `rate_limit` call taken **before** the code is read, so a wrong guess still
  costs an attempt;
- returning `null` on a miss rather than raising, so the rate-limit count is not
  rolled back by the failure.

The last-Owner rules: an Owner cannot be demoted or removed if they are the only
Owner whose account is not deactivated. Lock every Owner row before counting, or
two Owners stepping down at once can each see the other still there.

### `create_general_project` gains a space

It is currently defined in three files and the last one wins
(`supabase/general-files.sql`). Redefine it in your new file; do not edit the
older ones.

**Put `p_space uuid` last, with a default of `null`**, and drop the old
signature explicitly:

```sql
drop function if exists public.create_general_project(text, text, date, date, text, jsonb);
```

Two reasons for both details. Adding an overload rather than replacing makes
every existing call ambiguous. And defaulting `p_space` to null — resolving it to
the caller's own space, creating one if they have none — is what lets this file
land on its own, before any page knows what a space is. Without that, applying
the migration breaks project creation on the deployed frontend until the pages
ship.

When a space **is** named, raise unless the caller is a member of it and it is
not archived.

### Deleting a space

There is no delete RPC. `general_projects.space_id` cascades, so dropping a
space would drop every project in it and everything inside them. **Spaces
archive**, like projects do.

### The view that will catch you out

`general_project_overview` **inner-joins the caller's own membership row** to
produce `my_level`:

```sql
  from public.general_projects p
  join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
```

Widening the table policies is therefore **not enough on its own**: a space
member can read `general_projects` and still get nothing back from the view.
Change it to a `left join`, which makes `my_level` null for somebody watching
through the space.

`create or replace view` can only **append** columns, so keep the existing column
list identical and in the same order. Append `space_id` last — the pages need it
to filter by space.

Then fix the client, which assumed a level was always there:
- `src/lib/general/types.ts` — `my_level: GeneralLevel | null`
- `src/lib/general/permissions.ts` — `levelLabel` must take null
- `generalCan(level: GeneralLevel | null, …)` already handles null. Check every
  other caller does too.

Every other General view (`general_task_overview`, `general_repo_tree`,
`general_repo_overview`) selects straight from its table and needs no change.
All of them are `security_invoker = true`, so swapping the table policies is
what makes them work.

### Tests

`supabase/tests/general-spaces.test.sql`, following the 31 existing suites. They
use a rollback harness — `begin;` … `rollback;` with `pg_temp.act_as(uuid)` to
switch users and `pg_temp.ok(label, boolean)` to assert. Copy the top of
`supabase/tests/general-schedule.test.sql`.

Most of this file should be the **negative** half:

- A space member who is not a project member reads the project, its tasks, its
  files, its members and its progress view.
- The same person cannot insert, update or delete any of it — one test per verb.
- The same person cannot read the project's join code.
- The same person cannot read a project member's profile row (the email guard).
- …but `list_general_project_members` still gives them names.
- A stranger reads nothing.
- A project invitee with no space membership still sees the project.
- Join code: wrong code is a miss, a closed code no longer works.
- The last Owner cannot step down or leave.
- Leaving a space ends the read it granted, but a project membership of your own
  survives it.
- An archived space takes no new projects and cannot be renamed, but is still
  readable.
- `create_general_project` refuses a space the caller is not in.

### Register the file

Add `general-spaces` to the `ORDER` array in `scripts/schema-drift.mjs` and the
apply chain in `docs/07-backup.md`.

---

## 7. Piece two — the pages

### Routes

In `src/App.tsx`, inside the existing `<ProtectedRoute workplace="general">`:

| Route | Page |
|---|---|
| `/general` | redirects to your last space, or the picker |
| `/general/spaces` | every space you are in, plus create and join |
| `/general/spaces/:spaceId` | the space home — its live projects |
| `/general/spaces/:spaceId/members` | members, invitations, join code |
| `/general/spaces/:spaceId/archive` | archived projects in this space |
| `/general/projects/:projectId` | **unchanged** |

**Project routes stay flat.** A project id is globally unique, so nesting it
under a space buys nothing and would break every existing link, every
notification deep link and every `?tab=` URL already in the wild.

`/general` must keep working — it is linked from the nav and from notifications.
Make it a component that redirects to the last-used space.

The last space is remembered in `localStorage`, but **must be validated against
your actual memberships before use**, or leaving a space strands you on a page
you can no longer read. With no remembered space and exactly one space, go
there; with none or several, show the picker. `localStorage` throws in a private
window — wrap every read and write in try/catch.

### Pages

- The existing `src/pages/general/GeneralHome.tsx` becomes the space home:
  `useParams` for `spaceId`, projects from a space-filtered query, and the
  archived-project filter removed.
- New: a space picker, a space members page, a space archive page.
- Filter projects **in the database**, not in the page. A space member can read
  every project in every space they are in, so filtering client-side would pull
  all of them down to show one space's worth.

**Drop the "include archived" checkbox** from the projects list. Archived work
is worth keeping and worth reading back, but it is not what somebody is looking
at on a Tuesday — a page you visit deliberately beats a filter that changes a
list in place.

Reuse rather than rebuild: `Modal`, `ConfirmDialog`, `Tabs`, `useLive`,
`useToast`, `authErrorMessage`, `Reveal`, `DirectoryHero`, `EmptyState`,
`FilterPopover`, and the members/invitations/join-code UI already written for
projects — the space versions are the same screens against different tables.

Component gotchas: `Textarea` is exported from `components/ui/Select.tsx`, not
`Field.tsx`. `Avatar` takes `{first_name, last_name, avatar_url}` and no `id`.
`ConfirmDialog` owns its own busy state and calls `onClose` itself — let
`onConfirm` throw and it will show the error. `PersonHit` uses `person_id`, not
`id`.

### The quiet breakage

`listGeneralMembers` reads names through an embedded `profiles` join. Profiles
deliberately did **not** widen — so somebody reading a project through its space
gets `profile: null` on every row and a list of nameless people.

Fix it by backfilling from `list_general_project_members`, which any reader may
call and which never returns an email. Take their `status` as active: it is only
read to decide whether a write is safe, and that reader cannot write at all.

---

## 8. Piece three — the sidebar (not yet built)

### The shell

`src/components/app/AppShell.tsx` becomes a two-column flex: sidebar, then
`<main>`. It already renders the whole nav vertically in its phone drawer
(`DrawerNav`) — that component is the sidebar, pulled out.

- Extract `DrawerNav` into `src/components/app/SideNav.tsx`. The drawer renders
  it and the desktop column renders it. One renderer, so the two cannot drift.
- Persistent from `lg:` up. Below that the phone drawer stays exactly as it is,
  including `useFocusTrap` and the `Escape` handler.
- Collapsed state: 64px, icons only, an accessible name on every row, real
  tooltips. Persist it in `localStorage`; `aria-expanded` on the toggle.
- `AppShell` sets `overflow-x-clip` — keep it. Re-tune `<main>`'s gutters
  (currently `px-4 … 2xl:px-20`) now that the column is not full width.

`src/components/app/TopNav.tsx` keeps the logo, search, theme toggle, account
menu and the phone drawer button. Its nav-group rendering is **deleted**, not
duplicated.

### What the sidebar holds

1. `WorkplaceSwitcher` — Education ↔ General, unchanged component.
2. **General only** — a Space row showing the current space with a chevron.
   Clicking it opens a modal listing your spaces with a **Create space** button.
   Use the existing `Modal` with focus trapping, not a bespoke popover.
3. **General only** — a **Projects** section: every project in the current
   space, each collapsible into **Overview · Tasks · Files · Progress ·
   Members**, linking to `/general/projects/:id?tab=…`. This is the "hop between
   projects from anywhere" the whole request is about.
4. **General only** — an **Archive** row for the current space.
5. The role's nav groups from `src/components/app/nav.ts`, unchanged.

The tree costs no new reads: the space's project list is already loaded, and the
five tab rows are static links.

### `nav.ts` stays static

```ts
export type NavItem = {
  label: string
  icon: IconName
  to?: string
  soon?: boolean
  badge?: 'messages'
}
export type NavGroup = { title: string; items: NavItem[] }
```

`to` is a plain string, and rows 2–4 all need the current space id, so they
cannot live in `nav.ts`. The sidebar's General block builds them from the loaded
space.

This also settles a stale link: `GENERAL_NAV`'s Projects row points at
`/general`, which only redirects after piece two. `GENERAL_NAV` shrinks to
**Messages** plus the shared `SETTINGS` group; Projects and Archive become
space-scoped rows the block renders itself.

**Education keeps `BY_ROLE` exactly as it is** and renders rows 1 and 5 only.
The sidebar replaces the top bar in both workplaces — one shell, so a student
does not learn two products. The professor's rail is the tallest thing it will
hold (four groups plus Account), so that is the one to check for scrolling at
768px height.

---

## 9. Traps, learned the hard way

Every one of these has already cost this project real time or real data.

1. **A migration and the constraint it enables must share one transaction.** A
   split one failed halfway and a re-run duplicated live data.
2. **`create or replace view` can only append columns.** Changing the middle of
   the column list silently fails or errors.
3. **A new enum value needs its own committed transaction.** Avoid new enums.
4. **`CASE … THEN` inside an `IF` condition does not parse in PL/pgSQL.** A
   `CASE` returning string literals needs an explicit enum cast.
5. **`NULL = 'capstone'` is null, not false.** Use `is not distinct from`. This
   exact bug broke creation of every non-preset project.
6. **Postgres applies the SELECT policy to UPDATE/DELETE only when the statement
   reads columns.** A zero-row write has three possible causes — the row is
   gone, the project is archived, or permission was lost — and the message must
   not assert the third. This bug shipped in four separate files.
7. **Realtime does not apply RLS to DELETE events.**
8. **Views here are `security_invoker = true`,** so table policies flow through
   them — but an inner join on `auth.uid()` inside the view will still filter
   everything out.
9. **The plan's own code is a detailed draft, not a verified one.** On the last
   comparable feature, review found nine real defects in code that looked
   finished. Write the tests and run them.

---

## 10. Definition of done

- `node scripts/db.mjs supabase/general-spaces.sql` applied **twice**; the second
  run is a no-op.
- The new SQL suite passes, and every existing suite still does. (Note:
  `supabase/tests/reports.test.sql` has one pre-existing failure — it picks a
  live class and asserts it has no archived projects, which is no longer true.
  It is unrelated to this work.)
- `npm run typecheck`, `npm run test`, `npm run build` green.
- Lint at **23 warnings, 0 errors** with the ignore pattern above.
- `npm run schema-drift`, `contrast`, `a11y-names`, `motion-lint` green.
- **In a browser, signed in:**
  - Create a second space. It shows none of the first space's projects.
  - Create a project in it. It appears there and nowhere else.
  - Archive a project, find it on the archive page, restore it.
  - As a second account joined to the space but not the project: every page of
    that project reads correctly, every edit control is **absent** rather than
    present-and-failing, and no email is visible anywhere.
  - The sidebar: expand two projects and jump from one project's Files to
    another's Tasks without touching a list page.
  - 375px, 1024px and 1440px; both themes; keyboard only, including the space
    modal's focus trap and `Escape`; reduced motion on.

**Do not create test data in the live database without asking.** There is one
live database and no staging.

---

## 11. Deliberately out of scope

- **Moving a project between spaces.** Real, and its own design — it has to
  reconcile two member sets, and the honest version asks what happens to people
  who lose access.
- Nested spaces, space templates, per-space branding.
- Space-level positions and grants. If a space ever needs them, that is the
  project's model copied, not extended.
- Education gaining spaces. Classes already are its container.
