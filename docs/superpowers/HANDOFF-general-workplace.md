# Handoff — General workplace upgrade

Written 2026-09-18. Everything below is current as of commit `ce2cf26` on branch
`feature/general-workplace`.

Read this file, then `docs/superpowers/specs/2026-09-17-general-workplace-foundation-design.md`
(what we are building and why) and
`docs/superpowers/plans/2026-09-17-general-workplace-foundation.md` (the 14-task
plan with complete code for every step).

---

## 1. What this upgrade is

Collabify was built for BSIT class projects. The owner's professor wants it
usable across all of Dr. Yanga's Colleges, preschool through college, for class
projects, faculty-only projects and the school's own projects — and eventually
for real collaboration on the work itself (a repository for system development,
a word processor for papers).

That is five pieces, in this order. **Only piece 1+2 is planned and being built
now.** Each later piece gets its own spec, plan and build.

1. **Two workplaces.** Everything that exists becomes the Education workplace.
   Registration asks which workplace you want.
2. **General workplace core.** Editable projects, teams, custom positions,
   access levels, invitations, tasks. (Ships together with piece 1, because
   piece 1 alone is an empty workplace.)
3. **Project presets.** Templates from DYCI and Philippine school practice.
4. **Shared documents.** A built-in word processor with versions, review,
   commit, download.
5. **Code repository.** Files, commits, diffs, reviews, history. Note: real
   `git push` from a laptop needs a Git server, which Supabase cannot host.
   That decision belongs to piece 5's own design.

### Decisions already locked with the owner (do not relitigate)

| Topic | Decision |
|---|---|
| Accounts | One account, both workplaces. Registration picks where sign-in lands; a top-bar switcher opens the other |
| Sign-up for General | Anyone, active immediately. A new account sees nothing until invited |
| Who is who | No school-wide positions. Each project's Owner or Managers create and name positions. Privacy comes from invitation |
| Joining | Invite existing accounts found by name or exact email; they accept or decline. A join code can also be turned on |
| Structure | A project has members and optional teams. A person can be on several teams |
| Access | Levels Owner, Manager, Member, plus per-person extra permissions. Members request; an Owner approves |
| Fields | Core fields (name, description, start, end, status) plus typed fields anyone with permission adds |
| Tasks | Same features as Education. The 100-point share is an optional project setting |
| Architecture | Separate General tables. Only accounts, notifications, messages and storage are shared. No Education rule changes |

---

## 2. Where things stand

Branch `feature/general-workplace`, 11 commits ahead of `main`. Main is
untouched, so nothing here is deployed.

| Task | What it is | Status |
|---|---|---|
| 1 | `src/lib/general/permissions.ts` — levels, permissions, `can()` | Done, reviewed clean |
| 2 | `src/lib/general/fields.ts` — field types and validation | Done, reviewed clean |
| 3 | `src/lib/general/progress.ts` — progress with points on/off | Done, reviewed after 1 fix |
| 4 | `supabase/workplaces.sql` — workplaces, nullable role, `enter_education` | Done, reviewed clean, **applied live** |
| 5 | `supabase/general.sql` — projects, members, teams, positions, permissions | Done, reviewed after 2 fix rounds, **applied live** |
| 6 | `supabase/general-tasks.sql` — tasks, files, time logs, history | **Built and applied live, but review found 10 issues — fixes not started** |
| 7 | `supabase/general-notify.sql` — notifications, project chats, admin counts | Not started |
| 8 | `src/lib/general/types.ts`, `src/lib/api/general.ts` | Not started |
| 9 | Workplace routing, auth context, `/education/enter` | Not started |
| 10 | Registration choice, switcher, General home, messages, admin counts band | Not started |
| 11 | Project page + Overview tab | Not started |
| 12 | Members tab (access, invitations, teams, positions) | Not started |
| 13 | Tasks tab + task dialog | Not started |
| 14 | End-to-end verification | Not started |

Progress ledger with per-task notes: `.superpowers/sdd/progress.md`.
Per-task briefs and implementer reports: `.superpowers/sdd/task-N-brief.md`,
`task-N-report.md`.

### The live database already has

`supabase/workplaces.sql`, `supabase/general.sql`, `supabase/general-tasks.sql`,
plus in-place fixes to `supabase/rate-limit.sql`, `supabase/classes.sql`,
`supabase/admin-rename.sql`, `supabase/approvals.sql` and `supabase/audit.sql`.

