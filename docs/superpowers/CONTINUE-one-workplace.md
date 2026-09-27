# Continue here: the one-workplace project (handover to a new session)

Written 2026-09-27 at the end of a long local session. `main` is at `f539c46` (plus the commit that adds this file) and is pushed to `origin` (`github.com/LemmuelAlinea/dyci.collabify`). Everything below is also in git, so a fresh clone has it all.

If you are a new Claude session, read this whole file first, then the files in **Read these, in this order**. Don't start coding until you've read them.

---

## 1. What the project is

Collabify is project management for the BSIT programs at Dr. Yanga's Colleges (DYCI). It's a React 19 + TypeScript + Vite + React Router + Tailwind v4 web app, with Supabase/Postgres behind it (RLS, security-definer functions, triggers). It's deployed on Vercel (`https://dyci-collabify.vercel.app`) from `main`.

Roles in the database are `student | professor | admin`. The UI already says **Faculty**, and phase 4 renames the enum value.

**The big effort in progress: "one workplace".** The app used to have two separate worlds:

- **Education:** classes, group sets, groups, projects and tasks, plus syllabus weeks, submissions and grading.
- **General:** spaces, projects and tasks, with levels, positions and teams.

They're being merged into **one workplace**, where a *space* is either an **education** space (a class) or a **work** space. Access is admission-gated:

- the admin admits faculty and sets **Can teach** per person;
- faculty admit students through class codes or invite links;
- students can't create spaces;
- faculty choose Education or Work when they create a space.

## 2. Read these, in this order

1. `CLAUDE.md`: project rules (design tokens, copy style, security invariants, commands).
2. `handoff.md`: read only the **last three sections** (phase 1, phase 2, phase 3). The file is long; older sections are history.
3. `docs/superpowers/specs/2026-09-26-one-workplace-design.md`: **the approved design (the "first planning")**. Section 4 lists the phases.
4. The four implementation plans, all finished. Skim them for how things were built and the owner decisions in their headers:
   - `docs/superpowers/plans/2026-09-26-one-workplace-phase-1-access.md`
   - `docs/superpowers/plans/2026-09-26-one-workplace-phase-2-education-spaces.md`
   - `docs/superpowers/plans/2026-09-27-one-workplace-phase-3a-shell.md` (it holds the route map)
   - `docs/superpowers/plans/2026-09-27-one-workplace-phase-3b-education-space.md`
5. The key code, when you need it:
   - `src/lib/paths.ts`: every URL, plus `legacyPath()`.
   - `src/App.tsx`: routes.
   - `src/components/app/nav.ts`: the sidebar.
   - `src/pages/app/classes/ClassSpace.tsx`: the class page.
   - `src/lib/classSpace.ts`
   - `supabase/access.sql`, `supabase/one-workplace.sql`, `supabase/anon-lockdown.sql`

## 3. Status

| Phase | What | State |
|---|---|---|
| 1 Access | Student/Faculty registration, `can_teach`, admission gates, `decide_faculty`, anon lockdown of admin RPCs | **Done**. The owner browser-checked it. |
| 2 Education spaces underneath | `general_spaces.kind`, `classes.space_id`, class→space triggers, roster mirror, guards, co-teachers (`teaches_in_space`, `is_class_professor`), student cap, `/join/<code>` invite link with a confirm step, anon execute revoked on every public function | **Done**. The owner browser-checked it. |
| 3a One shell | Short routes and legacy redirects, one sidebar, stacked Home, merged Messages / My tasks / Calendar with an All · Classes · Work filter | **Code done and pushed.** Browser walk **not done yet**. |
| 3b Education space page | `/classes/:id` is one page with tabs; co-teachers (Faculty panel, Owner-only invite and remove, class chat, co-taught classes listed); Submissions/Analytics/Reports locked to one class; Settings tab; New space asks Education or Work | **Code done, reviewed and pushed.** Browser walk **not done yet**. |
| 4 Cleanup | See §5 | **Not started. No plan written yet.** |

Checks at `f539c46`: 40 of 40 SQL suites pass, 505 Vitest tests pass, `npm run build` is clean.

## 4. What's left, in order

### Step A: the browser walk for 3a and 3b (needs the owner)

The owner signs in. **Claude never signs in, signs out or registers in any browser.** Tell the owner exactly what to do, then wait for them.

**Accounts.** Use the owner's existing accounts: a student, a professor with Can teach, Luke (faculty, active, `can_teach = false`), and the admin.

