# Class Tasks From a File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Professors draft class tasks from an uploaded file, and every task drafted from a file in a class (professor
or student) carries a Fits / Doesn't fit verdict; tasks that don't fit start unticked with a reason.

**Architecture:** One shared Deno helper (`supabase/functions/_shared/classBrief.ts`) builds the class project brief,
the fit rules and the verdict normalizer; `generate-tasks` gains a file-text mode and `work-ai` `tasks` adds the brief
and verdict on class boards. The browser reads the file (existing `readNotesFile`), works out Already set, and saves
through the existing `createProfessorTask` / board save paths. No SQL.

**Tech Stack:** React + TypeScript, Vitest (happy-dom for components), Supabase Edge Functions (Deno, Anthropic SDK).

**Spec:** `docs/superpowers/specs/2026-11-19-class-tasks-from-file-design.md`

## Global Constraints

- Tokens only (`surface-sunken`, `text-muted`, `border-line`, status ramps `success-*` for Fits, `warning-*` for
  Doesn't fit, `pending-soft`/`pending-ink` for Already set); never `emerald-*`, `red-*` or brand amber for a status.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Exact copy: button "From a file"; labels "Fits", "Doesn't fit", "Already set"; count "{n} of {m} will be added.";
  thin note "This project has too little written to check the tasks against."
- Desktop first, then tablet and phone; no horizontal overflow at 390 px.
- Every function read goes through the caller's JWT; functions write nothing.
- Draft with AI (`generate-tasks` without `text`) prompt stays byte-for-byte the same.
- Work-space (non-class) Tasks from notes is unchanged.
- `npm run build` passes before anything is called done. Commit locally on `main`; push and function deploys
  (`generate-tasks`, `work-ai`) only after the user says so, together with the frontend.

## Review Focus

1. An older `work-ai` deploy returns tasks without `fit`: every row must stay ticked as today (undefined = fits).
2. The model returns an unexpected `fit` value ("maybe", "", "Fits"): treat anything but `"off"` as fits, never drop.
3. The professor ticks rows by hand, then changes the target: only rows that newly become Already set untick.
4. Every drafted task doesn't fit: all unticked, count "0 of N will be added.", Add disabled until one is ticked.
5. A file the model finds no tasks in: the note shows, no rows, Add disabled, no crash.

Each line has its test in the task that owns the code (Tasks 1, 3 and 4).

---

### Task 1: Shared class brief, fit rules and verdict normalizer

**Files:**
- Create: `supabase/functions/_shared/classBrief.ts`
- Test: `src/lib/work/classBrief.test.ts` (imports `../../../supabase/functions/_shared/classBrief`, like
  `notesSchedule.test.ts`)

**Interfaces:**
- Produces:
  - `type ClassBriefData = { project: { title: string; type: string; type_label: string | null; audience: string; total_points: number; due_at: string | null; guidelines: string | null; start_week: number; end_week: number }; criteria: { label: string; description: string; max_points: number }[]; weeks: { week_no: number; title: string; topics: string; outcomes: string; assessments: string }[] }`
  - `buildClassBrief(data: ClassBriefData, extras?: { teamSize?: number; existing?: string[] }): { text: string; thin: boolean }`
  - `readClassBrief(caller: SupabaseClient, projectId: string): Promise<ClassBriefData | null>` (the three reads
    `generate-tasks` does today, `null` when `project_overview` returns nothing)
  - `FIT_RULES: string` (prompt text from the spec's fit rules)
  - `FIT_SCHEMA_FIELDS = { fit: { type: 'string', enum: ['fits', 'off'] }, fit_reason: { type: 'string' } }`
  - `normalizeFit(raw: unknown, reason: unknown, thin: boolean): { fit: 'fits' | 'off'; fit_reason: string }` —
    `'off'` only when `raw === 'off'` and not `thin`; reason trimmed, cut to 200, empty when fits.

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the same brief Draft with AI sends today', () => {
  expect(buildClassBrief(sample, { teamSize: 4, existing: ['Write the proposal'] }).text).toBe(SAMPLE_BRIEF)
})
it('is thin only when guidelines, rubric and week detail are all missing', () => {
  expect(buildClassBrief(empty).thin).toBe(true)
  expect(buildClassBrief({ ...empty, criteria: [rubricRow] }).thin).toBe(false)
  expect(buildClassBrief({ ...empty, project: { ...empty.project, guidelines: 'Build a model' } }).thin).toBe(false)
})
it('marks off only for "off", never when thin', () => {
  expect(normalizeFit('off', ' Not in weeks 5–8. ', false)).toEqual({ fit: 'off', fit_reason: 'Not in weeks 5–8.' })
  for (const raw of ['fits', 'Fits', 'maybe', '', undefined]) expect(normalizeFit(raw, 'x', false)).toEqual({ fit: 'fits', fit_reason: '' })
  expect(normalizeFit('off', 'x', true)).toEqual({ fit: 'fits', fit_reason: '' })
})
```

`SAMPLE_BRIEF` is copied from what today's `generate-tasks` builds for `sample` (run its brief code by hand once;
Team size after "Done by", existing tasks last). A week with title only counts as "no detail".

- [ ] **Step 2: Run** `npx vitest run src/lib/work/classBrief.test.ts` — expected FAIL (module missing).
- [ ] **Step 3: Implement** `classBrief.ts` by moving the brief lines out of `generate-tasks/index.ts` unchanged.
- [ ] **Step 4: Refactor** `generate-tasks/index.ts` to call `readClassBrief` + `buildClassBrief(data, { teamSize, existing })` for its existing path; no prompt text change.
- [ ] **Step 5: Run** the test — expected PASS; `npm run typecheck` clean.
- [ ] **Step 6: Commit** `Share the class project brief between the AI functions`

### Task 2: `generate-tasks` file mode

**Files:**
- Modify: `supabase/functions/generate-tasks/index.ts`
- Modify: `supabase/functions/_shared/classBrief.ts` (add `shapeFileTasks`)
- Test: `src/lib/work/classBrief.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Request `{ project_id, text, file_name }` → `{ result: 'ok', tasks: FileTask[], note: string, thin: boolean }`
    or `{ result: 'failed', message }`.
  - `type FileTask = { title: string; details: string; weight: number; due: string; fit: 'fits' | 'off'; fit_reason: string }`
  - `shapeFileTasks(parsed: unknown, thin: boolean): FileTask[]` — drops empty titles, keeps order, caps at 100,
    title ≤140, details ≤600, weight clamped 1–20, `due` kept only if `YYYY-MM-DD` (use `validDay` from
    `notesSchedule.ts`), verdict through `normalizeFit`.

