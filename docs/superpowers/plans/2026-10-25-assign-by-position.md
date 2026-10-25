# Assign by Position Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The PM or a coordinator has the AI draft who holds each unassigned task, using the
project's positions and per-project skill tags, and reviews the draft before saving. The same
suggestions fill in Tasks from notes rows that name nobody.

**Architecture:**
- **SQL** (`member-skills.sql`) owns three things:
  - the skill tags table and its rules;
  - one context function that returns everything the draft needs: candidates with their
    loads, positions, and the tasks that are eligible;
  - the trigger that clears tags on a role change.
- **`work-ai`'s new `assign` action** asks the model only for a match per task: a position id,
  a tag, or none. A pure module, shared by the function and Vitest, then picks the person,
  balancing load.
- **The app** adds skill chips on the Members tab, an Assign by position review dialog on the
  Tasks view, and suggestions inside Tasks from notes.

**Tech Stack:** React + TypeScript (Vite, Vitest), Supabase Postgres (RLS, plpgsql), a Deno
edge function (`supabase/functions/work-ai`), Anthropic SDK through the function's existing
`ask` helper.

**Spec:** `docs/superpowers/specs/2026-10-25-auto-assign-design.md`

## Global Constraints

- **Scope:** work projects only (`general_projects.class_board_id is null`). Class boards and
  `ClassTasksFromNotes` are untouched.
- **Nothing is written until Save.** The function only reads, through the caller's JWT.
- **Never offered as an assignee:** QA, stakeholders, or anyone whose profile status isn't
  `active`. A candidate has role `pm`, `coordinator` or `member` and an `active` profile (my
  call for "accepted": the same test `general_project_has_qa` uses).
