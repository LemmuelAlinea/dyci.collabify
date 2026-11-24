# Task type icons, colors and presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every work and class task type a name, description, color and icon, editable per project in
Settings, with 14 presets, and draw the type's icon and color everywhere a type shows.

**Architecture:** One ordered `task_type_set jsonb` on `general_projects` and `projects`, written only by
`save_general_task_types` / `save_class_task_types` (which also keep the old `task_types text[]` in step and
rename tasks). Shared front-end code in `src/lib/taskTypes/` and `src/components/taskTypes/` serves both
families; tasks keep their existing columns and map to the set by slot or name.

**Tech Stack:** Postgres (Supabase) plpgsql, React 19 + TypeScript, Tailwind tokens, Motion `Reorder`, Vitest +
Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-25-task-type-looks-design.md` (read it first; its appendix holds the
14 presets verbatim).

## Global Constraints

- Work in a branch `task-type-looks`, created from `main` with `git worktree add` (the main checkout has
  another session's uncommitted files: never touch `src/pages/app/tasks/MyTasks.tsx`,
  `src/pages/general/SpaceWorkload*`, `src/components/general/WorkTaskOverlay.tsx`, `.gitignore`,
  `.claude/launch.json`). The spec and this plan are untracked in the main checkout: copy both into the
  worktree and commit them first ("Add the task type looks spec and plan"). Commit locally; never push `main`.
- The TasksTab New task form's class-board branch (`!work`, a class board's Files project) also switches to
  `TypePicker` over `typeOptions(project.taskTypeSet)`; its values stay `'task' | 'bug'`.
- `supabase/task-type-looks.sql` must be idempotent and runs after `stage-plan.sql`, before `anon-lockdown.sql`.
  It redefines no function, trigger or policy another file owns.
- No hardcoded colors in class names. The 13 swatch hexes and preset hexes are data (like a project's custom
  color). Everything else uses tokens from `src/styles/index.css`.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Limits: name 1–40 trimmed; description 0–120 trimmed; color `^#[0-9a-f]{6}$` (stored lowercase); at most 20
  custom entries; names distinct case-insensitively across the whole set.
- Reserved custom names: `task`, `bug` (work); `task` (class), any case.
- Default sets: work `Task` (#2563eb, `square-check`, "Standard actionable work.") + `Bug` (#dc2626, `bug`,
  "Errors, defects, and issues requiring fixes."); class: the `Task` entry only.
- Stale message: "Someone changed these task types. Reload to see them." with errcode
  `object_not_in_prerequisite_state`.
- Desktop first, then tablet (768), then phone (375). Dark mode via `.dark`; reduced motion honored.
- `npm run build` passes before any claim that something works.

## Review Focus

1. Two tabs: tab A renames Epic→Initiative, tab B (stale) saves a reorder. B must be refused and change nothing
   (Task 2 suite: stale `p_shown`; Task 8 test: stale error shows Reload).
2. A swap rename in one save (Feature↔Epic) and a rename plus delete in one save; tasks land on the right names
   (Task 2 suite).
3. A task whose type was removed opened in the task dialog: the picker shows its gray current type, and saving
   other fields doesn't fail on it (Task 10 test).
4. Free hex extremes `#ffff00`, `#000000`, `#777777` readable as chip text in light and dark (Task 4 test).
5. A planned-project Member never sees the bug slot in New task; QA sees only it; a class student's picker in
   `TaskExtras` lists the class set (Tasks 4, 10, 11 tests).

---

### Task 1: Columns, validator, guards and backfill (SQL)

**Files:**
- Create: `supabase/task-type-looks.sql`
- Create: `supabase/tests/task-type-looks.test.sql` (style of `supabase/tests/class-look.test.sql`: `begin;`,
  `pg_temp.act_as`, `pg_temp.act_as_service`, `pg_temp.must_be`, rolls back)

**Interfaces:**
- Produces: columns `general_projects.task_type_set jsonb not null`, `.task_type_set_shown text` (generated
  stored `md5(task_type_set::text)`), `.task_type_preset text`; the same three on `public.projects`.
  `public.task_type_icon_keys() returns text[]` (immutable SQL, the 68 keys in the order of
  `TASK_TYPE_ICONS`, Task 3). `public.task_type_set_problem(p_set jsonb, p_family text) returns text`
  (`p_family` is `'work'` or `'class'`; null when valid). Triggers `general_projects_task_type_set_guard` and
  `projects_task_type_set_guard`. Flag `collabify.task_type_save`.

- [ ] **Step 1: Write the failing suite (part 1)**