- [ ] **Step 1: Failing test** `shapeFileTasks` — 101 rows in → 100 out; `{ title: ' ' }` dropped; `weight: 50` → 20;
  `due: 'next week'` → `''`; `fit: 'off'` with `thin` → `'fits'`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `shapeFileTasks`, then the file branch in `generate-tasks`: when `body.text` is a non-empty
  string, require ≥20 chars ("That file is empty or nearly so. Upload the one with the tasks in it."), cut at 60000,
  same two rate-limit buckets, a file-extraction system prompt (every task the file lists, in order, up to 100;
  title verb-first ~10 words; details from the file else one checkable sentence; weight 1–20 relative size; due only
  when stated or clearly implied; `FIT_RULES` appended unless `thin`), schema items gain `due` and, unless `thin`,
  `FIT_SCHEMA_FIELDS`; `max_tokens` 32000, effort `medium`. When `thin`, prefix the note with the thin copy.
- [ ] **Step 4: Run** — PASS; typecheck clean.
- [ ] **Step 5: Commit** `Draft professor tasks from a file's text with a fit verdict`

### Task 3: Browser helpers — Already set and row defaults

**Files:**
- Create: `src/lib/classFileTasks.ts`
- Test: `src/lib/classFileTasks.test.ts`
- Modify: `src/lib/api/tasks.ts` (add `generateTasksFromFile`)