- **Load:** the person's tasks in this project that aren't done and aren't archived (`status
  <> 'done' and archived_at is null`). Picks made earlier in the same draft add to it.
- **Tags:**
  - trimmed, inner spaces collapsed, 1–40 characters;
  - unique per person per project, ignoring case;
  - at most 12 per person per project.
- **Assign by position limits:** 60 tasks per run, oldest first. The `assign` action allows
  12 an hour and 50 a day. When Tasks from notes calls `assign`, it counts as one `assign`
  call (my call).
- **Copy:**
  - sentence case and active voice;
  - no exclamation marks, "please" or "successfully";
  - errors say what happened and what to do next.
- **Fixed copy strings:**
  - "Assign by position"
  - "Skills"
  - "No skills yet"
  - "No position fits"
  - "Named in the notes"
  - "Every open task already has someone on it."
  - "Add positions or skills on the Members tab first."
  - "Couldn't suggest people this time."
  - "N tasks changed while you were reviewing and were left as they are." (singular: "1 task
    changed while you were reviewing and was left as it is.")
- **Design tokens only.** Desktop first, then tablet, then phone.
- `npm run build` must pass before any task is called done.
- **SQL file and rebuild order:** `supabase/member-skills.sql` runs after `project-qa.sql`
  and before `anon-lockdown.sql` at the end. It redefines no function that another file owns,
  so it stays out of the CLAUDE.md seven-file re-run chain.
- **Live database:** run SQL with `node scripts/db.mjs <file>`. If the direct host fails
  with ENOTFOUND (it is sometimes IPv6-only), use a scratch wrapper that points at the
  pooler URL. Don't edit `.env.local`.

## Review Focus

1. **Several holders tie on load.** The pick must still be stable, the same for the same
   input, and must not always favour the first row the database returned. Pinned in Task 2:
   ties break on tag hits, then name.
2. **The model returns a position id or tag that doesn't exist, or uses different case**
   ("figma" for "Figma"). An unknown match becomes "No position fits", and tags match
   ignoring case. Pinned in Task 2.
3. **A task changes while the PM reviews:** someone takes it, or it is archived. Save skips
   it and says so, without failing the rest. Pinned in Task 5 (`planAssignSave`).
4. **Notes name someone who exists but can't hold tasks** (QA, a stakeholder, someone
   deactivated). The name is dropped, the row is suggested by position, and the reason line
   explains why. Pinned in Task 6 (`notesWhy`).
5. **A project with QA has unassigned tasks at or past the QA stage, plus bug tasks before
   it.** The first are left out of the draft and the bugs are kept. Pinned in Task 1's SQL
   test.

---

### Task 1: Skill tags and the assign context in SQL

**Files:**
- Create: `supabase/member-skills.sql`
- Create: `supabase/tests/member-skills.test.sql`
- Modify: `docs/07-backup.md`. Append `supabase/member-skills.sql` after
  `supabase/project-qa.sql` in both ordered command lines, and add a short paragraph on what
  the file owns.
- Modify: `scripts/schema-drift.mjs`. Append `member-skills` to `ORDER` after `project-qa`.

**Interfaces:**
- Produces the table `public.general_member_skills (project_id uuid, user_id uuid, tag text,
  created_at timestamptz default now())`.
  - Primary key `(project_id, user_id, tag)`.
  - Foreign key `(project_id, user_id)` references `general_members` on delete cascade.
  - Unique index on `(project_id, user_id, lower(tag))`.
  - Check: `tag = btrim(regexp_replace(tag, '\s+', ' ', 'g'))` and length between 1 and 40.
- Produces `public.general_assign_context(p_project uuid) returns jsonb`: security definer,
  stable, `search_path = public`. It returns this shape:

  ```json
  {
    "positions":  [{ "id": "uuid", "name": "text", "team_id": "uuid|null", "team": "text|null" }],
    "candidates": [{ "user_id": "uuid", "name": "First Last", "load": 0,
                     "teams": ["team uuid"], "positions": ["position uuid"], "tags": ["Figma"] }],
    "tasks":      [{ "id": "uuid", "title": "text", "description": "text", "team_id": "uuid|null" }],
    "left": 0
  }
  ```

  - **`positions`:** only the positions with at least one candidate holding them.
  - **`candidates`:** every eligible member (see Global Constraints), even with no position
    or tag. The picker ignores those.
    - `teams` comes from `general_team_members`, not from positions tied to a team (the
      spec's call).
    - `positions` comes from `general_position_holders`.
    - `name` is `first_name || ' ' || last_name`, trimmed.
  - **`tasks`:**
    - open (`status <> 'done'`), `archived_at is null`, with no row in
      `general_task_assignees`;
    - oldest `created_at` first, at most 60;
    - when `general_project_has_qa(p_project)` is true, only tasks with
      `general_task_stage_at(status, stage, stage_count(stages)) < general_qa_stage_index(p_project)`.
  - **`left`:** the number of eligible tasks beyond the 60.
  - **Refusals** (`raise exception … using errcode = 'insufficient_privilege'`):
    - "Only the project manager and coordinators can assign by position." when
      `general_has(p_project, 'manage_tasks')` is false or the project is a class board;
    - "This project is archived. An Owner can restore it to make changes." when
      `general_is_archived(p_project)`.

- [ ] **Step 1: Write the failing test** `supabase/tests/member-skills.test.sql`, in the style
  of `project-qa.test.sql`. Use `begin … rollback`, `pg_temp.act_as`, `act_as_service`,
  `must_refuse_with` and `must_allow`, set up fixtures as the service role, and pair every
  refusal with an allowed case. Cases:
  - **Who edits tags:**
    - A member adds and removes their own tag.
    - A member adding a tag for another member is refused (RLS: the insert affects 0 rows, or
      raises a policy error).
    - The PM and a coordinator add a tag for any member.
    - A member granted `manage_tasks` can do the same.
  - **Who can't have tags:**
    - Inserting a tag for a QA or stakeholder member is refused with "QA and stakeholders
      don't take tasks, so they have no skills.". A BEFORE INSERT trigger raises it.
    - A stakeholder can't add their own tag.
  - **Tag rules:**
    - The 13th tag for one person is refused with "Up to 12 skills each.".
    - "Figma" and then "figma" for the same person is refused (unique violation).
    - "  Figma  " is refused by the check. The app normalizes before inserting.
  - **Role change:** after the service role changes a member with two tags to `qa`, they
    have 0 tags. A member changed to `coordinator` keeps theirs.
  - **Archived project:** adding a tag is refused with "archived".
  - **Context:**
    - As the PM, `general_assign_context` returns:
      - the candidates (pm, coordinator, member), not QA, not the stakeholder, not a
        deactivated member;
      - `load` counting only open, non-archived tasks;
      - only unassigned open tasks.
    - In a project with QA (the default 3 stages, so the QA stage is index 1), an unassigned
      task in In progress is left out. An unassigned bug in To do is included.
    - A project with 61 eligible tasks gives `tasks` 60 long and `left` = 1.
    - A plain member calling the context is refused with "Only the project manager and
      coordinators".

- [ ] **Step 2: Run it to make sure it fails**

  Run: `node scripts/db.mjs supabase/tests/member-skills.test.sql`.
  Expected: an error that `general_member_skills` doesn't exist.

- [ ] **Step 3: Write `supabase/member-skills.sql`.** It must be idempotent, and it contains:
  - **The table:** `create table if not exists`, the unique index, and `enable row level
    security`.
  - **RLS:**
    - select: `is_general_member(project_id)`;
    - insert and delete: `general_can_write(project_id) and (user_id = auth.uid() or
      general_has(project_id, 'manage_tasks') or general_has(project_id, 'manage_structure'))`.
    - There is no update policy, since a tag is replaced by delete plus insert.
  - **Triggers:**
    - Attach `guard_general_structure` (owned by `project-team-leads.sql`; reuse it, don't
      redefine it) as a before insert or delete trigger, for the archived refusal.
    - A new `general_member_skills_check()` before insert trigger refuses QA and stakeholders,
      and refuses a 13th tag, with the messages above.
  - **Role-change trigger:** a new `general_member_skills_drop()`, attached as `after update
    of role on general_members for each row when (new.role in ('qa','stakeholder') and
    old.role is distinct from new.role)`, deletes that person's tags in that project.
  - **The context function** as specified in Interfaces, with
    `revoke all on function public.general_assign_context(uuid) from public, anon;` and
    `grant execute … to authenticated;`.
  - **Realtime:** add the table to `supabase_realtime` with the duplicate-safe loop
    `project-feedback.sql` uses.

- [ ] **Step 4: Apply it, then lock anon down again**

  Run: `node scripts/db.mjs supabase/member-skills.sql supabase/anon-lockdown.sql`.
  Expected: no errors.

- [ ] **Step 5: Run the tests**

  Run: `node scripts/db.mjs supabase/tests/member-skills.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql supabase/tests/project-qa.test.sql`.
  Expected: every line PASS, no FAIL.

- [ ] **Step 6: Update `docs/07-backup.md` and `scripts/schema-drift.mjs`, then run** `node scripts/schema-drift.mjs`.
  Expected: no new CHECK line naming `member-skills`.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/member-skills.sql supabase/tests/member-skills.test.sql docs/07-backup.md scripts/schema-drift.mjs
  git commit -m "Add per-project skill tags and the assign context"
  ```