Cases, each a `must_be` line:
- a new work project's set is the two default entries; a new class project's set is the class default; a
  class-board Files project gets the work default; `task_type_set_shown = md5(task_type_set::text)`;
- `task_type_set_problem` returns, for: two defaults → "Keep one default type."; work with no bug → "Keep one bug
  type."; class with a bug → "Class projects have no bug type."; 21 customs → "Keep at most 20 custom task
  types."; `"epic"` and `"Epic"` → "Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the
  built-in types."; custom `"BUG"` (work) → same; custom `"Task"` (class) → "Use distinct names of 1 to 40
  characters. Task stays reserved for the built-in type."; `" Epic"` → the distinct-names message; 121-char
  description → "Keep each description to 120 characters."; `#DB2777` or `red` → "Choose a color as #rrggbb.";
  icon `rocket-ship` → "Choose an icon from the list."; an extra key or a missing key → "Each task type needs a
  slot, name, description, color and icon."; a slot named "Bug Task" passes;
- signed in as the project's pm, a direct `update general_projects set task_type_set = …`, `set task_types = …`
  and `set task_type_preset = 'x'` are each refused; a class professor's direct update of `projects.task_types`
  is refused; as service role the same updates pass (and invalid sets are still refused);
- backfill: a project with `task_types = '{Epic,Feature}'` and a default set gets `Epic` and `Feature` appended
  (slot null, description '', icon `tag`, colors `#0891b2` then `#9333ea`); running the backfill block again
  changes nothing.

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/db.mjs supabase/tests/task-type-looks.test.sql`
Expected: error, column `task_type_set` does not exist.

- [ ] **Step 3: Write part 1 of `supabase/task-type-looks.sql`**

`add column if not exists` for the six columns (defaults per Global Constraints, built with
`jsonb_build_array(jsonb_build_object(...))`). Validator checks in the order the messages above are listed;
messages exactly as listed. Guard trigger: BEFORE INSERT OR UPDATE OF `task_type_set, task_types,
task_type_preset`; refuse (errcode `insufficient_privilege`, "Change task types in Settings.") when
`auth.uid() is not null`, any of the three differ (UPDATE) or the set differs from the column default
(INSERT), and `current_setting('collabify.task_type_save', true)` is not `'on'`; then raise the validator's
message (errcode `check_violation`) if any; check `task_type_preset ~ '^[a-z0-9-]{1,40}$'` when not null.
Family: `general_projects` is `'work'`, `projects` is `'class'`. Backfill as a `do` block: for each row
where some `task_types` name isn't a custom entry's name, append the missing ones with the color cycle
`#0891b2 #9333ea #16a34a #d97706 #0d9488 #db2777 #4f46e5 #ea580c #64748b #a16207 #7c3aed` (cycle by the count
of customs already there), under the flag. Revoke the validator and trigger functions from
`public, anon, authenticated`.

- [ ] **Step 4: Apply and run**

Run: `node scripts/db.mjs supabase/task-type-looks.sql supabase/anon-lockdown.sql` then
`node scripts/db.mjs supabase/tests/task-type-looks.test.sql`
Expected: every line `PASS`.

- [ ] **Step 5: Re-run the file and the existing suites it sits beside**