**Interfaces:**
- Produces:
  - `generateTasksFromFile(projectId: string, text: string, fileName: string)` → `invokeFunction<{ result: 'ok'; tasks: FileTask[]; note: string; thin: boolean } | { result: 'failed'; message: string }>('generate-tasks', { project_id, text, file_name })` (re-declare `FileTask` in `src/lib/classFileTasks.ts`; don't import Deno code into the app bundle).
  - `alreadySetTitles(rows: ProjectTask[], boardCount: number, target: string): Set<string>` — keys are
    `title.trim().toLowerCase()` of professor-origin rows (`origin_id` set) that reach the target: `target === ''`
    → origins present on `boardCount` distinct boards; else → origins with a row on `board_id === target`.
  - `type FileRow = FileTask & { keep: boolean; already: boolean }`
  - `fileRows(tasks: FileTask[], already: Set<string>): FileRow[]` — `already` from the set; `keep = fit !== 'off' && !already`.
  - `retarget(rows: FileRow[], already: Set<string>): FileRow[]` — recomputes `already`; a row that becomes already
    gets `keep: false`; every other row keeps its `keep`.
  - `fitLabel(row: { fit?: string; already?: boolean }): 'Already set' | "Doesn't fit" | 'Fits'`

- [ ] **Step 1: Failing tests**

```ts
it('counts a task for every group only when it reached every board', () => {
  const rows = [r('o1', 'b1', 'Write the proposal'), r('o2', 'b1', 'Build the model'), r('o2', 'b2', 'Build the model')]
  expect(alreadySetTitles(rows, 2, '')).toEqual(new Set(['build the model']))
  expect(alreadySetTitles(rows, 2, 'b1')).toEqual(new Set(['write the proposal', 'build the model']))
})
it('starts off and already-set rows unticked, and keeps undefined fit ticked', () => { /* fit undefined → keep true */ })
it('unticks only rows that newly become already set on a target change', () => {
  // row A ticked by hand though off, row B fits: retarget making B already → A stays true, B false
})
it('labels a row both already set and off as Already set', () => {
  expect(fitLabel({ fit: 'off', already: true })).toBe('Already set')
})
it('counts 0 of N when every task is off', () => { /* fileRows all off → every keep false */ })
```

- [ ] **Step 2: Run** `npx vitest run src/lib/classFileTasks.test.ts` — FAIL.
- [ ] **Step 3: Implement** the helpers and `generateTasksFromFile`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Work out already-set and fit defaults for drafted class tasks`

### Task 4: Professor "From a file" dialog

**Files:**
- Create: `src/components/tasks/ClassTasksFromFileModal.tsx`
- Modify: `src/components/classProject/ProjectTasksView.tsx` (button beside Draft with AI, modal mount)
- Test: `src/components/tasks/ClassTasksFromFileModal.test.tsx` (happy-dom, mocks like `MemberImportDialog.test.tsx`)

**Interfaces:**
- Consumes: Task 3 (`generateTasksFromFile`, `alreadySetTitles`, `fileRows`, `retarget`, `fitLabel`),
  `readNotesFile` / `NOTES_FILE_ACCEPT` / `NotesFileError` from `lib/general/notesFile.ts`, `createProfessorTask`,
  `endOfDay` from `lib/taskPlan`.
- Props: `{ open: boolean; onClose: () => void; project: ProjectSummary; boards: BoardSummary[]; rows: ProjectTask[]; onSaved: (message: string) => Promise<void> }` (pass `t.rows`).

- [ ] **Step 1: Failing tests** — mock `readNotesFile` and `generateTasksFromFile`:
  - upload → rows show labels Fits / Doesn't fit (with reason) / Already set; off and already rows unticked;
    "2 of 4 will be added."
  - every row off → "0 of 3 will be added." and Add disabled; ticking one enables it.
  - `tasks: []` with a note → note visible, no rows, Add disabled.
  - target change to a group that already has row B → B unticked, a hand-ticked off row stays ticked.
  - Add → `createProfessorTask` once per ticked row with `{ projectId, title, details, weight, dueAt: endOfDay(due), boardId: target || null, aiGenerated: true }`; `onSaved('2 tasks added')`.
  - `NotesFileError` from the reader → its message in an error Alert, no call to the function.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the modal (size `xl`, title "Tasks from a file"; file input; "Reading the file…" status;
  rows editable like `GenerateTasksModal`: title, details, weight, due; label as a `Badge` — success for Fits,
  warning for Doesn't fit, pending for Already set; reason as `text-[12px] text-muted` second line; target `Select`
  "Every group ({n})" + one per board, `retarget` on change; footer count + Add). Rows stack to one column below
  `sm`. Button "From a file" with the notes icon, `variant="outline" size="sm" className="!rounded-lg"`.
- [ ] **Step 4: Run** the test and `npx vitest run src/components/classProject src/components/tasks` — PASS.
- [ ] **Step 5: Commit** `Let a professor draft class tasks from a file`

### Task 5: Students' From notes on a class board gets the verdict

**Files:**
- Modify: `supabase/functions/work-ai/index.ts` (`tasks` action)
- Modify: `src/lib/api/workAi.ts` (`DraftedWorkTask` gains `fit?: 'fits' | 'off'; fit_reason?: string`)
- Modify: `src/components/general/TasksFromNotes.tsx` (row defaults, label, reason)
- Test: `src/components/general/TasksTab.member.test.tsx` or a new `TasksFromNotes.fit.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`readClassBrief`, `buildClassBrief`, `FIT_RULES`, `FIT_SCHEMA_FIELDS`, `normalizeFit`),
  Task 3 (`fitLabel`).