---

### Task 2: The pick (pure module)

**Files:**
- Create: `supabase/functions/_shared/assignPick.ts`. It must be pure, with no Deno or
  browser APIs and no imports, so both Deno and Vite can load it.
- Test: `src/lib/work/assignPick.test.ts`, which imports
  `../../../supabase/functions/_shared/assignPick.ts`.

**Interfaces:**
- Produces:

  ```ts
  export type AssignCandidate = { userId: string; name: string; load: number; teams: string[]; positions: string[]; tags: string[] }
  export type AssignPosition = { id: string; name: string }
  export type AssignTaskIn = { key: string; title: string; description: string; teamId: string | null }
  export type AssignMatch = { key: string; kind: 'position' | 'tag' | 'none'; match: string; reason: string }
  export type AssignPick = { key: string; userId: string | null; kind: 'position' | 'tag' | 'none'; label: string; reason: string }
  export function pickAssignees(
    tasks: AssignTaskIn[], matches: AssignMatch[], candidates: AssignCandidate[], positions: AssignPosition[],
  ): AssignPick[]
  ```

  - The result has one pick per task, in task order.
  - `label` is the position's name, or the tag as the chosen candidate spells it. It is ''
    when `kind` is `'none'`.
  - A task with no entry in `matches` is `'none'`.