Run: `node scripts/db.mjs supabase/task-type-looks.sql supabase/anon-lockdown.sql supabase/tests/task-type-looks.test.sql supabase/tests/project-task-types.test.sql supabase/tests/class-task-settings.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS (the two older suites write `task_types` directly; if they do so signed in, update those
suite lines to go through the service role and say so in the commit).

- [ ] **Step 6: Commit** — `git add supabase/task-type-looks.sql supabase/tests/task-type-looks.test.sql` and
any suite touched; message "Add task type sets: columns, checks and backfill".

### Task 2: Save and count functions (SQL)

**Files:**
- Modify: `supabase/task-type-looks.sql`
- Modify: `supabase/tests/task-type-looks.test.sql`

**Interfaces:**
- Consumes: Task 1's columns, `task_type_set_problem`, the flag.
- Produces (all `security definer`, `set search_path = public`, granted to `authenticated` only):
  - `save_general_task_types(p_project uuid, p_types jsonb, p_shown text, p_preset text default null) returns void`
  - `save_class_task_types(p_project uuid, p_types jsonb, p_shown text, p_preset text default null) returns void`
  - `general_task_type_counts(p_project uuid) returns table(name text, tasks int)`
  - `class_task_type_counts(p_project uuid) returns table(name text, tasks int)`
  - `p_types` entries are the five keys plus an optional `was text`.

- [ ] **Step 1: Write the failing suite (part 2)**

Cases:
- pm saves a reordered set with a new custom type and `p_preset 'software'`: set, `task_types` (customs in
  order) and `task_type_preset` all written; coordinator, member, QA, stakeholder and a non-member are refused
  with "Only the project manager changes task types."; an archived project → "Restore the project before
  changing task types."; a class-board Files project → "Class board files do not use work task types.";
- `p_shown` not equal to the stored `task_type_set_shown` → "Someone changed these task types. Reload to see
  them." with SQLSTATE `55000`, and nothing changed;
- rename: custom `Epic` with 2 live tasks and 1 trashed task, saved as `{name:'Initiative', was:'Epic'}` → all 3
  tasks read `Initiative`; swap `Feature`↔`Epic` in one save → each task carries the other name; rename `Epic`
  and delete `Feature` in one save → Epic's tasks renamed, Feature's keep `Feature`; renaming the default slot
  to `Research Task` and the bug slot to `Defect` changes no `general_tasks` row (compare `updated_at`);
- a rename writes no `general_task_events` row and no `notifications` row, and an enabled workflow rule
  ("task updated" style, whatever triggers exist in `project-workflow-rules.sql`) records no run;
- removing `Epic` leaves its tasks `task_type = 'Epic'`; `guard_general_task_type` then refuses setting another
  task to `Epic`; saving `Epic` back makes that update pass;
- QA's `create_general_open_task(... 'bug' ...)` still works and a QA `'task'` is still refused;
- class: the professor saves; a student is refused with "Only a professor changes task types."; a rename reaches
  project_tasks on two boards, including a board with a submission (`board_submitted` true) and a started task;
- counts: pm gets `(Epic, 2)` (trashed excluded, private planning rows included); a member gets no rows; the
  class professor gets counts over every board's copies; a student gets none;
- anon has no EXECUTE on any of the four (after `anon-lockdown.sql`).

- [ ] **Step 2: Run to see it fail** — `node scripts/db.mjs supabase/tests/task-type-looks.test.sql`;
expected: function `save_general_task_types` does not exist.

- [ ] **Step 3: Implement the four functions**

Save, in order: lock the project row (`for update`); permission checks with the messages above (work:
`general_role_of(p, auth.uid()) = 'pm'`, `general_is_archived`, `class_board_id is null`; class:
`is_class_professor(class_id)`); compare `p_shown` to `task_type_set_shown`; build the stored set by removing
`was` from each element (`elem - 'was'`) and validate with `task_type_set_problem`; compute the rename map
from entries whose `slot` is null, `was` is a custom name in the stored set, and `was <> name`; under
`collabify.task_type_save = 'on'` update the set, `task_types` (custom names in order) and, when `p_preset` is
not null, `task_type_preset`; then rename tasks in a single `update … set task_type = m.new_name from
(rename map) m where task_type = m.old_name` with `request.jwt.claims` and `request.jwt.claim.sub` cleared and
restored (the block pattern in `create_general_member_task`, `project-task-types.sql:135-149`), so every task
guard takes its service-role path. Work tasks: `general_tasks where project_id = p_project`. Class tasks:
`project_tasks where board_id in (select id from project_boards where project_id = p_project)`. If a suite case
shows a trigger still writing history or a rule run, set the existing flag that trigger already honors rather
than redefining it. Counts: work counts `general_tasks` with `trashed_at is null` and `task_type is not null`;
class counts `project_tasks` with `task_type <> 'Task'` and not trashed; both return nothing unless the caller
may save.

- [ ] **Step 4: Apply and run** — `node scripts/db.mjs supabase/task-type-looks.sql supabase/anon-lockdown.sql supabase/tests/task-type-looks.test.sql supabase/tests/anon-lockdown.test.sql`; expected all PASS.

- [ ] **Step 5: Commit** — "Save task type sets with renames and stale checks".

### Task 3: Icons

**Files:**
- Modify: `src/components/ui/Icon.tsx` (new paths; a comment noting the new glyphs follow Lucide's shapes, ISC)
- Create: `src/lib/taskTypes/icons.ts`
- Test: `src/lib/taskTypes/icons.test.ts`

**Interfaces:**
- Produces: `TASK_TYPE_ICONS: readonly TaskTypeIcon[]` (the 68 keys in this order: square-check, bug, rocket,
  layers, user-plus, list-todo, clipboard-check, zap, package, list-checks, file-text, circle-alert,
  circle-check, search, target, book-open, database, chart, flask, file-pen, shield-check, square-pen, scale,
  pie-chart, cog, calculator, users, globe, shield-alert, hard-hat, shovel, shopping-cart, wrench, scan-search,
  file-check, triangle-alert, handshake, building, key, map-pin, megaphone, wallet, lightbulb, pen-tool,
  palette, radio, send, calendar, truck, monitor-play, image, scissors, scan-eye, refresh-cw, user-search,
  filter, messages-square, graduation-cap, user-minus, briefcase, workflow, inbox, drafting-compass, factory,
  receipt, arrow-left-right, file-chart, tag); `type TaskTypeIcon`; `TYPE_ICON_GLYPH: Record<TaskTypeIcon,
  IconName>`; `typeIconLabel(key): string` ("Square check", "Arrow left right").
- Existing glyphs reused: search, target, database, chart, flask, users, globe, calendar, image, filter,
  briefcase, inbox, palette, `refresh-cw`→`refresh`, `cog`→`settings`. Every other key gets a new camelCase
  `IconName` (for example `squareCheck`, `hardHat`, `arrowLeftRight`). Also used as preset header icons:
  `kanban`, `code`, `school`, `building`, `megaphone`, `package`, `calculator`, `hardHat`.

- [ ] **Step 1: Write the failing tests** — `icons.test.ts`: the SQL list (regex
  `/task_type_icon_keys\(\)[\s\S]*?array\[([^\]]*)\]/` over `supabase/task-type-looks.sql`) equals
  `TASK_TYPE_ICONS` in order; 68 unique keys; every key's glyph renders an `<svg>` with a non-empty `d`;
  labels are unique and start with a capital.
- [ ] **Step 2: Run** `npx vitest run src/lib/taskTypes/icons.test.ts` — expected FAIL (module missing).
- [ ] **Step 3: Add the glyphs and `icons.ts`.** Each new glyph is one path string in the 24×24 box (circles
  and rects written as arcs/lines), stroke style unchanged.
- [ ] **Step 4: Run the test** — expected PASS.
- [ ] **Step 5: Commit** — "Add task type icons".

### Task 4: Shared type logic and looks

**Files:**
- Create: `src/lib/taskTypes/colors.ts`, `src/lib/taskTypes/look.ts`, `src/lib/taskTypes/typeSet.ts`
- Modify: `src/lib/palette.ts` (export the existing `mix`)
- Test: `src/lib/taskTypes/look.test.ts`, `src/lib/taskTypes/typeSet.test.ts`

**Interfaces:**
- Consumes: `TaskTypeIcon`, `TASK_TYPE_ICONS` (Task 3); `withContrast`, `groundFor`, `mix` from `lib/palette.ts`.
- Produces:
  ```ts
  export type TypeFamily = 'work' | 'class'
  export type TypeSlot = 'default' | 'bug' | null
  export type TaskTypeEntry = { slot: TypeSlot; name: string; description: string; color: string; icon: TaskTypeIcon }
  export type TaskTypeDraft = TaskTypeEntry & { was?: string }
  export type ResolvedType = TaskTypeEntry & { removed: boolean }
  export type TypeOption = { value: string; entry: ResolvedType }
  export const TYPE_SWATCHES: readonly { name: string; hex: string }[]   // 13, spec order, lowercase hex
  export function defaultTypeSet(family: TypeFamily): TaskTypeEntry[]
  export function typeSetProblem(set: TaskTypeEntry[], family: TypeFamily): string | null   // SQL messages verbatim
  export function typeKey(entry: TaskTypeEntry, family: TypeFamily): string  // work: 'task' | 'bug' | name; class: 'Task' | name
  export function resolveType(set: TaskTypeEntry[], task: { kind?: 'task' | 'bug'; task_type?: string | null }, family: TypeFamily): ResolvedType
  export function typeOptions(set: TaskTypeEntry[], opts: { family: TypeFamily; role?: 'pm'|'coordinator'|'member'|'qa'|'stakeholder'|null; memberPlanned?: boolean; current?: ResolvedType }): TypeOption[]
  export function removedNames(set: TaskTypeEntry[], names: (string | null | undefined)[], family: TypeFamily): string[]
  export function withWas(edited: TaskTypeEntry[], loaded: TaskTypeEntry[], renames: Map<number, string>): TaskTypeDraft[]
  export function parseTypeSet(raw: unknown, family: TypeFamily): TaskTypeEntry[]   // falls back to defaultTypeSet
  export function typeLook(color: string, mode: 'light' | 'dark'): { ground: string; ink: string; glyph: string }
  export function bannerGlyph(color: string, banner: string): string
  ```
  `removed` entries: gray via tokens (the component uses `surface-sunken text-muted`), icon `tag`, slot null.
  `typeOptions`: set order; `role 'qa'` → bug slot only; `memberPlanned` → no bug slot; `current` removed →
  appended last.

- [ ] **Step 1: Write the failing tests.** `typeSet.test.ts`:
  - `resolveType` for work kind bug → bug slot; null → default; `'Epic'` → Epic; `'Gone'` → removed with name
    `Gone`; class `'Task'` → default; a name equal to the bug slot's name on a `kind 'task'` row → removed;
  - `typeSetProblem` returns each SQL message for the same inputs as Task 1 Step 1;
  - `typeOptions` by role (pm all, member planned no bug, qa bug only), the removed current appended;
  - `withWas` sets `was` only on renamed customs;
  - `parseTypeSet(null, 'work')` equals the default set;
  - `removedNames` lists names not in the set, once each.
  
  `look.test.ts`: for each of the 13 swatches plus `#ffff00`, `#000000`, `#777777`, in both modes, `ink` has
  contrast ≥ 4.5 against `mix(g, color, 0.14)` for every ground `g` of `groundFor(mode, 0)` and
  `groundFor(mode, 100)` (surface, sunken, raised); `bannerGlyph` ≥ 3 against the banner hex.
