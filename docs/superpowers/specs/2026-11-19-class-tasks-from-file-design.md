# Class tasks from a file, with a fit check — design

Date: 2026-11-19

## Intent

On a class project's Tasks tab a professor can today set a task by hand or "Draft with AI", which reads only the
project brief, rubric and syllabus weeks. Professors want to hand the AI a document they already have (a PDF, Word
or Excel task list) and get the tasks drafted from it, the way work spaces do with "Tasks from notes".

While it reads the file, the AI also checks each task against the project and the class, so tasks that are random or
off-topic do not slip onto every group's board. The same check applies to students, who already have "From notes" on
their group board with no check today: a group should not pad its board with tasks unrelated to the project.

## Goals

- Professor: a third action on the Tasks tab, "From a file", next to Draft with AI and Set a task. Upload a .pdf,
  .docx, .xlsx (also .csv, .txt, .md, same as notes), review the drafted tasks, save them as tasks the professor sets
  (every group, or one group).
- Every task drafted **from a file** in a class (the professor's new From a file, the students' From notes on a class
  board) carries a fit verdict: **Fits** or **Doesn't fit**, with a one-line reason when it does not fit.
- A task that doesn't fit is in the review list **unticked**, with its reason shown; the person can tick it back on.
  (User's choice: flag and untick, not drop, not warn only.)
- The fit is judged against the class project's guidelines, rubric and the syllabus weeks it covers (the material
  `generate-tasks` already gathers).

## Non-goals

- Work-space (non-class) "Tasks from notes" is unchanged: no fit check there.
- Draft with AI (`generate-tasks` without `text`, professors and students) is unchanged and gets no verdict: it
  drafts from the brief itself, and its prompt already requires every task to trace back to the brief, rubric or
  weeks. *(Builder-check call.)*
- No check on tasks typed by hand with Set a task or Add task.
- No milestones or sprints from the professor's file (milestones in a class are set on their own page; professor
  tasks have no sprint). Students' From notes keeps its existing sprint and milestone handling.
- No SQL change. Saving uses the existing `create_professor_task` and the students' existing save path.
- The file is never stored; only its text, read in the browser, goes to the function (as today).

## Anti-goals

