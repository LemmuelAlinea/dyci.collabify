# Handoff to Codex: the one-workplace project

Written 2026-09-27 by Claude (Claude Code) for Codex, which continues this work on the owner's own computer, in this same checkout.

`main` is at `2540f9f` or later and is pushed to `origin` (`github.com/LemmuelAlinea/dyci.collabify`). The working tree was clean when this was written.

This is **the single entry point**. It supersedes `docs/superpowers/CONTINUE-one-workplace.md`, which was written for a Claude cloud session. Read this file top to bottom before touching anything.

---

## 0. TL;DR

- **The effort.** "One workplace" merges the app's two worlds (Education = classes, General = spaces and projects) into one, where a *space* is either **education** (a class) or **work**.
- **Status.** Phases 1, 2, 3a and 3b are **built, reviewed, tested and pushed**. Phases 1 and 2 were also browser-checked by the owner. **Phases 3a and 3b have not been browser-checked yet.**
- **Your next three things, in order:**
  1. Help the owner run the **browser walk** for 3a + 3b (§6 Step A). They sign in; you never do.
  2. Ask the owner the **one open question** (§6 Step B).
  3. **Plan, then build, phase 4 (cleanup)** (§6 Step C). No plan exists yet; you write it and the owner approves it before any code.
- **Checks at HEAD:** `npm run build` is clean, `npx vitest run` passes (505 tests), and all 40 SQL suites pass.

---

## 1. The project in one paragraph

Collabify is project management for the BSIT programs at Dr. Yanga's Colleges (DYCI, Philippines).

- **Stack:** React 19 + TypeScript + Vite + React Router + Tailwind v4 (design tokens), with Supabase/Postgres behind it (RLS, `security definer` functions, triggers). SQL is applied live with a small script (§9). It deploys on Vercel; ask the owner for the address.
- **Roles:** the database has `student | professor | admin`. The UI already says **Faculty**, and phase 4 renames the enum value.
- **Access is admission-gated:**
  - the admin admits faculty and sets **Can teach** (`profiles.can_teach`) per person;
  - faculty admit students with class codes or `/join/<code>` invite links;
  - students never create spaces.

---

## 2. Read these files, in this order

Don't skip. Each one says what it gives you.

1. **`CLAUDE.md`** (repo root): the project rules. Design tokens (no raw colours), the copy style, security invariants, commands. Everything in it applies to you too.
2. **This file**, all of it.
3. **`docs/superpowers/specs/2026-09-26-one-workplace-design.md`**: **the original, approved design** (the "first planning"). Sections 1–3 are the target model. Section 4 lists the four phases; phase 4 is what's left.
4. **`handoff.md`**: long. Read only the **last three sections**:
   - "one workplace, phase 1";
   - "phase 2 (education spaces underneath)";
   - "phase 3 (one shell + education space page)".

   They say what shipped and list what's deferred. Older sections are history; open them only when a file you touch is described there.
5. **The four finished implementation plans.** Skim them for *how* things were built, and read each plan's header for owner decisions. Every checkbox in them is done.
   - `docs/superpowers/plans/2026-09-26-one-workplace-phase-1-access.md`
   - `docs/superpowers/plans/2026-09-26-one-workplace-phase-2-education-spaces.md`
   - `docs/superpowers/plans/2026-09-27-one-workplace-phase-3a-shell.md`: holds the **route map** (old URL → new URL).
   - `docs/superpowers/plans/2026-09-27-one-workplace-phase-3b-education-space.md`

   These are also **the template for the phase 4 plan you'll write**: the same header, global constraints, file map, then numbered tasks with steps, code, commands and a commit.