- [ ] **Step 2: Run** `npx vitest run src/lib/taskTypes` — expected FAIL.
- [ ] **Step 3: Implement.** `typeLook.ground` is `color` with alpha `0x24` (`#rrggbb24`); `ink` and `glyph` are
  the color lifted with a contrast-against-all-grounds loop (take the lowest-contrast ground, `withContrast`,
  repeat until all pass, as `withContrastAll` in `palette.ts` does; export that helper instead if simpler).
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — "Add task type logic and readable looks".

### Task 5: Presets

**Files:**
- Create: `src/lib/taskTypes/presets.ts`
- Test: `src/lib/taskTypes/presets.test.ts`

**Interfaces:**
- Consumes: Task 4 types.
- Produces:
  ```ts
  export type TaskTypePreset = { key: string; name: string; icon: IconName; types: TaskTypeEntry[] }
  export const TASK_TYPE_PRESETS: readonly TaskTypePreset[]   // the spec appendix, in order, verbatim
  export function presetByKey(key: string | null | undefined): TaskTypePreset | null
  export function applyPreset(current: TaskTypeEntry[], preset: TaskTypePreset, family: TypeFamily): { set: TaskTypeEntry[]; removed: string[] }
  ```
  `applyPreset`: class turns the bug entry into a custom one (slot null); work with no bug entry appends the
  current bug slot unchanged; `removed` = current custom names not among the result's custom names.