- [ ] **Step 1: Write the failing tests** in `src/lib/work/assignPick.test.ts`:
  - `gives a position task to its only holder`: kind `position`, label "Frontend developer",
    and the reason passed through.
  - `spreads ties by load`: holders A (load 2) and B (load 0) and three tasks matching the
    position give B, B, A. The third goes to A, since by then B has load 2 and A has 2, and A
    wins on name.
  - `prefers the task's team`: the task's `teamId` is T, holder A isn't in T (load 0), and
    holder B is in T (load 3). B gets it.
  - `falls back outside the team when nobody in it fits`: the only holder isn't in T, and
    still gets the task.
  - `breaks equal load by tag hits in the wording`: the task title "Build the Figma
    prototype", A has tag "Figma", B has none, and both have load 1. A gets it.
  - `matches tags ignoring case`: match `{kind:'tag', match:'figma'}` and a candidate tag
    "Figma" give label "Figma".
  - `drops a match that isn't real`: an unknown position id, or a tag nobody has, gives kind
    `none`, userId null and label ''.
  - `none stays none`: kind `none` gives userId null.
  - `same input, same output`: shuffling the order of `candidates` doesn't change any
    userId.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `npx vitest run src/lib/work/assignPick.test.ts`.
  Expected: FAIL, the module isn't found.

- [ ] **Step 3: Implement `pickAssignees`.** Keep a `Map<userId, load>` that starts from
  `candidate.load`. For each task in order:
  1. Resolve the match to a candidate pool: the holders of the position id, or the people
     with the tag (case-folded). An empty pool means `none`.
  2. Narrow the pool to the task's team when anyone in the pool is in it.
  3. Sort by load ascending, then tag hits descending, then `name.localeCompare`, then
     `userId`. Tag hits are the person's tags found case-insensitively in
     `title + ' ' + description`.
  4. Take the first, and add 1 to their load.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run src/lib/work/assignPick.test.ts`.
  Expected: PASS.

- [ ] **Step 5: Check the build accepts the import across folders**

  Run: `npm run build`.
  Expected: it succeeds.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions/_shared/assignPick.ts src/lib/work/assignPick.test.ts
  git commit -m "Pick task holders by position, tag and load"
  ```

---

### Task 3: The `assign` action and its client

**Files:**
- Modify: `supabase/functions/work-ai/index.ts`:
  - add `assignAction` and the `assign` entry in `ACTIONS` (`hour: 12, day: 50`);
  - list it in the header comment.
- Modify: `src/lib/api/workAi.ts`, adding the types and `draftAssignees`.

**Interfaces:**
- Consumes: `general_assign_context` (Task 1) and `pickAssignees` with its types (Task 2).
- Request body:
  - `{ action: 'assign', project_id, mode: 'tasks' }`, or
  - `{ action: 'assign', project_id, mode: 'drafts', drafts: { key: string; title: string; description: string; team: string }[] }`.
    `team` is a team name or ''; the function resolves it to an id from `positions[].team`
    and the project's teams.
- Response (`result: 'ok'`):
  `{ picks: (AssignPick & { title: string })[]; left: number; empty?: 'no_structure' | 'no_tasks' }`.
  - `mode: 'drafts'` takes at most 60 drafts and ignores the context's `tasks` and `left`.
  - `empty: 'no_structure'` means no position has a candidate and no candidate has a tag. The
    model isn't called.
  - `empty: 'no_tasks'` means `mode: 'tasks'` found nothing eligible.
- Client in `src/lib/api/workAi.ts`:

  ```ts
  export type AssignDraftIn = { key: string; title: string; description: string; team: string }
  export type AssignPickOut = { key: string; title: string; userId: string | null; kind: 'position' | 'tag' | 'none'; label: string; reason: string }
  export const draftAssignees = (projectId: string, source: { mode: 'tasks' } | { mode: 'drafts'; drafts: AssignDraftIn[] }) =>
    call<{ picks: AssignPickOut[]; left: number; empty?: 'no_structure' | 'no_tasks' }>('assign', projectId, source)
  ```