**Student**
- The sidebar reads MAIN, YOUR SPACES (amber class badges), YOUR PROJECTS, CLASSES (with Your record), ACCOUNT.
- Home shows the role dashboard first, then "Your work".
- My tasks, Calendar and Messages have the All · Classes · Work filter, and it survives opening an item.
- `/student/classes` redirects to `/classes`.
- A class shows five tabs (Overview, Projects, Groups, Members, Syllabus). Members lists Faculty first, then Students.
- `?tab=settings` falls back to Overview.

**Professor with Can teach**
- The TEACHING group is in the sidebar, and `/professor/submissions` redirects to `/teaching/submissions`.
- A class shows nine tabs. Submissions, Analytics and Reports show only that class, with no class picker.
- Printing from the Reports tab prints only the report sheet, without the class banner or join code.
- Settings saves an edit, and archive and restore work.
- Members → Invite faculty finds Luke; invite him.
- New space asks Education or Work, and each option creates and opens the right thing.

**Luke**
- Accept the invitation on the Spaces page. The class opens with the teaching tabs.
- The class appears under Classes and its class chat appears in Messages.
- There's no Delete in Settings, and no Invite faculty button (he's a Manager).

**Admin**
- The ADMIN group is in the sidebar, `/admin` goes to Home, and Faculty approvals works.

Fix anything the walk finds. After the walk, if the owner asks, remove any test class or space they made.

### Step B: one open owner question (ask it; don't decide it)

An admin without **Can teach** no longer sees "New message" in Messages; it's gated on `canTeach()`. Should admins keep it?

### Step C: phase 4 cleanup (write the plan first, then execute it)

From the spec, section 4:

- **Delete the leftovers.** Remove `src/lib/workplace.ts` and `workplace.test.ts`, keeping `homeFor` somewhere sensible, since it's still used by AppShell, AuthCallback, JoinClassLink, Onboarding and Pending. Remove the `home_workplace` column and everything that reads it (`src/context/AuthContext.tsx`, `src/lib/types.ts`, `supabase/workplaces.sql`, `access.sql`, `general-spaces.sql`), plus dead routes and docs. The WorkplaceSwitcher is already deleted.
- **Rename the `professor` enum value to `faculty`** (`alter type … rename value`). This is the risky part:
  - there are ~39 `'professor'` literals across 10 SQL files, and plpgsql bodies are only checked when they run;
  - there are ~112 `'professor'` literals across 44 TS/TSX files, and the `Role` type.

  Plan it as its own task. Redefine every SQL function and policy that compares `role` to `'professor'`, and re-run the affected files in dependency order (the `ORDER` in `scripts/schema-drift.mjs`). Then re-run `supabase/anon-lockdown.sql` **last**, and all SQL suites. Keep `legacyPath` accepting `/professor/*` URLs; those are paths, not roles.
- **Update the landing page and auth copy** to say faculty. Keep the current visual design; the owner likes it.
- **Fold `general_space_overview` into one definition.** It's defined twice in `supabase/one-workplace.sql`; the two copies are kept identical today.

Use the `superpowers:writing-plans` skill for the phase 4 plan, then `superpowers:subagent-driven-development` to execute it. The owner has always picked subagent-driven.

### Deferred (known, not scheduled; mention them, don't fix unless asked)

- `create_general_project`'s oldest-space fallback ignores the space kind.
- Deactivated professors keep teaching through `professor_id`.
- Restoring a student can go past the class cap.
- A space description can drift via `update_general_space`.
- `project_boards_write` has the self-referencing policy shape; it's unreachable today.
- `general-space-teams.sql` is missing from the rebuild line in `docs/07-backup.md`.
- Month-view work chips look like class chips.
- `useConversations` subscribes three times on Home.
- The `gate.test` matrix has gaps.
- There are no space-level student positions (positions exist only on projects).
- Analytics shows "create a class" empty-state copy inside a class.
- An archived class's Submissions tab is empty, because the lists exclude archived classes.
- If someone loses their seat mid-session, the loaded data stays until a reload.
- `listProfessorClasses` makes two queries.
- The class page's nav error also surfaces project-list errors, which can flash briefly at startup.
- Any teaching professor can point `syllabus_id` at a known resource UUID (pre-existing).
- `dotenv` 17 prints promo lines; `quiet: true` in `scripts/db.mjs` would silence them.

## 5. Owner decisions already made (don't re-ask)

