# Task type icons, colors and presets — design

Date: 2026-11-25. Status: draft for the owner's review.

## Why

Collabify's projects aren't all software. BSIT groups run feasibility studies, research, events and
business plans, and companies run construction, HR and finance work. Today a project manager can add
extra type names next to Task and Bug, but a type is only a word: no icon, no color, no description,
no order, and no quick way to set up a sensible list. The owner wants every task type to carry an
icon and a color, editable per project, and 14 industry presets that fill a project's types in one
step, so a task's kind can be read at a glance everywhere it appears.

## Goals

- Every task type has a name, a description, a color and an icon, including the built-in Task and Bug.
- The project manager (work projects) or the professor (class projects) edits them in Settings:
  rename, describe, recolor, re-icon, add, delete and drag to reorder.
- 14 presets, browsed one at a time, applied with one button.
- A type's icon and color show everywhere a task's type shows today, plus the QA queue.
- Renaming a type carries through to its tasks.

## Non-goals

- No new places that don't show a type today (My tasks, Calendar, Home, reports, CSV exports,
  notification text).
- AI task generation does not pick types.
- No presets at project creation; presets live in Settings → Tasks only.
- No per-person or school-wide type libraries. Types are per project.

## Anti-goals

- A color that can't be read in light or dark mode, or one that breaks someone's Appearance colors.
- Losing a task's type silently: a removed type stays visible on its old tasks.
- Weakening QA's rule: the bug kind stays the database's rule, whatever the bug type is called.

## Decisions the owner made