- [ ] **Step 1: Write the failing tests:** 14 presets with keys `general software research feasibility
  construction real-estate business marketing events creative hr operations product finance`; type counts
  7, 8, 10, 9, 10, 10, 9, 9, 9, 9, 9, 9, 9, 9; one default each; bug slots exactly in general (Issue), software
  (Bug Task), construction (Deficiency), operations (Incident), product (Product Defect), finance (Discrepancy);
  `typeSetProblem(preset types (+ default bug when none), 'work')` is null for all; every hex matches
  `^#[0-9a-f]{6}$`; `applyPreset` cases: research on a work set keeps the current bug slot last; software on a
  class set gives `Bug Task` slot null and no bug slot; removed lists `Deliverable` when going from general to
  software; a custom with a preset's same name is not listed as removed.
- [ ] **Step 2: Run** `npx vitest run src/lib/taskTypes/presets.test.ts` — expected FAIL.
- [ ] **Step 3: Write the data and `applyPreset`.** Descriptions as in the appendix, without a trailing period.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — "Add the 14 task type presets".

### Task 6: API and project reads

**Files:**
- Create: `src/lib/api/taskTypes.ts`
- Modify: `src/lib/api/general.ts` (the `task_flow, task_types` select near line 196 and the returned object
  near line 230), `src/lib/general/types.ts:66-67`, `src/lib/api/projects.ts:76-97`
- Test: `src/lib/api/taskTypes.test.ts`

**Interfaces:**
- Consumes: Task 4 `parseTypeSet`, `TaskTypeDraft`.
- Produces:
  ```ts
  export async function saveTaskTypes(family: TypeFamily, projectId: string, types: TaskTypeDraft[], shown: string, preset?: string | null): Promise<void>
  export async function taskTypeCounts(family: TypeFamily, projectId: string): Promise<Map<string, number>>
  export const isStaleTypes: (err: unknown) => boolean   // message starts "Someone changed these task types"
  ```
  `GeneralProject` gains `taskTypeSet?: TaskTypeEntry[]`, `taskTypeShown?: string`, `taskTypePreset?: string | null`
  (selected with `task_type_set, task_type_set_shown, task_type_preset`; a missing column falls back to the
  default set, the same `isMissingColumn` pattern). `ClassTaskSettings` gains read-only `task_type_set`,
  `task_type_set_shown`, `task_type_preset`; `updateClassTaskSettings` sends only the editable keys (stages,
  default_priority, default_stage, the five switches) — never `task_types` or the set.