- [ ] **Step 1: Implement `assignAction(ctx: Ctx)`**:
  1. Call `ctx.caller.rpc('general_assign_context', { p_project: ctx.projectId })`. On an
     error, throw `new Refused(error.message, 403)`.
  2. Build the model input with **no names or loads**:
     - positions labelled `p1`, `p2`… with name, team name, and holder count;
     - the distinct tags across candidates;
     - tasks as `t1`… with title, description (capped at 600 characters each) and team name.
  3. Call `ask(…, 'low', 6000)` with the schema `obj({ matches: { type: 'array', items:
     obj({ task: str, kind: { type: 'string', enum: ['position','tag','none'] }, match: str,
     reason: str }) } })`.
  4. Map `p#` back to the position uuid and `t#` back to the task key, then run
     `pickAssignees`.
  5. Trim each `reason` to 120 characters.

  The system prompt carries exactly these rules from the spec, plus `VOICE`:
  - Choose for each task the position that does this kind of work, using the position names
    as this project uses them. They may be any field: software, research, events, anything.
  - Prefer a position. Use a skill tag only when no position fits, or to choose between
    positions that fit equally.
  - A task tied to a team prefers positions in that team.
  - Answer only with a position id or a tag from the lists. Answer `none` rather than
    stretch a match.
  - `reason`: at most about twelve words on why this kind of work fits, e.g. "Screen design
    is frontend work".

- [ ] **Step 2: Add the client types and `draftAssignees`** to `src/lib/api/workAi.ts`.

- [ ] **Step 3: Type-check and build**

  Run: `npm run build`.
  Expected: it succeeds. If `deno` is installed, also run
  `deno check supabase/functions/work-ai/index.ts` and expect no errors.

- [ ] **Step 4: Deploy**

  Run: `npx supabase functions deploy work-ai`.
  Expected: "Deployed Function work-ai". The function is deployed from the working tree, as
  `tasks` changes were before.