There is one Supabase database; there is no staging copy. SQL test files all end
in `rollback`, so they change nothing. Schema files are applied for real.

**Nothing in the deployed app can reach any of it yet** — the client still has no
General code, and registration does not offer General until Task 10.

### Uncommitted in the working tree

- `docs/superpowers/plans/2026-09-17-general-workplace-foundation.md` — my
  "Task 6 amended" note. Commit it with the Task 6 fixes.
- `desktop.ini`, `handoff.md`, `docs/redesign/collabify-student-dashboard.html`,
  `docs/redesign/serve-dashboard-preview.mjs` — not part of this work, never
  stage them. The redesign preview script is why lint must be run as
  `npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs`.

---

## 3. Do this first — Task 6 fixes

`supabase/general-tasks.sql` is live and has these holes. A security review
found them; nothing has been fixed yet. Edit only
`supabase/general-tasks.sql` and `supabase/tests/general-tasks.test.sql`, keep
the file idempotent, then re-apply it twice and re-run the tests.

Helpers available from `supabase/general.sql` (read it; do not edit it):
`is_general_member(uuid)` (already false for rejected accounts), `general_can`,
`general_is_archived`, `general_viewer_active()`.

1. **Deactivated holders can still write.**
   - `general_task_logs_insert`: add `public.is_general_member(project_id)`.
   - Storage policy `general_files_write`, holder branch becomes
     `(is_general_task_assignee(task) and is_general_member(project) and not general_is_archived(project))`.
2. **Owner-of-row policies skip membership.** Postgres only applies the SELECT
   policy to an UPDATE or DELETE when the statement reads columns, so an
   unfiltered `delete from general_tasks` from a removed or deactivated account
   runs under these policies alone. AND `public.is_general_member(project_id)`
   into: `general_tasks_delete` (created_by branch),
   `general_task_comments_update` (USING and WITH CHECK),
   `general_task_comments_delete` (author branch), `general_task_files_delete`
   (uploader branch), `general_task_logs_delete`.
3. **File path not tied to its task.** Add a named check constraint
   `general_task_files_path_matches`:
   `file_path like project_id::text || '/' || task_id::text || '/%'`, added
   idempotently (drop constraint if exists, then add).
4. **Leaving an archived project fails for task holders.** `leave_general_project`
   cascades into `general_task_assignees`, and `guard_general_task_child` raises
   "archived". In the guard's DELETE branch for `general_task_assignees` only,
   skip the archive refusal when the membership row is already gone
   (`not exists (select 1 from general_members where project_id = old.project_id and user_id = old.user_id)`).
5. **Claim race.** In `guard_general_task_child`'s INSERT branch for assignees,
   `perform 1 from general_tasks where id = new.task_id for update;` first, then
   unless the caller has `general_can(new.project_id, 'manage_tasks')`, raise
   `'Somebody already holds this task'` when `general_task_held(new.task_id)`.
6. **Guards reveal cross-project facts.** At the top of `guard_general_task` and
   `guard_general_task_child`, when `auth.uid()` is not null and not
   `is_general_member(<project>)`, raise `'You are not on this project'` with
   errcode `insufficient_privilege` before any other check. Apply fix 4's
   exemption before this check for assignee deletes.
7. **Helpers callable by anon.** `revoke execute on function
   public.is_general_task_assignee(uuid), public.general_task_held(uuid),
   public.general_task_project(uuid) from public, anon;` then grant to
   `authenticated`.
8. **Malformed storage paths throw.** Add `public.general_safe_uuid(p text)
   returns uuid` (immutable plpgsql, returns null on bad input) and use it
   instead of the `::uuid` casts in the three storage policies.
9. **Realtime leaks assignee keys.** Realtime does not apply row-level security
   to DELETE events. Remove `general_task_assignees` from the
   `supabase_realtime` publication idempotently and from the add loop, with a
   comment saying the client's poll and `general_tasks` events cover it.
10. **Assigning a deactivated member.** `general_task_assignees_insert`, the
    manage_tasks branch, gains
    `and exists (select 1 from public.profiles p where p.id = user_id and p.status <> 'rejected')`.

**Tests to add** (write them first, run them against the live definitions to see
them fail, then apply):
- a deactivated holder cannot log time (control: the same person logs time while active);
- a removed member cannot delete their own unheld task with an unfiltered
  `delete from public.general_tasks where true`;
- a file row with a path outside its task folder is refused, a matching one allowed;
- a task holder can leave an archived project;
- a second claim on a held task is refused by a direct insert (already covered — keep).