- [ ] **Step 1: Write the failing test** (mock `supabase.rpc` as other `lib/api/*.test.ts` do): `saveTaskTypes('work', …)`
  calls `save_general_task_types` with `{ p_project, p_types, p_shown, p_preset }`; class calls
  `save_class_task_types`; counts map rows to a `Map`; `isStaleTypes` true for the stale message only;
  `updateClassTaskSettings` payload has no `task_types`.
- [ ] **Step 2: Run** `npx vitest run src/lib/api/taskTypes.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and `npm run typecheck`** — expected PASS, no type errors.
- [ ] **Step 5: Commit** — "Read and save task type sets".

### Task 7: TypeIcon, TypeChip, TypePicker

**Files:**
- Create: `src/components/taskTypes/TypeIcon.tsx`, `TypeChip.tsx`, `TypePicker.tsx`
- Test: `src/components/taskTypes/TypeChip.test.tsx`, `TypePicker.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–4 (`typeLook` with `useTheme().resolved`, `bannerGlyph`, `TYPE_ICON_GLYPH`).
- Produces:
  ```tsx
  <TypeIcon entry={ResolvedType} size={16 | 20 | 36} />
  <TypeChip entry={ResolvedType} size?: 'sm' | 'md' onBanner?: boolean />   // title = description
  <TypePicker id?: string value={string} options={TypeOption[]} onChange={(value: string) => void} disabled?: boolean label: string />
  ```
  Picker: a button showing the chip and a chevron; a `role="listbox"` popover with `role="option"` rows (icon,
  name, description in `text-[12px] text-muted`); ArrowUp/ArrowDown move, Enter picks, Escape closes and
  returns focus; under 640 px the popover is full width. Removed entries render gray (`surface-sunken
  text-muted`, `tag` icon).

- [ ] **Step 1: Write the failing tests:** chip shows the name, `title` is the description, inline style uses
  `typeLook` output; removed chip has the muted class and no inline color; banner chip uses `text-banner-ink`;
  picker opens on click, arrows and Enter call `onChange('Epic')`, Escape closes, descriptions visible, disabled
  doesn't open.