- [ ] **Step 5: Smoke-test against the live function** with a scratch script (not
  committed).
  - Sign in as a seeded test PM, or use the PM's session token from the browser pane's
    local storage.
  - POST `{ action:'assign', project_id:<a work project with positions>, mode:'drafts',
    drafts:[{ key:'1', title:'Design the login screen', description:'', team:'' }] }`.
  - Expected: `result: 'ok'` with one pick whose `kind` is `position` or `tag`.
  - The same call as a plain member gives `result: 'failed'` and "Only the project manager
    and coordinators can assign by position."

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/functions/work-ai/index.ts src/lib/api/workAi.ts
  git commit -m "Draft task holders by position in work-ai"
  ```

---

### Task 4: Skill tags on the Members tab

**Files:**
- Create: `src/lib/general/skills.ts`
- Test: `src/lib/general/skills.test.ts`
- Create: `src/components/general/SkillTags.tsx`
- Modify: `src/lib/general/types.ts`. Add `GeneralMemberSkill = { project_id: string;
  user_id: string; tag: string; created_at: string }`.
- Modify: `src/lib/api/general.ts`. Add `listMemberSkills(projectId)`,
  `addMemberSkill(projectId, userId, tag)` and `removeMemberSkill(projectId, userId, tag)`.
  Follow the pattern of the position-holder functions, with `changed(…)` on delete.
- Modify: `src/components/general/useGeneralProject.ts`:
  - add `skills: GeneralMemberSkill[]` to the state;
  - load it in the `Promise.all` and clear it when the project is missing;
  - add `'general_member_skills'` to `useLive`;
  - add `skillsOf: (userId: string) => string[]`.
- Modify: `src/components/general/MembersTab.tsx`. Render `<SkillTags>` in each member row of
  `MemberList`, for work projects only (`!state.project?.class_board_id`).

**Interfaces:**
- Produces, in `src/lib/general/skills.ts`:
  - `normalizeTag(raw: string): string | null`: trims and collapses spaces. Returns null
    when the result is empty or over 40 characters.
  - `SKILL_LIMIT = 12`.
  - `skillProblem(existing: string[], tag: string): string | null`, returning:
    - "That skill is already there." for a case-insensitive duplicate;
    - "Up to 12 skills each." at the limit;
    - "Keep a skill to 40 characters or fewer." when `normalizeTag` returns null on a
      non-empty input;
    - otherwise null.
  - `mayEditSkills(viewer: { id: string | undefined; role: ProjectRole | null; readOnly: boolean; can: (p: GeneralPermission) => boolean }, target: { userId: string; role: ProjectRole }): boolean`.
    It is true when:
    - the viewer isn't read-only;
    - the target's role is `pm`, `coordinator` or `member`;
    - and either the viewer is the target (and isn't QA or a stakeholder), or
      `can('manage_tasks')` or `can('manage_structure')`.

    It mirrors the RLS in Task 1.
- `SkillTags` props: `{ state: GeneralProjectState; member: GeneralMember }`.

- [ ] **Step 1: Write the failing tests** in `src/lib/general/skills.test.ts`:
  - `normalizeTag('  UI   design ')` gives `'UI design'`. `normalizeTag('   ')` gives null.
    A 41-character string gives null.
  - `skillProblem(['Figma'], 'figma')` gives "That skill is already there.".
  - Twelve existing tags give "Up to 12 skills each.".
  - `mayEditSkills`:
    - Self as member on self: true.
    - Member on another member: false.
    - Coordinator (can `manage_tasks`) on another member: true.
    - Anyone on a QA or stakeholder target: false.
    - Read-only viewer: false.
    - QA viewer on self: false.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `npx vitest run src/lib/general/skills.test.ts`.
  Expected: FAIL.

- [ ] **Step 3: Implement `skills.ts`, the API functions, the state changes and `SkillTags`.**
  - `SkillTags` shows the person's tags as small chips, using the `badge` tokens or the
    existing chip style in `TasksFromNotes`' shared-file chips.
  - Under the eyebrow-sized label "Skills", it shows "No skills yet" in `text-faint` when
    there are none.
  - When `mayEditSkills` is true:
    - each chip gets an × button (`aria-label="Remove skill <tag>"`);
    - an `Input` (`aria-label="Add a skill for <name>"`, placeholder "Add a skill") adds on
      Enter, after `skillProblem` passes;
    - problems show inline, and database errors show through `authErrorMessage` in a toast;
    - toasts read "Skill added" and "Skill removed".
  - Layout: on desktop the chips sit on the row under the name. On a phone they wrap
    full-width.

- [ ] **Step 4: Run the tests and build**

  Run: `npx vitest run src/lib/general/skills.test.ts && npm run build`.
  Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/general/skills.ts src/lib/general/skills.test.ts src/components/general/SkillTags.tsx src/lib/general/types.ts src/lib/api/general.ts src/components/general/useGeneralProject.ts src/components/general/MembersTab.tsx
  git commit -m "Let members list their skills on a work project"
  ```

---

### Task 5: Assign by position review dialog

**Files:**
- Create: `src/lib/work/assignDraft.ts`
- Test: `src/lib/work/assignDraft.test.ts`
- Create: `src/components/general/AssignByPosition.tsx`
- Modify: `src/components/general/TasksTab.tsx`:
  - add the "Assign by position" button (outline, `Icon name="spark"`) before "From notes";
  - show it only when `!state.readOnly && state.can('manage_tasks') &&
    !state.project?.class_board_id && state.myRole !== 'qa'`;
  - render the dialog.

**Interfaces:**
- Consumes `draftAssignees` and `AssignPickOut` (Task 3), and `updateTask(taskId, patch)` and
  `assignTask(taskId, projectId, userId)` from `src/lib/api/general.ts`.