1. **Two fixed slots.** Each work project has one *default* type (a task with no type) and one *bug*
   type (`kind = 'bug'`, which QA's rules use). Both can be renamed, described, recolored and
   re-iconed, never deleted. A class project has the default slot only (classes have no QA).
2. **Applying a preset replaces** the list. A confirmation says how many tasks use a type that goes
   away. Those tasks keep the name, shown as a gray chip (today's rule), and adding the type back
   reconnects them.
3. **Work and class projects both** get the editor and the presets.
4. **Project manager only** on a work project; the professor (`is_class_professor`) on a class
   project. Everyone else sees the list read-only.
5. **Colors:** 13 named swatches plus a free hex field. Chips tint the color and lift the text so it
   reads in light and dark.
6. **Descriptions** show in Settings, under each choice in the type pickers and as the chip's tooltip.
7. **The button says "Apply preset"**, and presets live in Settings → Tasks only.
8. **Renaming:** tasks follow the new name. Deleting a type leaves its tasks with the name in gray.
9. **Storage: approach A** (below).
10. **Every task shows its type chip**, the default type included.

## Approaches considered

- **A. One ordered list on the project row (chosen).** A `task_type_set jsonb` column on
  `general_projects` and on `projects`, written only through one save function per family. That
  function also keeps today's `task_types text[]` in step, so the existing guards and every
  create-task function keep working unchanged, and reads follow the project row's existing read
  rules (stakeholders, Workspace visibility, teacher reads). Types have no ids, so a rename is sent as
  the new name plus the old one (`was`).
- **B. A types table with ids, tasks pointing at an id.** The cleanest renames, but it rewrites every
  create-task function (member, open, the workload wrapper, the professor functions), both guards and
  the class defaults, and needs read policies for every way a project is read. Too much surface for
  at most 22 rows.
- **C. Keep the name list and add a looks map keyed by name.** The smallest change, but order,
  descriptions, renames and slots get split across two fields that can drift apart.

## Data

### The set

`general_projects.task_type_set jsonb not null` and `projects.task_type_set jsonb not null`: an
ordered array (array order is the display order everywhere). Each entry:

| key | value |
|---|---|
| `slot` | `"default"`, `"bug"` (work only) or `null` for a custom type |
| `name` | 1–40 characters, trimmed |
| `description` | 0–120 characters, trimmed |
| `color` | `#rrggbb`, lowercase |
| `icon` | a key from `TASK_TYPE_ICONS` (below) |

Rules, checked in the database:

- Exactly one `default` entry. Work: exactly one `bug` entry. Class: none.
- At most 20 custom entries (22 rows on a work project, 21 on a class project), as today.
- Names are distinct case-insensitively across the whole set, slots included.
- A custom name may not be `task` or `bug` on a work project, or `task` on a class project, in any
  case. These are the keys the existing data and guards use (see "How tasks map to types"). Slots may
  carry any name, including "Bug Task".
- Every entry has exactly these five keys, with the types above.

Column defaults:

- Work: `[{slot:"default", name:"Task", description:"Standard actionable work.", color:"#2563eb",
  icon:"square-check"}, {slot:"bug", name:"Bug", description:"Errors, defects, and issues requiring
  fixes.", color:"#dc2626", icon:"bug"}]`
- Class: the default entry only.

`general_projects.task_type_preset text` and `projects.task_type_preset text`, both nullable: the key
of the last preset applied (for example `software`), shown as "Based on the System and Software
Development preset." It must match `^[a-z0-9-]{1,40}$`. Editing a type keeps it, and the app shows
nothing for a key it doesn't know.

`task_types text[]` stays, derived: the custom names in set order. Writing `task_types` or
`task_type_set` directly is refused for signed-in callers. Only the save functions write them, under
the transaction flag `collabify.task_type_save`. Service-role writes (no `auth.uid()`) pass, as other
guards allow.

### How tasks map to types

Task rows don't change shape.

- Work: `kind = 'bug'` → the bug slot; `task_type is null` → the default slot; otherwise the custom
  entry with that exact name; no match → a *removed* type (gray chip, `tag` icon, the stored name).
- Class: `task_type = 'Task'` → the default slot; otherwise the custom entry with that name; no
  match → removed.

So renaming a slot changes no task rows. Renaming a custom type updates the tasks that carry the old
name.

A removed name can match a slot's name, for example old custom "Issue" tasks after General Project
makes "Issue" the bug slot. Those tasks stay gray, because a slot matches by `kind` and null, never by
name, and they are never converted. The preset confirmation names this case ("Issue tasks from the old
list stay gray. They aren't QA's bugs."), and filters label them "(removed)". Adding a custom type with
a removed name reconnects its old tasks, as decision 2 says. (My call.)

### Backfill (idempotent)

For each work or class project whose `task_types` holds a name its `task_type_set` lacks, append a
custom entry for that name: `description ''`, `icon 'tag'`, and a color from the swatch order, skipping
blue and red. Re-running the file changes nothing once every name is in the set. Live today: one work
project with one typed task, and no class project, so the backfill is tiny.

## Database functions (`supabase/task-type-looks.sql`)

Runs after `stage-plan.sql` and before `anon-lockdown.sql`. It adds columns, a shared validator,
triggers and functions, and redefines nothing another file owns. The existing
`guard_general_project_task_types`, `guard_general_task_type`, `guard_class_task_settings` and
`guard_class_task_rules` stay as they are and keep running alongside. Re-running
`project-task-types.sql` or `class-task-settings.sql` needs no re-run of this file. Re-running this file
means re-running `anon-lockdown.sql` after it.

- `task_type_set_problem(p_set jsonb, p_family text) returns text`: null when the set is valid,
  otherwise the person-facing message. Internal, no EXECUTE for `authenticated`.
- A BEFORE INSERT/UPDATE trigger on each table: validates `task_type_set`, and refuses a signed-in
  change to `task_type_set`, `task_types` or `task_type_preset` without the flag.
- `save_general_task_types(p_project uuid, p_types jsonb, p_shown text, p_preset text default null) returns void`,
  security definer:
  - The caller is the project's `pm`, the project is a work project (`class_board_id is null`) and it
    isn't archived. These are the same three rules and messages as `guard_general_project_task_types`.
  - Each `p_types` entry may carry `was` (its name when the editor loaded it). Strip `was`, validate,
    then write the set, the derived `task_types` and `task_type_preset` in one UPDATE under the flag.
  - Renames: for each custom entry whose `was` differs from its `name`, and where `was` named a custom
    type in the stored set, update `general_tasks.task_type` from `was` to `name` for that project, in
    one statement mapping every rename at once, so swaps work. This covers every row, trashed and
    archived tasks included. It runs with claims cleared, as the other system writes in this codebase
    do, and must not write task history, fire workflow rules or send notifications. The builder checks
    each `general_tasks` update trigger and pins this in the suite. A rename of a slot updates no task.
  - `p_preset` sets `task_type_preset`. Null keeps the stored value.
  - Stale saves are refused. The function takes `p_shown text`, a fingerprint of the set as the
    editor loaded it (md5 of the stored `task_type_set::text`, which the app reads with the set). When
    it no longer matches, nothing is written and the error is "Someone changed these task types. Reload
    to see them." (errcode `object_not_in_prerequisite_state`, never `serialization_failure`, which
    makes the API retry). Two professors can teach one class, and a project manager can have two tabs
    open, so without this a stale `was` could rename the wrong tasks. Precedent: `shown` in
    `apply_stage_plan`. (My call.)
- `save_class_task_types(p_project uuid, p_types jsonb, p_shown text, p_preset text default null) returns void`:
  the same for `projects`. The caller is `is_class_professor(class_id)`. Renames update
  `project_tasks.task_type` on every board of the project, started, submitted and locked boards
  included. If a lock or submission trigger refuses that, the builder runs the rename past it the way
  other professor-wide label changes do, and the suite pins a rename on a submitted board.
- `general_task_type_counts(p_project uuid)` and `class_task_type_counts(p_project uuid)` return
  `(name text, tasks int)`: live (not trashed) tasks per stored custom name. Work counts include
  private planning rows. Class counts every group's copy. Readable by the same people who may save,
  and they return nothing to anyone else. The editor uses them for the delete and preset
  confirmations.

Error copy follows the repo rules, for example "Only the project manager changes task types.",
"Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.",
"Choose a color as #rrggbb.", "Choose an icon from the list.", "Keep at most 20 custom task types."

## Frontend

### Shared code (`src/lib/taskTypes/`)

- `icons.ts`: `TASK_TYPE_ICONS`, the ordered keys the editor's grid offers. It covers every icon the
  presets use plus `tag`. A Vitest test holds it to the SQL list, the way `CLASS_ICONS` is held to
  `class-look.sql`. Each key maps to an `IconName`. Missing glyphs are added to `components/ui/Icon.tsx`
  in its style: one 24×24 path, stroke 1.7, round caps. They are drawn from Lucide's shapes (ISC
  license, noted in `Icon.tsx`), converted to single paths.
- `colors.ts`: the 13 swatches as data (Blue `#2563eb`, Red `#dc2626`, Cyan `#0891b2`, Purple
  `#9333ea`, Green `#16a34a`, Amber `#d97706`, Teal `#0d9488`, Magenta `#db2777`, Indigo `#4f46e5`,
  Orange `#ea580c`, Slate `#64748b`, Ochre `#a16207`, Violet `#7c3aed`). These are user-pickable values
  like a project's custom color, not styling, so they live as data and never as Tailwind classes.
- `look.ts`: `typeLook(color, mode)` returns `{ ground, ink }`. Ground: the color at about 14% over the
  surface. Ink: the color lifted with `withContrast` to 4.5:1 against the current mode's grounds (light,
  and dark at the person's depth, from `lib/palette.ts`). The mode comes from `useTheme()`. A test runs
  all 13 swatches and a set of awkward hexes (`#ffff00`, `#000000`, `#777777`) through both modes. In
  the task dialog's banner, the chip keeps the banner's ink for the name (as today) and the icon takes
  the type color lifted to 3:1 against the banner, as `colorAccent` does for project colors.
- `typeSet.ts`: parse and validate a set (mirrors the SQL rules and messages), `resolveType(set, task,
  family)` (the mapping above, with the removed fallback), `typeOptions(set, { role })` (picker
  options in set order; a work Member never gets the bug slot, QA gets only it), and `withWas(...)`
  (rename bookkeeping for the save call).
- `presets.ts`: the 14 presets (appendix) as data: `key`, `name`, `icon`, `types[]`, each type with
  `slot`. `applyPreset(current, preset, family)` returns the new set and the list of removed custom
  names. A class turns the preset's `bug` entry into a custom one. When a work preset has no bug entry,
  the current bug slot is kept as it is, at the end of the list.

### Components (`src/components/taskTypes/`)

- `TypeIcon`: the colored icon tile (sizes 16, 20, 36).
- `TypeChip`: icon + name, tinted, with the description as `title`. A removed type is gray with the
  `tag` icon. It has a banner variant. It replaces `BugBadge` (delete it once every caller has moved).
- `TypePicker`: a button showing the chosen chip that opens a listbox: one row per option with icon,
  name and the description in muted 12px. Arrow keys, Enter and Escape work, with `role="listbox"`.
  On a phone it opens full width. It replaces the type `Select` in the work New task form, the work
  task dialog and the class `TaskForm`, `FanOutForm` and `TaskExtras`.
- `TaskTypesEditor`: the Settings card, shared by work and class (props: set, preset key, editable,
  family, save, load counts).
- `PresetDialog`: "Explore task type presets".

### Where types show (each moves to `TypeChip` / `TypePicker`, in set order)

Work: the task dialog (banner chip, the details "Type" row, the type picker), `TasksTab` (list rows,
board cards, the New task picker, the type filter), `BacklogView`, `SprintsView` (both places), and
`QaQueue` (bug slot chip). Class: `TaskCard`, `TaskExtras`, `TaskForm`, `FanOutForm`, plus
`TaskBoard` passing the set down. Filters list the set in order, then any removed names found on
tasks, each labeled "Issue (removed)", so a removed name that matches a live type's name is never
listed twice. Every task shows its type, the default included (today a plain task shows nothing).
The owner chose this.

Copy that names the bug kind as a label (chips, picker options, filter options, a "New bug"-style
button) uses the bug slot's name. Explanatory sentences and database errors keep "bug".

### The Settings card

Placement: work Settings → Tasks, after Task flow (replacing `TaskTypesPanel`); class Settings →
General, in the task settings, replacing the name inputs there. Types save on their own, not with the
class settings' Save button, and `updateClassTaskSettings` stops sending `task_types`.

Desktop:

```
Task types                                         [Browse presets] [+ Add type]
Manage how work is categorized within this project.
Based on the System and Software Development preset.
────────────────────────────────────────────────────────────────────────────────
⠿ [☑] Task                 General development work            Default     ✎
⠿ [🐞] Bug Task            Software defects                    QA's bugs   ✎
⠿ [🚀] Deployment          System releases and delivery                     ✎
⠿ [⚡] Epic                Large bodies of work                             ✎
   ┌ Edit task type ──────────────────────────────────────────────────────┐
   │ Name [Epic            ]   Description [Large bodies of work       ] │
   │ Color ● ● ● ● ● ● ● ● ● ● ● ● ●   [#db2777]                          │
   │ Icon  ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ …                                      │
   │ Preview [⚡ Epic]                                                     │
   │ [Delete type]                                  [Cancel] [Save type]  │
   └──────────────────────────────────────────────────────────────────────┘
```

- Slot rows carry a small mono label: "Default" and "QA's bugs" (work) / "Default" (class). They
  have no Delete.
- The pencil opens the inline panel under its row. One panel is open at a time, and opening another
  with unsaved changes asks first. "+ Add type" opens the same panel at the end, preset with the next
  unused swatch and the `tag` icon. Save type sends the whole set through the save function.
- Delete type (custom only) confirms: "Delete Deployment? 4 tasks keep the name, shown in gray." With
  no tasks: "Delete Deployment?".
- Drag by the handle to reorder, saving on drop. Keyboard: focus the handle, then Up and Down move the
  row and save, with an `aria-live` line ("Epic moved to position 3."). Reorder uses Motion's
  `Reorder` (already a dependency) and honors reduced motion.
- A stale save ("Someone changed these task types. Reload to see them.") shows the error with a Reload
  button that reloads the list and drops the open panel's changes.
- At 20 custom types, "+ Add type" is disabled with the reason as a tooltip.
- Read-only (anyone else): no handles, pencils or buttons, and the line "Only the project manager
  changes task types." (class: "Only a professor …").
- Tablet: the same layout, with descriptions truncated to one line. Phone (under 640 px): the
  description drops under the name, the panel's fields stack, the icon grid runs 6 columns, and
  Browse presets and Add type share a row.
- Dark mode: tiles and chips go through `typeLook`. All other surfaces use existing tokens.

### The presets dialog

`Modal` titled "Explore task type presets". On a phone it is a full-screen sheet.

- A `Select` of the 14 presets, opening on the project's own preset when it has one, else General
  Project.
- The preview header shows the preset's icon and name, with "8 types" on the right. A row per type:
  icon tile, name, description, a color bar and the hex in mono. Slot rows carry the same "Default" /
  "QA's bugs" labels.
- Footer: Cancel and Apply preset. When nothing with tasks would leave, Apply saves straight away.
  Otherwise the dialog shows a confirm step: "Apply System and Software Development?" followed by
  "These types leave the list: Deliverable (4 tasks), Planning (2 tasks). Their tasks keep the name,
  shown in gray." and the buttons [Go back] [Apply preset].
- Toast: "Applied the System and Software Development preset."

## Tests

- SQL suite `supabase/tests/task-type-looks.test.sql`:
  - defaults for new work, class and class-board Files projects;
  - the backfill, including a re-run;
  - every validator rule;
  - who may save: the pm saves; coordinator, member, QA, stakeholder and a non-member are refused; an
    archived project and a class-board Files project are refused; a professor saves a class project
    and a student is refused;
  - direct writes refused for `task_type_set`, `task_types` and `task_type_preset`;
  - renames: work tasks follow, trashed ones included; a swap works; a slot rename touches no task row;
    a class rename reaches started and submitted boards; no history row, workflow-rule run or
    notification;
  - a stale `p_shown` is refused and writes nothing;
  - removal leaves the name, and adding it back reconnects the tasks;
  - `guard_general_task_type` still refuses a removed name on edit;
  - QA still creates bugs only;
  - counts are visible only to whoever may save;
  - anon has no EXECUTE.
- Vitest:
  - presets data: 14 presets; counts 7, 8, 10, 9, 10, 10, 9, 9, 9, 9, 9, 9, 9, 9; exactly one default
    each and at most one bug; names unique; icons in `TASK_TYPE_ICONS`; hex colors;
  - `TASK_TYPE_ICONS` against the SQL list, and an `Icon` path for every key;
  - `resolveType`, `typeOptions` by role, `applyPreset` (slot mapping, class conversion, removed list,
    a preset with no bug entry), `withWas`, the set validator against the SQL messages;
  - `typeLook` contrast in both modes;
  - `TaskTypesEditor` (edit, add, delete confirm, keyboard reorder, read-only, the 20 limit),
    `PresetDialog` (switching, count, confirm list, straight apply), `TypePicker` (keyboard,
    descriptions, role filtering), `TypeChip` (removed gray, banner variant);
  - the existing `TasksSection`, `ClassTaskSettings`, `NewTaskDialog` and `TaskExtras` tests updated.
- `npm run build`, then a browser check on desktop, tablet (768) and phone (375), light and dark:
  apply a preset, rename, recolor with a free hex, reorder, delete with tasks, and see the chips on
  the board, list, backlog, sprints, QA queue, task dialog and a class board.

## Docs and deploy

- CLAUDE.md gets a "Task type looks" entry; `docs/07-backup.md` lists the file in the rerun order;
  `handoff.md` gets a new section.
- Deploy the SQL (then `anon-lockdown.sql`) and the frontend together. No Edge Function changes.
- Commit locally on a branch. Don't push `main` without the owner's review.

## Left to the builder

- Exact Lucide-derived paths for the new glyphs.
- Which `general_tasks` / `project_tasks` triggers need a flag or cleared claims so a rename stays
  silent, and how a class rename passes submission locks. Both are pinned by the suite.
- The exact tint percentage and the chip's paddings, within the token rules.

## Appendix: presets

Key, name, header icon; then each type as name · color · icon · description. **D** marks the default
slot and **B** the bug slot.

1. `general` General Project (icon `kanban`): **D** Task · #2563eb · square-check · Standard actionable work; Deliverable · #9333ea · package · Required project output; Planning · #d97706 · list-checks · Planning and preparation; Documentation · #64748b · file-text · Project records and documents; Review · #0d9488 · clipboard-check · Evaluation of completed work; **B** Issue · #dc2626 · circle-alert · Problems requiring resolution; Approval · #16a34a · circle-check · Work requiring authorization.
2. `software` System and Software Development (icon `code`): **D** Task · #2563eb · square-check · General development work; **B** Bug Task · #dc2626 · bug · Software defects; Deployment · #0891b2 · rocket · System releases and delivery; Feature · #9333ea · layers · New functionality; Onboarding · #16a34a · user-plus · Member and environment setup; Product Backlog Item · #d97706 · list-todo · Product requirements; Test Case · #0d9488 · clipboard-check · Software testing; Epic · #db2777 · zap · Large bodies of work.
3. `research` Academic and Research (icon `school`): **D** Research Task · #2563eb · search · General research activities; Research Objective · #9333ea · target · Major research work grouping; Literature Review · #7c3aed · book-open · Review of related studies; Data Collection · #0891b2 · database · Gathering research data; Data Analysis · #0d9488 · chart · Statistical and qualitative analysis; Experiment · #ea580c · flask · Experimental procedures; Manuscript Writing · #64748b · file-pen · Writing research documents; Validation · #16a34a · shield-check · Instrument and result validation; Revision · #d97706 · square-pen · Corrections and improvements; Ethics Review · #db2777 · scale · Research ethics requirements.
4. `feasibility` Feasibility Study (icon `chart`): **D** Study Task · #2563eb · square-check · General feasibility work; Market Study · #9333ea · pie-chart · Demand and competitor assessment; Technical Study · #0891b2 · cog · Technical requirements and viability; Financial Study · #16a34a · calculator · Costs and profitability; Management Study · #4f46e5 · users · Organizational requirements; Socioeconomic Study · #0d9488 · globe · Social and economic impact; Legal Compliance · #64748b · scale · Legal and regulatory requirements; Risk Assessment · #dc2626 · shield-alert · Business risks and threats; Report Preparation · #d97706 · file-text · Findings and recommendations.
5. `construction` Construction (icon `hard-hat`): Work Package · #9333ea · package · Grouped construction activities; **D** Construction Task · #2563eb · hard-hat · Site construction work; Site Preparation · #a16207 · shovel · Site clearing and preparation; Procurement · #d97706 · shopping-cart · Materials and equipment purchasing; Installation · #0891b2 · wrench · Equipment and system installation; Inspection · #0d9488 · scan-search · Site and quality inspections; Safety Task · #ea580c · shield-alert · Workplace safety requirements; Permit · #64748b · file-check · Construction permits; **B** Deficiency · #dc2626 · triangle-alert · Nonconforming work; Handover · #16a34a · handshake · Completed work turnover.
6. `real-estate` Real Estate (icon `building`): **D** Property Task · #2563eb · building · General property activities; Property Acquisition · #9333ea · key · Land and property acquisition; Site Assessment · #0891b2 · map-pin · Property location evaluation; Due Diligence · #0d9488 · scan-search · Property and ownership verification; Valuation · #16a34a · calculator · Property value assessment; Permit and Compliance · #64748b · file-check · Regulatory documentation; Listing and Marketing · #db2777 · megaphone · Property promotion; Negotiation · #d97706 · handshake · Client and seller negotiations; Contract Processing · #4f46e5 · square-pen · Agreements and contracts; Property Turnover · #ea580c · key · Property handover activities.
7. `business` Business and Entrepreneurship (icon `briefcase`): **D** Business Task · #2563eb · square-check · General business activities; Business Initiative · #9333ea · target · Major business objectives; Market Research · #0891b2 · search · Market and competitor analysis; Financial Planning · #16a34a · wallet · Financial projections and budgeting; Strategy Development · #4f46e5 · lightbulb · Business strategy creation; Procurement · #d97706 · shopping-cart · Resource acquisition; Business Compliance · #64748b · scale · Registration and compliance; Business Launch · #db2777 · rocket · Launching business operations; Performance Review · #0d9488 · chart · Business performance evaluation.
8. `marketing` Marketing and Advertising (icon `megaphone`): **D** Marketing Task · #2563eb · square-check · General marketing work; Campaign · #9333ea · megaphone · Grouped promotional activities; Market Research · #0891b2 · search · Audience and competitor research; Content Creation · #db2777 · pen-tool · Marketing content production; Creative Design · #7c3aed · palette · Promotional visual assets; Advertising · #ea580c · radio · Advertising activities; Publication · #16a34a · send · Content publishing; Campaign Analytics · #0d9488 · chart · Campaign performance analysis; Content Review · #d97706 · clipboard-check · Content verification.
9. `events` Event Management (icon `calendar`): **D** Event Task · #2563eb · square-check · General event activities; Event Planning · #9333ea · calendar · Event preparation; Venue Management · #0891b2 · map-pin · Venue arrangements; Logistics · #ea580c · truck · Equipment and transportation; Supplier Coordination · #d97706 · handshake · Vendor management; Registration · #16a34a · user-plus · Participant registration; Promotion · #db2777 · megaphone · Event advertising; Event Production · #4f46e5 · monitor-play · Program execution; Post-event Evaluation · #0d9488 · clipboard-check · Feedback and event assessment.
10. `creative` Creative and Design (icon `palette`): **D** Creative Task · #2563eb · square-check · General creative activities; Concept Development · #d97706 · lightbulb · Creative ideation; Design · #9333ea · palette · Visual and graphic design; Content Writing · #4f46e5 · pen-tool · Written content; Asset Production · #db2777 · image · Multimedia asset creation; Editing · #ea580c · scissors · Content editing; Creative Review · #0d9488 · scan-eye · Creative quality review; Revision · #0891b2 · refresh-cw · Requested creative changes; Publication · #16a34a · send · Final content release.
11. `hr` Human Resources (icon `users`): **D** HR Task · #2563eb · square-check · General HR activities; Recruitment · #9333ea · user-search · Candidate recruitment; Screening · #0891b2 · filter · Applicant screening; Interview · #4f46e5 · messages-square · Candidate interviews; Onboarding · #16a34a · user-plus · New employee integration; Training · #d97706 · graduation-cap · Employee development; Performance Evaluation · #0d9488 · clipboard-check · Employee evaluation; HR Compliance · #64748b · shield-check · Employment requirements; Offboarding · #ea580c · user-minus · Employee separation processes.
12. `operations` Operations and Administration (icon `settings`): **D** Operational Task · #2563eb · square-check · Routine operational work; Administrative Task · #64748b · briefcase · Administrative activities; Process Improvement · #9333ea · workflow · Process optimization; Service Request · #0891b2 · inbox · Internal service requests; Maintenance · #ea580c · wrench · Equipment and system upkeep; Procurement · #d97706 · shopping-cart · Resource purchasing; **B** Incident · #dc2626 · triangle-alert · Operational disruptions; Audit · #0d9488 · clipboard-check · Operational verification; Approval · #16a34a · circle-check · Management authorization.
13. `product` Product Development (icon `package`): **D** Product Task · #2563eb · square-check · General product development; Product Initiative · #db2777 · target · Major product objectives; Product Research · #0891b2 · search · Customer and product research; Product Design · #9333ea · drafting-compass · Product specifications; Prototype · #d97706 · package · Experimental product models; Manufacturing · #ea580c · factory · Product manufacturing; Product Testing · #0d9488 · flask · Performance verification; **B** Product Defect · #dc2626 · circle-alert · Product quality issues; Product Launch · #16a34a · rocket · Market release.
14. `finance` Finance and Accounting (icon `calculator`): **D** Financial Task · #2563eb · square-check · General financial activities; Budgeting · #9333ea · wallet · Budget preparation; Financial Analysis · #0891b2 · chart · Financial performance analysis; Transaction Processing · #16a34a · receipt · Financial transactions; Reconciliation · #4f46e5 · arrow-left-right · Financial record reconciliation; Audit · #0d9488 · scan-search · Financial verification; Tax Compliance · #d97706 · scale · Tax requirements; Financial Reporting · #64748b · file-chart · Financial statements and reports; **B** Discrepancy · #dc2626 · triangle-alert · Financial inconsistencies.

Presets with no **B** keep the project's current bug slot (on a work project) at the end of the list.
The bug-slot picks for General Project (Issue) and Operations and Administration (Incident) are calls
for the owner to check. The other four follow the brief (Bug Task, Deficiency, Discrepancy, Product
Defect).