Then: apply `supabase/general-tasks.sql` twice, run
`supabase/tests/general-tasks.test.sql` (was 31 PASS, will grow),
`supabase/tests/general.test.sql` (74 PASS) and
`supabase/tests/workplaces.test.sql` (20 PASS). Commit the two files plus the
plan's amended note.

---

## 4. Then Tasks 7 to 14

Follow the plan file. Each task has complete code, exact commands and expected
output. Notes the plan cannot know:

- **Task 7** (`general-notify.sql`): the enum values must be added in their own
  transaction before use. The test expects 18 PASS.
- **Task 8** (API layer): already amended for the safer database — invitations
  go through `list_my_general_invitations()` and
  `list_general_project_invitations(p_project)`, and `joinGeneralProject` must
  treat a null result as a wrong code.
- **Task 9** (routing): `rejected` is what the admin's Deactivate button sets, so
  it blocks both workplaces; `pending` (a professor awaiting approval) blocks
  only Education.
- **Tasks 10–13** (screens): the plan's browser verification steps need two
  General test accounts. Check 375px and 1440px, light and dark.
- **Task 14**: full walkthrough of both workplaces, then push.

### Things the plan's own code got wrong, so far

Treat the plan's code as a detailed draft, not as verified. Reviews have found:
a PL/pgSQL parser error, a rounding bug that disagreed with the database, an
email-address leak through invitations, four deactivated-account holes, an
ownerless-project hole, a rate limit that never counted a wrong guess, and the
ten Task 6 items above. Review every task before trusting it.

---

## 5. How the work is being run

Subagent-driven development (`superpowers:subagent-driven-development`):

1. `bash "<superpowers>/skills/subagent-driven-development/scripts/task-brief" docs/superpowers/plans/2026-09-17-general-workplace-foundation.md N`
   writes `.superpowers/sdd/task-N-brief.md`.
2. Dispatch one implementer subagent per task. Give it the brief path, the report
   path, and `.superpowers/sdd/implementer-instructions.md`. Never paste the plan
   into a prompt.
3. `bash "<superpowers>/.../scripts/review-package" BASE HEAD` writes a diff file.
4. Dispatch a reviewer with `.superpowers/sdd/reviewer-instructions.md`, the
   brief, the report and the diff path. SQL tasks got the most capable model;
   pure logic got a cheap one.
5. Fix findings, re-review, then append one line to `.superpowers/sdd/progress.md`.

`<superpowers>` is
`C:/Users/Lemmuel Alinea/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3`.

### Commands

```bash
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs   # must end: 23 problems (0 errors, 23 warnings)
npm run test
npm run check        # typecheck, lint, test, build, contrast, a11y, schema-drift, motion-lint, legal-ready
```

Database access needs this in the same shell call, because the direct host is
IPv6-only here:

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
node scripts/db.mjs supabase/<file>.sql
```

Never print the connection string or password. Never `create or replace` a live
function outside the schema file being applied, not even inside a rolled-back
transaction.

### Rules that bind every task

- Colors from the tokens in `src/styles/index.css`. No raw hex.
- Copy: sentence case, active voice, no exclamation marks, no "please", no
  "successfully". Errors say what happened and what to do next.
- SQL files idempotent; a new enum value goes in its own transaction.
- Every new SQL file is appended to `ORDER` in `scripts/schema-drift.mjs` and to
  the rebuild command in `docs/07-backup.md`, in the same order.
- Vitest runs in the node environment over pure logic only. No component tests.
- Desktop first, then tablet, then phone. Wide content scrolls inside its own
  container; the page never scrolls sideways.
- Education behavior does not change, apart from the account changes in Tasks 4
  and 9.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## 6. Open questions for the owner

1. **Ownerless projects.** If an admin deactivates a project's only Owner,
   nobody can run that project. The spec says admins see counts only, so there
   is no recovery path. Add an admin rescue function, or accept it?
2. **A deactivated account can still be promoted to Owner.** It gains nothing
   while deactivated, but becomes an Owner if reactivated, with no active Owner
   deciding at that moment.
3. Smaller items carried to the final review are listed in
   `.superpowers/sdd/progress.md`.

---

## 7. Finishing

After Task 14: a whole-branch review on the most capable model, then merge
`feature/general-workplace` into `main` and push. The database is already
ahead of `main`, which is safe in this direction: the new tables and functions
are unreachable until the client ships.