- Produces, in `src/lib/work/assignDraft.ts`:
  - `AssignRow = { taskId: string; keep: boolean; title: string; originalTitle: string; people: string[]; kind: 'position' | 'tag' | 'none'; label: string; reason: string }`.
  - `rowsFromPicks(picks: AssignPickOut[]): AssignRow[]`:
    - `taskId` is `key`;
    - `title` and `originalTitle` are `pick.title`;
    - `people` is `userId ? [userId] : []`;
    - `keep` is true.
  - `reasonText(r: { kind: 'position' | 'tag' | 'none'; label: string; reason: string }): string`.
    It gives "Frontend developer · Screen design is frontend work" for a position, "tag:
    Figma · Uses the Figma file" for a tag, and "No position fits" for none. When the reason
    is empty, the " · reason" part is dropped.
  - `isAssignCandidate(m: GeneralMember): boolean`: the role is `pm`, `coordinator` or
    `member`, and the profile status is `active` or the profile is null. It mirrors Task 1's
    candidate rule.
  - `planAssignSave(rows: AssignRow[], tasksNow: GeneralTask[]): { apply: { taskId: string; title: string | null; people: string[] }[]; skipped: number }`.
    - It considers kept rows only.
    - A row is skipped (and counted) when its task is gone, archived, done, or now has any
      assignee.
    - `title` is the trimmed title when it changed and isn't empty, else null.
    - A row with no title change and no people is neither applied nor skipped.
  - `skippedMessage(n: number): string`: the fixed copy from Global Constraints, or '' for
    0.

- [ ] **Step 1: Write the failing tests** in `src/lib/work/assignDraft.test.ts`:
  - `reasonText`: all three kinds, plus an empty reason.
  - `planAssignSave`:
    - A row whose task gained an assignee is skipped, and a row whose task was archived is
      skipped (`skipped: 2`).
    - An unkept row is ignored.
    - A title edit gives `title: 'New'`. An unchanged title gives null.
    - A kept row with no people and no title change appears in neither `apply` nor
      `skipped`.
  - `isAssignCandidate`:
    - QA and stakeholder give false.
    - A member with profile status `deactivated` gives false.
    - A member with a null profile gives true.
  - `skippedMessage(1)` and `skippedMessage(3)` give the exact fixed strings.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `npx vitest run src/lib/work/assignDraft.test.ts`.
  Expected: FAIL.

- [ ] **Step 3: Implement `assignDraft.ts`.**

- [ ] **Step 4: Implement `AssignByPosition`**: props `{ state: GeneralProjectState; open:
  boolean; onClose: () => void }`, built on `Modal` like `TasksFromNotes`.
  - **Opening** calls `draftAssignees(project.id, { mode: 'tasks' })` with a spinner reading
    "Matching tasks to positions…".
  - **The result:**
    - `empty: 'no_tasks'` shows "Every open task already has someone on it."
    - `empty: 'no_structure'` shows "Add positions or skills on the Members tab first."
    - A failure shows the message in an `Alert`.
  - **Each row:**
    - a keep checkbox;
    - an editable title `Input`;
    - the people as removable chips, plus an "Add a person" `Select` over the members for
      whom `isAssignCandidate` is true and who aren't already chosen;
    - `reasonText` in `text-muted` (`text-faint` for none).
  - `left > 0` shows "`left` more tasks were left for the next run." above the list.
  - **Save** ("Save assignments"):
    1. Run `planAssignSave(rows, state.tasks)`.
    2. Per apply item, call `updateTask(taskId, { title })` when the title changed, then
       `assignTask` per person. Count failures without stopping.
    3. `await state.reload()`.
    4. Toast "Assignments saved" plus `skippedMessage`, plus " N could not be saved." when
       any failed.
    5. Close.
  - Save is disabled while saving, or when no kept row would change anything.