- [ ] **Step 2: Run** `npx vitest run src/components/taskTypes` — expected FAIL.
- [ ] **Step 3: Implement** (wrap tests in the existing `ThemeProvider` test helper the repo's component tests use).
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — "Add type chip, icon and picker".

### Task 8: TaskTypesEditor

**Files:**
- Create: `src/components/taskTypes/TaskTypesEditor.tsx`, `TypeEditPanel.tsx`
- Test: `src/components/taskTypes/TaskTypesEditor.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–7; `Reorder`, `useDragControls`, `useReducedMotion` from `motion/react`; `ConfirmDialog`,
  `Button`, `IconAction`, `Input`, `Alert`.
- Produces:
  ```tsx
  type TaskTypesEditorProps = {
    family: TypeFamily
    set: TaskTypeEntry[]; shown: string; preset: string | null
    editable: boolean
    readOnlyNote: string            // "Only the project manager changes task types." / "Only a professor changes task types."
    save: (types: TaskTypeDraft[], shown: string, preset?: string | null) => Promise<void>
    loadCounts: () => Promise<Map<string, number>>
    reload: () => Promise<void>
  }
  export function TaskTypesEditor(props: TaskTypesEditorProps): JSX.Element
  ```
  Copy: heading "Task types"; "Manage how work is categorized within this project."; "Based on the {name}
  preset." when `presetByKey(preset)`; buttons "Browse presets", "+ Add type"; slot labels "Default", "QA's bugs";
  panel title "Edit task type" with fields Name, Description, Color, Icon, Preview; buttons "Delete type",
  "Cancel", "Save type"; delete confirm "Delete {name}?" with body "{n} tasks keep the name, shown in gray." (no
  body at 0; "1 task keeps …" singular); unsaved switch confirm "Discard changes to {name}?"; live line "{name}
  moved to position {n}."; at 20 customs Add is disabled with title "Keep at most 20 custom task types."; toasts
  "Task type saved", "Task type deleted", "Task types reordered". A stale error shows the message with a
  "Reload" button calling `reload()`.

- [ ] **Step 1: Write the failing tests:** edit Epic's name to Initiative → `save` receives the full set with
  `{ name: 'Initiative', was: 'Epic' }`; Add type opens a panel prefilled with the first swatch not used and icon
  `tag`; invalid name shows the `typeSetProblem` message and doesn't save; delete with 3 tasks shows "3 tasks keep
  the name, shown in gray."; slot rows have no Delete; focusing a handle and pressing ArrowDown saves the swapped
  order and announces it; read-only shows no handle, pencil or buttons and shows `readOnlyNote`; Add disabled at
  20 customs; a `save` that rejects with the stale message shows Reload, which calls `reload`.
- [ ] **Step 2: Run** `npx vitest run src/components/taskTypes/TaskTypesEditor.test.tsx` — expected FAIL.
- [ ] **Step 3: Implement.** Layout per the spec sketch: desktop rows `grid-cols-[auto_auto_minmax(0,14rem)_1fr_auto_auto]`
  (handle, tile 36, name, description truncated, slot label, pencil); under 640 px the description moves under
  the name, panel fields stack, the icon grid is 6 columns (10 from `sm`, 12 from `lg`), Browse presets and Add
  share a row. Swatches are round buttons with `aria-label` "{Swatch name}" and `aria-pressed`; the hex field
  uses `normalizeHex` and stores lowercase. Reorder animation off under reduced motion.
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — "Add the task types editor".

### Task 9: PresetDialog and the Settings wiring

**Files:**
- Create: `src/components/taskTypes/PresetDialog.tsx`
- Modify: `src/components/taskTypes/TaskTypesEditor.tsx` (Browse presets opens it),
  `src/components/general/settings/TasksSection.tsx` (replace `TaskTypesPanel`),
  `src/components/classes/ClassTaskSettings.tsx` (replace the name inputs at lines ~56-105 with the editor; types
  save on their own)
- Test: `src/components/taskTypes/PresetDialog.test.tsx`; update
  `src/components/general/settings/TasksSection.test.tsx`, `src/components/classes/ClassTaskSettings.test.tsx`

**Interfaces:**
- Consumes: Tasks 5, 6, 8; `Modal` (size `lg`; `placement` sheet on phone if the Modal supports it, else full
  width), `Select`.
- Produces: `<PresetDialog open family current={TaskTypeEntry[]} currentPreset={string|null} loadCounts onApply={(set, presetKey) => Promise<void>} onClose />`.
  Copy: title "Explore task type presets"; count "{n} types"; buttons "Cancel", "Apply preset"; confirm step
  title "Apply {preset name}?", body "These types leave the list: Deliverable (4 tasks), Planning (2 tasks).
  Their tasks keep the name, shown in gray." plus, when a removed name equals a slot name in the new set,
  "{name} tasks from the old list stay gray. They aren't QA's bugs." (work bug slot) or "… They aren't the
  default type." (default slot); buttons "Go back", "Apply preset"; toast "Applied the {preset name} preset."
  Apply goes straight through when no removed name has tasks.
- Work wiring: `editable = state.myRole === 'pm' && !state.readOnly`; `save` → `saveTaskTypes('work', …)` then
  `state.reload()`; class wiring: `editable = !readOnly` (the tab is the teacher's), `reload` refetches
  `getClassTaskSettings`.

- [ ] **Step 1: Write the failing tests:** the select starts on the project's preset or General Project; switching
  to Construction shows "10 types" and Deficiency labeled "QA's bugs" (work) / unlabeled (class); Apply with no
  counted removals calls `onApply` with `applyPreset(...).set` and `'construction'`; with counts it shows the
  confirm list with counts; Go back returns; TasksSection renders the editor for a pm and the read-only note for
  a coordinator; ClassTaskSettings renders the editor and its Save no longer sends `task_types`.
- [ ] **Step 2: Run** `npx vitest run src/components/taskTypes src/components/general/settings/TasksSection.test.tsx src/components/classes/ClassTaskSettings.test.tsx` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — "Add task type presets to Settings".

### Task 10: Work surfaces

**Files:**
- Modify: `src/components/general/TaskDialog.tsx` (lines ~160, ~718-720, ~752, ~820, ~880),
  `src/components/general/TasksTab.tsx` (~139-146 filter, ~669 and ~809 chips, ~909-916 and ~1130-1160 New task),
  `src/components/work/BacklogView.tsx:412`, `src/components/work/SprintsView.tsx:98,235`,
  `src/components/work/QaQueue.tsx:52`, `src/lib/general/types.ts:349-354`, and any caller of `BugBadge`
- Delete: `src/components/general/BugBadge.tsx`
- Test: update `src/components/general/NewTaskDialog.test.tsx` and the TaskDialog / TasksTab tests that assert
  "Bug" or type options; add cases below

**Interfaces:**
- Consumes: Tasks 4, 6, 7. `set = project.taskTypeSet ?? defaultTypeSet('work')`.
- Replace `taskTypeOptions`/`taskTypeOf` with `typeOptions`/`typeKey`/`resolveType` (keep `taskTypeOf` only if
  still used for the filter value; values stay `'task' | 'bug' | name`, so `TaskForm` payloads are unchanged).
  Filter options: `typeOptions(set)` then each `removedNames(...)` name as label "{name} (removed)".
  Every task shows `TypeChip` (the default included) on list rows, board cards, backlog and sprints rows; the
  dialog banner uses `onBanner`; the QA hint reads "QA creates {bug slot name} tasks only."

- [ ] **Step 1: Write the failing tests:** New task as planned-project Member has no bug option; as QA the picker
  is fixed to the bug slot's name; a pm project with set [Research Task(default), Defect(bug), Epic] shows those
  three names in that order; a board card for a plain task shows "Research Task"; a task with `task_type 'Gone'`
  shows a gray "Gone" chip, the filter lists "Gone (removed)", and the dialog picker shows Gone as current and
  saving the title alone sends no `task_type` change.
- [ ] **Step 2: Run** the touched test files — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/general src/components/work` — expected PASS.
- [ ] **Step 5: Commit** — "Show task type icons and colors on work tasks".

### Task 11: Class surfaces

**Files:**
- Modify: `src/components/tasks/TaskCard.tsx:134-136`, `src/components/tasks/detail/TaskExtras.tsx:37-110`,
  `src/components/tasks/TaskForm.tsx:22-98`, `src/components/tasks/FanOutForm.tsx:107-207`,
  `src/components/tasks/TaskBoard.tsx:333` (pass `taskTypeSet` instead of `taskTypes`)
- Test: update `src/components/tasks/detail/TaskExtras.test.tsx`; add a `TaskCard` chip case

**Interfaces:**
- Consumes: Tasks 4, 6, 7. `set = parseTypeSet(settings?.task_type_set, 'class')`. Props named `taskTypes?:
  string[]` become `taskTypeSet?: TaskTypeEntry[]`. Values stay `'Task' | name`.

- [ ] **Step 1: Write the failing tests:** TaskCard for `task_type 'Task'` shows the class default's name and
  chip; `TaskExtras` picker lists the class set in order with descriptions, and a removed type shows as current.
- [ ] **Step 2: Run** `npx vitest run src/components/tasks` — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/tasks` then `npm run build` — expected PASS and a clean build.
- [ ] **Step 5: Commit** — "Show task type icons and colors on class tasks".

### Task 12: Docs, live apply and browser check

**Files:**
- Modify: `CLAUDE.md` (new bullet "Task type looks" after "Custom work task types"), `docs/07-backup.md`
  (insert `supabase/task-type-looks.sql` after `supabase/stage-plan.sql` in both full rerun commands, and a
  paragraph: what it owns, no re-run needed after `project-task-types.sql` or `class-task-settings.sql`, re-run
  `anon-lockdown.sql` after it), `handoff.md` (new section at the end, with a **Deferred** list)

- [ ] **Step 1: Run every check** — `npm run check`; expected: typecheck, lint, tests, build, contrast,
  a11y-names, schema-drift, motion-lint and legal-ready pass. Fix any `schema-drift` finding by listing the file.
- [ ] **Step 2: Confirm the live database** — `node scripts/db.mjs supabase/tests/task-type-looks.test.sql
  supabase/tests/project-task-types.test.sql supabase/tests/class-task-settings.test.sql
  supabase/tests/anon-lockdown.test.sql`; expected all PASS.
- [ ] **Step 3: Browser check** with `preview_start` (`npm run dev`), signed in as a pm of a throwaway work
  project and a professor of a test class, at desktop, 768 and 375, light and dark: apply Construction, rename
  Deficiency, set `#ffff00` on a type, reorder by keyboard and by drag, delete a type with tasks, then see chips
  on the board, list, backlog, sprints, QA queue, task dialog banner, and a class board card and task detail.
  Screenshot each width. Move the throwaway project to Trash.
- [ ] **Step 4: Write the docs**, with the handoff naming the branch, suites and counts.
- [ ] **Step 5: Commit** — "Document task type looks"; stop and ask the owner to review before any merge to
  `main` or push.