- **Structure:** one space, two engines (Approach A). Every class owns an education space.
- **Students:**
  - They enter work spaces only when faculty invite them. They never create spaces, and never join work spaces by code.
  - Student-owned General spaces were deleted.
- **Can teach:**
  - The admin sets it per person.
  - Only teaching faculty create classes. Any admitted faculty can create work spaces.
- **Education-space roles:**
  - Faculty are always Owner or Manager; students are Members.
  - Advisers (faculty without Can teach) at Owner or Manager get full teaching tools.
  - **Only a class's Owner invites or removes co-teachers.** Anyone can leave.
- **Invite links:** joining through one asks for confirmation first.
- **Signed-out callers (anon) execute no public function.** Re-run `supabase/anon-lockdown.sql` after adding or redefining any function.
- **Phase 3 layout:**
  - It shipped as two plans (3a and 3b).
  - Home is "Stacked".
  - Messages, My tasks and Calendar are each "one list with an All · Classes · Work filter".

## 6. How to work with this owner (standing preferences)

- **Replies:** keep them minimal. No preamble and no recap. Say what's done, what needs the owner, and what's next.
- **What's next:** always end finished work by saying what's next and where it sits in the plan.
- **When a step needs the owner** (signing in, registering, a decision), say exactly what to do and wait. Never skip it.
- **Verify it yourself.** Run the build, the tests and the SQL suites, and check in the browser pane when there is one. Don't ask the owner to click through things you can check.
- **Commit and push yourself** once work is verified. Commit messages are a heredoc ending with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or whatever attribution line the session's system instructions give).
- **`handoff.md`:** read it at the start of each session, and append a new section at the end when a phase finishes.
- **Design:** desktop layout first, then tablet, then phone. Don't make it a widened mobile column.

## 7. Hard rules (security and hygiene)

- Never read, print or commit `.env.local`, `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`. None of them may appear in frontend code or in Vercel.
- Only an admin can change `role`, `status` and `can_teach`. The `profiles_guard_privileged` trigger enforces this.
- Avatar uploads are scoped to `avatars/<user-id>/`.
- **Never stage** `desktop.ini`, `docs/redesign/`, `.superpowers/`, `*.patch`, `graphify-out`, `verify-before-main.md` or `supabase/.temp/`.
- **Colours:** no hardcoded colours. Use the tokens in `src/styles/index.css`: education badges use the amber ramp, work badges use `surface-sunken text-muted`.
- **Copy:** sentence case and active voice. No exclamation marks, no "please", no "successfully".
- **SQL:** every `supabase/*.sql` file stays idempotent (they get re-run).
- **Browsers:** never sign in, sign out or register in any browser on the owner's behalf.
- **`caveman-setup`:** the owner refused it for privacy reasons (RA 10173); don't run it.

## 8. Commands

```bash
npm run build                                  # tsc -b && vite build — run before claiming anything works
npx vitest run                                 # node env, src/**/*.test.ts, pure functions only
node scripts/db.mjs supabase/<file>.sql        # apply SQL live (needs SUPABASE_DB_URL in .env.local)
node scripts/db.mjs -c "select …"              # one-off query
for f in supabase/tests/*.test.sql; do node scripts/db.mjs "$f" 2>&1 | grep -E "FAIL|ERROR" && echo "in $f"; done   # all SQL suites; no output = clean
```

SQL test suites run inside `begin … rollback` and print `NOTICE PASS …` lines, using helpers such as `pg_temp.act_as`, `must_refuse`, `must_allow` and `must_be`.

## 9. Cloud-session caveats (read before trying anything)

- **No database access by default.** `.env.local` is gitignored, so it isn't in the cloud clone. Without `SUPABASE_DB_URL`, `scripts/db.mjs` can't reach the live database, which means no SQL apply and no SQL suites. Phase 4's enum rename and column drop need it.
  - Ask the owner to provide the variable through the cloud environment's secret settings, never pasted into chat or committed.
  - Otherwise, do the frontend parts in the cloud and leave SQL steps for a local session.
- **The progress ledger isn't in git.** `.superpowers/sdd/progress.md` is gitignored, so it doesn't exist in the clone. §3 and §4 of this file replace it. Recreate the ledger when you start executing phase 4.
- **The browser walk** needs the app running with the owner signed in. If the cloud session has no browser pane, the owner can walk the deployed site (Vercel deploys `main`) or run `npm run dev` locally.
- **The CodeGraph MCP** (`.codegraph/`) may not exist in the cloud; use grep and read instead.