- The check must never silently remove a task. The person always sees every task the file listed and decides.
- It must not flag good tasks for not repeating the guidelines' wording (a keyword match was rejected for this).
- It must not judge padding chores as "fits" just because the project is broad: generic chores ("Create a group
  chat", "Buy snacks") are "doesn't fit" unless the brief, rubric or weeks call for them.

## Approaches

- **A. Check while reading (chosen).** The one AI call that pulls tasks out of the file also gets the project brief,
  rubric and weeks and returns a verdict per task. Professors: `generate-tasks` gains a file-text input. Students: on
  a class board `work-ai`'s `tasks` action adds the brief and the verdict. The brief builder and the fit rules live in
  one shared helper. One AI call per upload; the model judges each task with the whole file in view.
- **B. Separate check after reading.** A second "fit" call takes the drafted list and the brief. One reusable checker,
  but two calls per upload (slower, costlier), and it judges bare titles without the file's context.
- Rejected: keyword matching against the guidelines (flags good tasks, misses padding).

## Design

### Shared helper `supabase/functions/_shared/classBrief.ts`

- `classProjectBrief(caller, projectId)` reads, through the caller's JWT (RLS decides), the fields `generate-tasks`
  reads today: `project_overview` (title, type, audience, total points, due, guidelines, start/end week, class id),
  `project_criteria` (rubric) and `class_week_map` for the project's weeks. Returns `null` when the project is not
  readable. Returns the project-level brief text (project, type, done by, worth, due, guidelines, rubric, weeks) and
  a `thin` flag. `generate-tasks` keeps adding its board-only lines itself (Team size after "Done by", and "Tasks the
  team already has" at the end), so its Draft with AI prompt is unchanged.
- `thin` is decided in code, not by the model: true when the guidelines are empty **and** there is no rubric **and**
  no week has detail. When `thin`, the function does not ask for a verdict; every task comes back `fits` and the
  note says "This project has too little written to check the tasks against." Unit-testable. *(Builder-check
  call: "all three missing", so a project with only a rubric is still checked against it.)*
- `FIT_RULES`: the prompt text for the verdict, used by both functions:
  - `fit`: `"fits"` when the task carries out something the guidelines, the rubric or the listed weeks ask for, or a
    step plainly needed to deliver it (research, design, build, test, document, present the project's own work).
    `"off"` when it serves none of them: unrelated to the project's subject, a generic chore, or work for another
    course.
  - `fit_reason`: when `off`, one short sentence naming what it does not match ("Not in the guidelines, rubric or
    weeks 5–8."). Empty when it fits.
- `generate-tasks` is refactored to build its brief through the helper; its Draft with AI prompt text stays
  byte-for-byte the same (a test pins it).

### Professor: "From a file"

- **Button:** "From a file" (icon `file` or the one notes uses) beside Draft with AI in `ProjectTasksView.tsx`, same
  outline small style. Shown wherever Draft with AI shows: every teacher of the class, co-teachers included, since
  `create_professor_task` checks `is_class_professor`, not the project's setter. *(Builder-check call: matches Draft
  with AI and Set a task.)*
- **Dialog:** a new `ClassTasksFromFileModal` (or a `source: 'file'` mode on `GenerateTasksModal`; builder's call),
  reusing `readNotesFile` / `NOTES_FILE_ACCEPT` / `NOTES_FILE_MAX` from `lib/general/notesFile.ts` for reading. Steps:
  pick file → "Reading the file…" → review list → Save.
- **Function:** `generate-tasks` accepts `{ project_id, text, file_name }`. With `text` it extracts tasks from the text
  instead of breaking the brief down: every task the file lists, in its order, up to 100; title (verb first, ~10
  words), details (what the file says, else one checkable sentence), weight 1–20 (relative size), due (YYYY-MM-DD
  only when the file states or clearly implies it, else empty), plus `fit` / `fit_reason`. The function does not
  judge repeats. Rate limits: the existing
  `ai_generate_tasks_hour` / `_day` buckets. Refusal and empty-text errors follow the notes copy ("That file is empty
  or nearly so. Upload the one with the tasks in it.").
- **Review list:** each row has a tick box, editable title, details, weight and due, and a label: Fits, Doesn't fit
  (with the reason on a second line), or Already set. Doesn't fit and Already set start unticked. A count line
  ("12 of 15 will be added."). The "every group / one group" target picker from Draft with AI. Save calls
  `createProfessorTask` per ticked row with `aiGenerated: true`, then the same toast and refresh as Draft with AI.
- **Already set** is worked out in the browser, against the professor's set tasks the Tasks tab already holds
  (`t.mine`, grouped by origin), and recomputed when the target changes: a row is Already set when a set task with the
  same title (trimmed, case-insensitive) already reaches the chosen target: for "Every group", a task handed to every
  group; for one group, a task that reached that group's board. A task set for only some groups does not count for
  "Every group", so no group silently misses it. When a row is both Already set and Doesn't fit, the label is Already
  set and the fit reason still shows on the second line. A target change unticks rows that newly become Already set
  and leaves the person's other ticks alone. *(Builder-check calls.)*

```
☑ Design the entity-relationship model     [Fits]
☑ Build the simulation loop                [Fits]
☐ Set up a team TikTok page                [Doesn't fit]
    Not in the guidelines, rubric or weeks 5–8.
☐ Write the project proposal               [Already set]
2 of 4 will be added.   Hand to: [Every group ▾]   [Add tasks]
```

### Students: From notes on a class board

- In `work-ai` `tasks`, when the project is a class board's hidden Files project (`class_board_id` not null), look up
  the board's class project (`task_boards.project_id`, read through the caller) and add the `classProjectBrief`
  text and `FIT_RULES` to the prompt; the task schema gains `fit` and `fit_reason`. Work projects send neither and
  get neither.
- `TasksFromNotes` rows: when a task has `fit === 'off'` it starts with `keep: false` and shows the Doesn't fit label
  with the reason on its second line. Today `why` is set only for work projects (`TasksFromNotes.tsx` sets it when
  `!onSave`), so on a class board the reason line and the label are both new; set `why` from `fit_reason`. Fits rows look as today, plus a quiet Fits
  label only in class mode, so the check is visible.
- Existing sprint, milestone, date and assignee behaviour is unchanged.

## Constraints

- Tokens only; copy rules from CLAUDE.md (sentence case, no "please", no "successfully").
- Desktop first, then tablet and phone (rows stack at 390 px).
- Both functions must be redeployed with the frontend (`generate-tasks`, `work-ai`).
- Every read in the functions goes through the caller's JWT; nothing is written by a function.

## Left to the builder

- Whether the professor dialog is a new component or a mode of `GenerateTasksModal`.
- The exact matching rule for Already set (case-insensitive trimmed title is enough to start).
- Max tokens and effort for the file call (the notes call's settings are a fair start).
- Tests: the helper's brief text (unchanged output for `generate-tasks`), the frontend row defaults (off → unticked,
  already set → unticked, reason shown), the dialog's save payload.