- [ ] **Step 5: Build, then check it in the browser pane**
  - Run: `npm run build`.
  - Then follow the preview workflow in CLAUDE.md and the system notes: open a work project
    with positions and unassigned tasks as its PM.
  - Expected:
    - The button shows, the draft lists rows with reasons, and edits stick.
    - Save assigns the people, and the toast reads correctly.
    - The button is hidden for a plain member and for QA.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/work/assignDraft.ts src/lib/work/assignDraft.test.ts src/components/general/AssignByPosition.tsx src/components/general/TasksTab.tsx
  git commit -m "Review and save task holders drafted by position"
  ```

---

### Task 6: Suggestions in Tasks from notes, and the docs

**Files:**
- Modify: `src/lib/work/assignDraft.ts` (add `notesWhy`).
- Test: `src/lib/work/assignDraft.test.ts`
- Modify: `src/components/general/TasksFromNotes.tsx`
- Modify: `CLAUDE.md`. Under "Project roles (work projects)", add a short bullet on Assign by
  position. Cover:
  - `general_member_skills` and `member-skills.sql` (outside the seven-file chain);
  - `general_assign_context`;
  - that the pick lives in `supabase/functions/_shared/assignPick.ts`.
- Modify: `handoff.md`. Append a new section at the end with what shipped, the files, the
  test counts, and a **Deferred** list with anything left.

**Interfaces:**
- Consumes `draftAssignees` (Task 3), and `isAssignCandidate` and `reasonText` (Task 5).
- Produces:
  - `NoteTaskRow` gains `why?: string`.
  - In `assignDraft.ts`:

    ```ts
    export function notesWhy(
      named: { name: string; blocked: 'qa' | 'stakeholder' | 'inactive' | null } | null,
      pick: { kind: 'position' | 'tag' | 'none'; label: string; reason: string } | null,
    ): string
    ```

    - Named and not blocked gives "Named in the notes".
    - Named and blocked with a pick of `position` or `tag` gives "Named Ana (QA can't hold
      tasks), suggested by position · " + `reasonText(pick)`. The blocked phrases are "QA
      can't hold tasks", "stakeholders can't hold tasks" and "not active on the project".
    - Named and blocked with a `none` pick, or no pick, gives "Named Ana (QA can't hold
      tasks) · No position fits".
    - Not named gives `reasonText(pick)` when there's a pick, else ''.

- [ ] **Step 1: Write the failing tests** for `notesWhy`, one per branch above, with the exact
  strings.

- [ ] **Step 2: Run them to make sure they fail**

  Run: `npx vitest run src/lib/work/assignDraft.test.ts`.
  Expected: FAIL on `notesWhy`.

- [ ] **Step 3: Implement `notesWhy`.**

- [ ] **Step 4: Wire it into `TasksFromNotes.draft()`.** This applies only on a work project:
  no `onSave` override, `mayAssign` true, and `!state.project?.class_board_id`.
  1. After the rows are built, work out each row's named person. That is `t.assignee`
     resolved through `state.members`; it's blocked when `!isAssignCandidate(member)`, and
     the blocked reason comes from the role or status.
  2. This replaces today's stakeholder-only filter: a blocked name is cleared from
     `assignee`.
  3. Send every row with an empty `assignee` to `draftAssignees(projectId, { mode: 'drafts',
     drafts })`, with `key` the row index as a string and `team` the row's team name.
  4. Fill `assignee` from `pick.userId` and `why` from `notesWhy`. A named, unblocked row
     gets "Named in the notes".
  5. If the call fails or returns `result: 'failed'`, keep the rows as they are and add
     "Couldn't suggest people this time." to `planNotes`. `empty: 'no_structure'` adds
     nothing.
  6. Show `why` under the person `Select` in `text-muted` text, at 12px.

  The class path, via `onSave`, behaves exactly as today. Its stakeholder filter stays for
  class projects.

- [ ] **Step 5: Run all tests and build**

  Run: `npx vitest run && npm run build`.
  Expected: all PASS, and the build succeeds.

- [ ] **Step 6: Check in the browser pane.** As the PM of a work project with positions, open
  From notes and paste notes with an unnamed design task, a task naming a QA member, and a
  task naming a member.
  Expected:
  - the design task shows a suggested person and a reason;
  - the QA-named task shows the "Named … (QA can't hold tasks), suggested by position" line;
  - the named member keeps "Named in the notes".

- [ ] **Step 7: Update `CLAUDE.md` and `handoff.md`, then commit and push**

  ```bash
  git add src/lib/work/assignDraft.ts src/lib/work/assignDraft.test.ts src/components/general/TasksFromNotes.tsx CLAUDE.md handoff.md
  git commit -m "Suggest people by position in Tasks from notes"
  git push
  ```