6. **The local progress ledger**, `.superpowers/sdd/progress.md`. It's gitignored but present on this computer: a line-per-task record of every phase with commit ranges and review notes. It's history, not instructions; §4 below summarises it.
7. **Key code**, when you get to it:

   | File | What it is |
   |---|---|
   | `src/lib/paths.ts` (+ `paths.test.ts`) | every URL; `legacyPath()` maps old `/student`, `/professor`, `/general`, `/admin`, `/education` URLs |
   | `src/App.tsx` | all routes: one `<ProtectedRoute open>` + `<AppShell>` parent, guard layouts, legacy catch-alls |
   | `src/routes/gate.ts`, `RoleSwitch.tsx` | access decision (pure, tested); one URL rendered by role |
   | `src/components/app/nav.ts`, `SideNav.tsx`, `spaceRows.ts` | the sidebar |
   | `src/pages/Home.tsx` | stacked home: role dashboard, then `WorkOverview` |
   | `src/pages/app/classes/ClassSpace.tsx`, `src/lib/classSpace.ts` | the class page (education space) and its pure rules |
   | `src/components/classes/FacultyPanel.tsx`, `ClassSettings.tsx` | co-teachers; class settings tab |
   | `src/components/general/SpaceDialogs.tsx` | New space (asks Education or Work) |
   | `src/lib/access.ts` | `isFaculty`, `canTeach` |
   | `src/lib/workplace.ts` | leftover from the two-workplace era; **phase 4 removes it** |
   | `supabase/access.sql` | phase 1: gates, `can_teach`, `decide_faculty`, `handle_new_user` |
   | `supabase/one-workplace.sql` | phases 2 and 3b: every class owns an education space, guards, co-teachers, class chat sync, `search_faculty` |
   | `supabase/anon-lockdown.sql` | runs **last**: signed-out callers execute no public function |
   | `supabase/admin-rename.sql` | **the precedent for phase 4's enum rename** (`superadmin` → `admin`); read its header comment |
   | `supabase/tests/*.test.sql` | 40 SQL suites (see §9) |

---

## 3. What was built (so you don't redo it)

### Phase 1: access (commits `c56fa85..46910d4`; the owner browser-checked it)
- **Registration** offers Student or Faculty. Faculty start `pending`. The admin approves with `decide_faculty(p_user, p_approve, p_can_teach)` and toggles Can teach later (`set_faculty_teaching`).
- **SQL gates:**
  - students can't create spaces;
  - pending faculty can't do anything;
  - only teaching faculty create classes (`classes_insert` policy);
  - students can't join work spaces or projects by code;
  - only faculty can invite students into work spaces.
- **Admin RPCs** refuse API callers unless they're admin or the service role. `enter_education` was dropped.

### Phase 2: education spaces underneath (`7862c78..1e2ee58`; the owner browser-checked it)
- **Every class owns a space.** `general_spaces.kind` is `work | education`, and `classes.space_id` is not null and unique.
  - Triggers on `classes` create, rename, archive and delete the space, and move the Owner on handover.
  - `class_members` stays the roster and is mirrored into `general_space_members` under a transaction-local flag (`class_sync_on/restore`).
  - Guards refuse every other write to a class space.
- **Co-teachers:** `teaches_in_space(space)` means active faculty at Owner or Manager, and `is_class_professor(class)` = the class's professor OR `teaches_in_space`. Every analytics, report and moderation check goes through it.
- **Class sizes:** `classes.student_cap` (null or 1–500), enforced by `join_class` with a row lock.
- **Invite links:** `/join/<code>` asks for confirmation before joining.
- **Anon lockdown:** `anon-lockdown.sql` revokes EXECUTE from anon on every public function. Owner decision: signed-out callers run nothing.

### Phase 3a: one shell (`9b81be0..27ce821`; **not browser-checked yet**)
- **URLs:** short routes (`/home`, `/tasks`, `/calendar`, `/messages`, `/spaces`, `/projects`, `/classes`, `/groups`, `/class-projects`, `/record`, `/teaching/*`, `/privacy/*`, `/admin/*`). Old URLs redirect via `legacyPath`, keeping the query string and hash.
- **One sidebar:** MAIN, YOUR SPACES (classes amber, work navy), YOUR PROJECTS, CLASSES, TEACHING, ADMIN, ACCOUNT.
- **Home is stacked:** the role dashboard, then "Your work".
- **Merged lists:** Messages, My tasks and Calendar are each one list with an **All · Classes · Work** filter kept in `?show=`.
- **Removed:** the workplace switcher. The UI no longer says "Education/General" as places.

### Phase 3b: the education space page (`6bc0bf6..f539c46`; **not browser-checked yet**)
- **One class page.** `/classes/:classId` renders `ClassSpace`, remounted per class, with the tab in `?tab=`.
  - Everyone gets Overview, Projects, Groups, Members (the Faculty panel, then Students) and Syllabus.
  - Faculty who teach it (`teachesClass`, the same rule as `is_class_professor`) also get Submissions, Analytics and Reports (the teaching pages with a `classId` prop that locks them to that class) and Settings (`ClassSettings`).