- [ ] **Step 1: Failing test** — render `TasksFromNotes` with a mocked draft returning one `fit: 'off', fit_reason: 'Not in weeks 5–8.'`
  task and one without `fit`: the off row is unticked and shows "Doesn't fit" and the reason; the other is ticked
  and shows "Fits" (class mode: the hidden Files project, `state.project.class_board_id` set). A work-project render
  of the same draft shows no labels and keeps both ticked as today.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in `work-ai`: when `!work`, read `task_boards.project_id` for the project's
  `class_board_id` through the caller, then `readClassBrief`; if readable, add a "Class project brief:" block with
  `buildClassBrief(...).text` to the prompt, append `FIT_RULES` and add `FIT_SCHEMA_FIELDS` to the task items unless
  `thin`; map each task's verdict with `normalizeFit`; prefix the note with the thin copy when thin. Unreadable brief
  → no verdict (old behaviour). In `TasksFromNotes`, for class projects only: `keep: t.fit !== 'off'`,
  `why: t.fit === 'off' ? t.fit_reason : <existing>`, and a `fitLabel` badge on the row.
- [ ] **Step 4: Run** the test plus `npx vitest run src/components/general` — PASS.
- [ ] **Step 5: Commit** `Check students' class tasks from notes against the project`

### Task 6: Verify, hand off

- [ ] **Step 1:** `npm run build` — passes; `npx vitest run` — all pass.
- [ ] **Step 2:** Browser check on the dev server (`collabify` in `.claude/launch.json`), signed in as a professor on a
  class project: the From a file button and dialog at 1280 and 390 px, light and dark, with the function's response
  stubbed in the page's network layer if the new `generate-tasks` is not deployed yet (deploying is the user's call).
- [ ] **Step 3:** Append a section to the end of `handoff.md` (what shipped, the deploy order: `generate-tasks` and
  `work-ai` with the frontend, the calls made); add one bullet to CLAUDE.md's project notes on the fit check
  (`_shared/classBrief.ts`, no SQL).
- [ ] **Step 4: Commit** `Note class tasks from a file in the handoff`; ask the user before pushing and deploying.