- **Co-teachers:**
  - Faculty in a class space are always Owner or Manager: an accepted invite seats them at Manager, and setting them to Member is refused.
  - **Only a class's Owner invites or removes faculty** (an owner decision). Anyone can leave.
  - Their seat puts them in the class chat (`class_space_conversation_sync`, handovers included).
  - `search_faculty` backs the invite dialog.
  - `listProfessorClasses` includes co-taught classes.
- **New space** asks teaching faculty "Education or Work". "Create class" opens it at Education and lands in the new class.
- **Printing** a report from the class page hides the class banner (so the join code isn't printed).
- **Home** no longer offers "Create a class" to faculty who can't teach.

---

## 4. Owner decisions already made (**don't re-ask these**)

- **Structure:** Approach A, one space with two engines. Every class owns an education space.
- **Students:**
  - They enter work spaces **only when faculty invite them**. They never create spaces and never join work spaces by code.
  - Student-owned General spaces were **deleted**.
- **Can teach:**
  - The admin sets it per person.
  - Only teaching faculty create classes. Any admitted faculty can create work spaces.
- **Faculty in an education space:**
  - They are Owner or Manager; students are Members.
  - **Advisers** (faculty without Can teach, seated at Owner or Manager) get the full teaching tools.
  - **Only the class's Owner invites or removes co-teachers.**
- **Invite links:** joining through one asks for confirmation first.
- **Signed-out callers:** block everything they don't need, without breaking either workflow. Hence `anon-lockdown.sql`.
- **Phase 3 layout:**
  - it shipped as two plans (3a and 3b);
  - Home is "Stacked";
  - Messages, My tasks and Calendar are each "one list, with a filter".

---

## 5. How to work with this owner

- **Replies are minimal.** No preamble and no recap. State what's done, what needs the owner, and what's next.
- **Always end finished work with what's next** and where it sits in the plan.
- **When something needs the owner** (signing in, registering, a decision), say exactly what to do, then **stop and wait**. Never skip the step.
- **Verify it yourself.** Run the build, Vitest and the SQL suites. Don't ask the owner to click through things you can check.
- **Commit and push yourself** once work is verified, on `main` (that's how this project runs). Commit messages:
  - a short imperative subject in sentence case (see `git log`);
  - a blank line, then an optional body;
  - end with a trailer naming the agent.
  - Match the existing style.
- **Handoff:** append a new section at the end of `handoff.md` whenever a phase finishes.
- **Plans before code:** for a multi-step phase, write the plan file first, have the owner approve it, then execute it task by task, committing after each task. After each task, review your own diff against the task text before moving on.
- **Layout:** desktop first, then tablet, then phone, as real layouts. Not a widened mobile column.

---

## 6. What's left, in order

### Step A: browser walk for 3a + 3b (the owner does the clicking)

**Never sign in, sign out or register on the owner's behalf.** Start the app with `npm run dev` (http://localhost:5173) or use the deployed site. Tell the owner the checklist below, one account at a time, then wait for their result. Fix whatever they report: diagnose, fix, run the checks (§9), commit, push, and ask them to re-check.

Accounts are the owner's own:
- a student;
- a professor with Can teach;
- **Luke**, a faculty member (active, `can_teach = false`), used as the co-teacher / adviser;
- the admin.

**Student**
- The sidebar reads MAIN, YOUR SPACES (amber class badges), YOUR PROJECTS, CLASSES (with "Your record"), ACCOUNT.
- Home shows the class dashboard first, then "Your work" (only if they have work).
- My tasks, Calendar and Messages have the All · Classes · Work filter, and it stays set when an item is opened and closed.
- `/student/classes` lands on `/classes`.
- A class has 5 tabs: Overview (this week, announcements, about), Projects, Groups, Members (Faculty, then Students) and Syllabus.
- `?tab=settings` shows Overview.

**Professor with Can teach**
- TEACHING appears in the sidebar, and `/professor/submissions` → `/teaching/submissions`.
- A class has 9 tabs. Submissions, Analytics and Reports show only that class, with no class picker.
- Printing from the Reports tab prints only the sheet: no navy banner and no join code.
- Settings saves an edit, and archive and restore work.
- Members → **Invite faculty** finds Luke; invite him.
- New space (on the Spaces page) asks **Education or Work**, and each option creates and opens the right thing.

**Luke**
- Spaces → Invitations → Accept. The class opens with the teaching tabs.
- It's listed under Classes, and its class chat appears in Messages.
- Settings has **no Delete**, and there's **no Invite faculty** button (he's a Manager).
- Home doesn't offer "Create a class".

**Admin**
- ADMIN appears in the sidebar, `/admin` goes to Home, and Faculty approvals works.

After the walk, if the owner asks, remove any test class or space they made (ask first; deleting is permanent). Then append "3a + 3b browser walk done" to the phase 3 section of `handoff.md`.

### Step B: the open owner question (ask it; don't decide it)

> "An admin who does not have *Can teach* no longer sees **New message** in Messages; it's gated on `canTeach()` in `src/pages/app/messages/Messages.tsx`. Should admins keep it?"

If they say yes, gate it on `isFaculty(profile)`, or add `|| profile.role === 'admin'`. Check that `start_direct_conversation` in SQL allows an admin, then build, test, commit and push.

### Step C: phase 4, cleanup (plan first, then execute)

Write `docs/superpowers/plans/<today>-one-workplace-phase-4-cleanup.md` in the same format as the 3b plan. Show it to the owner and wait for approval. Then execute it task by task.

What phase 4 must cover (from spec §4, plus what the work so far taught):

**C1. Remove `home_workplace` and `src/lib/workplace.ts`.**
- `src/lib/workplace.ts` still exports `homeFor` (plus tests in `workplace.test.ts`). `homeFor` is used by `AppShell.tsx`, `AuthCallback.tsx`, `JoinClassLink.tsx`, `Onboarding.tsx` and `Pending.tsx`. Move `homeFor` somewhere sensible (e.g. `src/lib/access.ts` or `src/routes/`), move its tests, and delete the rest.
- `home_workplace` is read or written in:
  - `src/context/AuthContext.tsx:285`
  - `src/lib/types.ts:29` (and the `Workplace` type)
  - `supabase/workplaces.sql` (it creates the `workplace` enum and the column; its `handle_new_user` inserts it)
  - `supabase/access.sql:214` (the current `handle_new_user` inserts `'education'`)
  - `supabase/general-spaces.sql:16` (a comment only)
- **Trap.** The SQL files are re-run in a fixed order (the restore line in `docs/07-backup.md` and `ORDER` in `scripts/schema-drift.mjs`). If you only add `alter table … drop column` somewhere, re-running `workplaces.sql` later recreates the column, and its `handle_new_user` version references it.
  - Pick one consistent approach, and write it into the plan. For example:
    - stop `workplaces.sql` from creating or using the column;
    - redefine `handle_new_user` in `access.sql` without it;
    - add a new idempotent `supabase/cleanup.sql` (drop column, drop the `workplace` type if unused), registered in both order lists after `one-workplace.sql` and before `anon-lockdown.sql`.
  - `grep -rn "workplace" supabase src` to catch the rest.
- Dead routes and docs: grep for anything only the two-workplace era used. The switcher is already deleted.

**C2. Rename the enum value `professor` → `faculty`.** This is the risky one: plan it as its own task, test-first.
- **Mechanics** (see the header of `supabase/admin-rename.sql`):
  - `alter type public.user_role rename value 'professor' to 'faculty'` (inside a `do` block guarded by `pg_enum`, so it's idempotent).
  - Stored data, parsed policies, views, defaults and check constraints follow the rename automatically, because they hold the enum value's OID.
  - **Function bodies do not**: plpgsql and SQL function bodies are stored as text. A literal `'professor'` in one either raises `invalid input value for enum` or, if compared as text, **silently stops matching**. Every such function must be redefined with `'faculty'`.
- **SQL inventory** (count of `'professor'` literals per file, at HEAD):
  - `access.sql` 14, `workplaces.sql` 8, `one-workplace.sql` 4, `schema.sql` 3;
  - `accounts.sql` 2, `approvals.sql` 2, `consent.sql` 2, `tasks.sql` 2;
  - `admin-rename.sql` 1, `messages.sql` 1.

  Also grep for `professor` without quotes: function names like `is_class_professor` and columns like `classes.professor_id` are **names, not enum values**. Decide in the plan whether to leave names alone; leaving them is recommended, because renaming columns touches far more.
- **Order trap.** Older files re-run *after* a rename would recreate functions containing `'professor'`. So either update the literal in every file (so any file can be re-run safely), or make the rename file the one that redefines those functions and document that it must run after them. Updating every file is safer. `handle_new_user` also maps the sign-up metadata `role` (`'student' | 'professor'`, sent by `src/pages/auth/Register.tsx` / `RoleChoice.tsx`). Accept both `'professor'` and `'faculty'` from metadata so an old client mid-deploy still registers.
- **App inventory:**
  - about 112 `'professor'` literals across about 44 files. Heaviest: `ClassSyllabusTab.tsx`, `paths.test.ts`, `gate.test.ts`, `access.test.ts`, `Calendar.tsx`, `ProjectDetail.tsx`, `GroupDetail.tsx`, `ClassProjectsTab.tsx`, `nav.test.ts`.
  - The `Role` type in `src/lib/types.ts`.
  - The `professor` prop of `RoleSwitch` (renaming the prop is optional; decide in the plan).
  - Component props like `role="professor"` passed to `ClassGroupsTab`, `ClassProjectsTab` and `ClassSyllabusTab` are UI roles, not the enum. Decide whether they follow.
  - **Keep** `legacyPath()` accepting `/professor/...` **URLs**: those are old paths, not roles (and `paths.test.ts` tests them).
- **Deploy order:** the database and the app must switch together. Plan the sequence, for example:
  1. accept both values in the app first;
  2. rename in the database;
  3. remove the old value from the app.

  Or do it in one quick deploy, and tell the owner the short window.
- **Verify:**
  - every SQL suite (several fixtures insert `role = 'professor'`, so update them);
  - Vitest and the build;
  - a live query: `select role, count(*) from profiles group by role`;
  - a sign-up as faculty (the owner does it).

**C3. Landing and auth copy say "faculty".** Keep the current visual design; **the owner loves it and doesn't want it changed**, only words. Follow the copy rules in CLAUDE.md.

The landing page (`src/pages/Landing.tsx`, `src/components/landing/*`) already has no "professor" at HEAD. The user-visible leftovers are:
- `src/components/ui/RoleChoice.tsx:10`: "…a code from your professor"
- `src/components/ui/RoleChoice.tsx:16`: "Professors and school staff · needs admin approval"
- `src/pages/auth/Onboarding.tsx:91`: "…the code your professor gives you"
- `src/pages/auth/Register.tsx:135`: the same sentence
- `src/pages/auth/JoinClassLink.tsx:100`: "Your professor and classmates…"

Re-grep with `grep -rni "professor" src/pages src/components` for UI text. (The `role === 'professor'` comparisons in those files belong to C2.)

**C4. Fold the duplicate `general_space_overview`.** It's defined twice in `supabase/one-workplace.sql` (both copies are identical today). `create or replace view` can only *append* columns, so keep one definition with the full column list, in the right place in the file.

**C5. Finish.** Run every check, append a phase 4 section to `handoff.md`, push, and have the owner do a short browser walk (register as faculty, admin approves, faculty creates a class, a student joins).

### Deferred (known; mention them if relevant, don't fix unless the owner asks)
- `create_general_project`'s oldest-space fallback ignores the space kind.
- Deactivated professors keep teaching through `classes.professor_id`.
- Restoring a student can exceed the class cap.
- A space description can drift via `update_general_space`.
- `project_boards_write` has the self-referencing policy shape (unreachable today).
- `general-space-teams.sql` is missing from the restore line in `docs/07-backup.md`.
- Month-view work chips look like class chips.
- `useConversations` subscribes three times on Home.
- `gate.test` matrix gaps.
- There are no space-level student positions (positions exist only on projects).
- Analytics shows "create a class" empty-state copy inside a class.
- An archived class's Submissions tab is empty, because the lists exclude archived classes.
- Losing a seat mid-session keeps the loaded data until a reload.
- `listProfessorClasses` makes two queries.
- The class page's nav error also surfaces project-list errors, which can flash briefly at startup.
- Any teaching professor can point `syllabus_id` at a known resource UUID (pre-existing).
- `dotenv` 17 prints promo lines; `quiet: true` in `scripts/db.mjs` would silence them.

---

## 7. Hard rules (security and hygiene)

- **Never read, print, paste or commit** `.env.local`, `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`. None of them may ever appear in frontend code, in Vercel, or in any committed file. `scripts/db.mjs` reads them itself; you never need their values.
- **Role, status and can_teach are admin-only.** The `profiles_guard_privileged` trigger enforces this; keep it that way.
- **Avatar uploads** stay scoped to `avatars/<user-id>/`.
- **Never stage:**
  - `desktop.ini`, `docs/redesign/`, `.superpowers/`, `graphify-out/`;
  - `*.patch`, `verify-before-main.md`, `supabase/.temp/`.

  Stage files by name, never `git add -A`.
- **Design:**
  - No hardcoded colours; use the tokens in `src/styles/index.css`.
  - Education badges use the amber ramp (`bg-amber-400/18 text-amber-700 dark:text-amber-300`); work badges use `surface-sunken text-muted`.
  - Dark mode is the `.dark` class.
  - Motion goes through `components/motion/Reveal.tsx` or `useReducedMotion`.
- **Copy:** sentence case and active voice. No exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- **URLs:** every URL comes from `src/lib/paths.ts`. No new string literal starting with `/student`, `/professor` or `/general` outside `paths.ts` and its test.
- **SQL:**
  - Every `supabase/*.sql` file stays **idempotent**; they get re-run.
  - After adding or redefining **any** function, re-run `supabase/anon-lockdown.sql` **last**, then `supabase/tests/anon-lockdown.test.sql`.
  - Register any new SQL file in `scripts/schema-drift.mjs` `ORDER` and in the restore line in `docs/07-backup.md`.
  - A policy that calls a function which re-reads the policy's own table breaks `INSERT/UPDATE … RETURNING`. That's why class policies use `teaches_in_space(space_id)` rather than `is_class_professor(id)`.
- **Browsers and accounts:** never sign in, sign out or register on the owner's behalf. Never create accounts. Never delete data without the owner saying so.
- **Privacy:** don't run `caveman-setup` (refused for privacy, RA 10173). Student data is personal data under the Philippine Data Privacy Act.

---

## 8. Things that differ for you (Codex) vs. the previous agent

- **Claude-only tools and how you cover each:**
  - The superpowers skills (`writing-plans`, `subagent-driven-development`), subagents and the browser pane are Claude tools. Do the same work directly: write the plan file in the same format, execute tasks yourself one at a time, and self-review each diff.
  - `CLAUDE.md` is still the project's rulebook; treat it as binding.
  - `AGENTS.md` (read automatically by you) points here. Its graphify/ponytail sections are optional helpers. If `graphify-out/` isn't present or current, just grep and read.
- **Database access.** You run on the owner's machine, so `.env.local` is there and `node scripts/db.mjs` works. Confirm with `node scripts/db.mjs -c "select 1"` and never print the URL.

---

## 9. Commands

```bash
npm run dev                                   # http://localhost:5173
npm run build                                 # tsc -b && vite build; run before claiming anything works
npx vitest run                                # node env, src/**/*.test.ts, pure functions only (505 tests at HEAD)
node scripts/db.mjs supabase/<file>.sql       # apply one SQL file live (reads .env.local itself)
node scripts/db.mjs -c "select 1"             # one-off query
node scripts/db.mjs supabase/tests/<name>.test.sql       # one SQL suite
for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done   # all 40 suites; no output = clean
node scripts/set-role.mjs <email> <role> [status]        # admin tool; only when the owner asks
```

About the SQL test suites:
- Each suite runs inside `begin … rollback`, so it touches nothing permanently.
- Each prints `NOTICE: PASS …` lines, and a failure raises `FAIL …`.
- Fixtures insert throwaway `auth.users` rows with `@example.test` emails.
- Helpers: `pg_temp.act_as(uuid)` (signed-in user), `act_as_service()`, `act_as_owner_for(uuid)` (superuser with claims), `must_refuse(label, sql)`, `must_allow(label, sql)` and `must_be(label, bool)`.
- A `dotenv` promo line in the output is harmless.

Link grep; its output should list only the legacy mounts in `App.tsx`:

```bash
grep -rnoE "['\"\`]/(student|professor|general)(/|['\"\`])" src --include=*.ts --include=*.tsx | grep -v "src/lib/paths"
```
