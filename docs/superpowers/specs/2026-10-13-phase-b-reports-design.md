# Phase B: class Reports, rebuilt

Date: 2026-10-13
Status: awaiting review
Roadmap: Phase B, the last of three.
- Phase A (Analytics) is live.
- Phase C is live: C1 peer evaluation, C2 rubric scores, C3 intervention notes.

Previous specs: `2026-10-13-class-analytics-redesign-design.md`, `2026-10-13-phase-c-grading-design.md`.

## Why

Class Reports (`src/pages/app/reports/`) are seven print sheets that count tasks. They have:
- no date range;
- no charts;
- no exports other than CSV, and CSV on only three sheets;
- only the latest feedback.

About half their content repeats Analytics.

The three uses decided on 2026-10-13 are **grading**, the **weekly check-in**, and **accreditation records**. Phase C added the data those uses need: peer ratings, rubric scores and the notes log. No report reads any of it yet.

## Decisions (user, 2026-10-13)

| Question | Decision |
|---|---|
| Scope | All eight roadmap reports. Built in four parts, B1–B4, under this one spec. |
| Exports | Print / Save as PDF, Excel (.xlsx), Word (.docx) and CSV, for every report. |
| Unreleased scores | Shown on staff reports, tagged **Not released**. |
| Page shape | **A fixed catalogue.** Each report is purpose-built, with options that fit it. There is no free-form section builder and there are no saved templates. |

## Shape

| Part | Adds |
|---|---|
| **B1** | The engine, the **Individual grading sheet** (with its one-student and all-projects versions) and the **Peer evaluation summary** |
| **B2** | **Weekly class check-in**, **Intervention log** |
| **B3** | **Group progress report**, **Deliverables & milestone compliance** |
| **B4** | **Formal term record**, **Activity / audit log**, and retiring the old seven sheets |

- Each part gets its own plan and review, and ships on its own.
- Until B4, the old sheets stay in the catalogue under a group called "Older reports".
- The students' own report page (`StudentReports.tsx`, `my_*` views) is not touched.

## Shared rules

- **Who reads.**
  - Every report is staff-only: `is_class_professor`, co-teachers included.
  - A new SQL read is a `security_invoker` view filtered by `is_class_professor`, or a function that checks it.
  - Students get no rows.
- **Archived data stays in.** Unlike Analytics, reports include archived classes and projects; a term report is asked for after the term ends. Archived rows show "term ended".
- **Days are Manila days.** Ranges resolve with the General `reportRange.ts` helpers in `Asia/Manila`.
- **Copy** follows CLAUDE.md: sentence case, active voice, no "please", no "successfully". An error says what happened and what to do next.
- **Visual rules:**
  - Colours come only from tokens: the status ramps for state, and `TONE_CELL` for chips.
  - Light and dark are both checked.
  - Layout is desktop first. On phones, tables scroll inside their card.
- **The score rule** replaces the C2 rule in `supabase/tests/reports.test.sql`. Score data appears **only in staff-only reads**, which are views or functions that return nothing to a student. The test asserts this for every report view.
- **New SQL files** go into the `scripts/schema-drift.mjs` ORDER and both rebuild lines in `docs/07-backup.md`. Re-run `anon-lockdown.sql` after them. Never re-run `results.sql`, `analytics.sql`, `admin-program.sql`, `task-archive.sql` or `automation.sql` as a whole.

---

## The engine (B1)

### Document model

Each report is a **pure function**: `(data, options) → ReportDoc`.

```
ReportDoc
  header: { title, subtitle, classLine, rangeLabel | null, madeAt, confidential?: string }
  blocks: Block[]
  footer: { lines: string[]; signatures: { role: string; name?: string }[] }

Block =
  | { kind: 'kpis'; items: { label, value: number | string, unit?, delta?: number | null }[] }
  | { kind: 'heading'; text; level: 2 | 3 }
  | { kind: 'paragraph'; text }
  | { kind: 'table'; id; title; columns: Column[]; rows: Cell[][]; note?: string; cap?: number }
  | { kind: 'chart'; id; title; chart: ChartSpec; summary: string }
  | { kind: 'note'; tone: 'info' | 'warning'; text }

Column = { key, label, type: 'text' | 'number' | 'percent' | 'date' | 'datetime' | 'score' | 'status' }
Cell   = string | number | null | { value, tag?: string, tone?: Tone }
```

- `ChartSpec` names an existing chart (`Burnup`, `WeekBars`, `StackedBar`, `ShareBar`) and its data. Phase A's components draw it.
- `summary` is the plain-language sentence that Word and screen readers use instead of the drawing.
- `cap` limits the rows drawn on screen and in print. The exporters always write every row.

### Renderer and exporters

- **Renderer.** `ReportDocView` draws a `ReportDoc` on the existing A4 `Sheet` (letterhead, made-at date, footer). One component handles every block kind. Typed cells format consistently:
  - numbers with tabular figures;
  - percents to one decimal place;
  - scores as `x / total`;
  - dates as Manila days;
  - `status` cells as token-coloured chips.
- **Print / Save as PDF.** Browser print of the sheet, charts included. Page breaks never fall inside a table row or a chart.
- **Excel.**
  - A cover sheet holds the header and footer lines.
  - Each `table` block becomes one worksheet, named after its title, truncated and de-duplicated to Excel's 31-character limit.
  - Numbers, percents and scores are stored as numbers. A score is stored as its number, with "of N" in the header. Dates are stored as dates.
  - It uses `workbookToXlsx` (`lib/general/office.ts`).
- **Word.** Headings, paragraphs and tables, using `htmlToDocx`. Each chart becomes its `summary` sentence, and each KPI block becomes a two-column table.
- **CSV.** One file per table, named `<class>-<report>-<table>-<from>-<to>.csv`, using `downloadCsv` (`lib/report.ts`).

### Page

- The catalogue sits on the left. Each entry has its name and one sentence on what it is for.
- The options bar sits above the sheet:
  - class → project → group or student;
  - a range, for reports that use one, with the General presets (this week, last week, last 7, last 30, this term, custom);
  - a few per-report toggles.
- Every choice lives in the URL (`?report=&class=&project=&board=&student=&from=&to=&…`), so a link reopens the same report.
- The export menu offers Print, Excel, Word and CSV. When a report has several tables, CSV lists one entry per table.
- Each report loads its own data. Loading shows a spinner. A failure shows an `Alert` with Retry. An empty result says why, and what would fill it.

---

## B1 reports

### Individual grading sheet

Options: class, project (or **All projects**), and an optional student.

**One project (the class version):**
- **KPIs:**
  - students, scored, confirmed and released;
  - average and median final;
  - finals overridden.
- **Table "Grades":** one row per student. Columns:
  - student, group;
  - each criterion's group points (`score`);
  - group total, peer factor, peer flags (labels from `PEER_FLAG_META`), suggested and final;
  - an Overridden tag, and a status of **Released** or **Not released**;
  - contribution: share of the group's work (%), tasks finished/held, and late tasks.
- **Chart:** the spread of finals, in bands of 10% of the total. The top band includes the total.
- **Table "Rubric":** criterion, description and points.
- **Footer:** "Scores tagged Not released are not yet visible to students."

**All projects (the grade-book grid):** one row per student and one column per project. Each cell is the final score, tagged Not released when it applies, or empty. A last column gives the sum of finals over the sum of totals as a percent.

**One student:**
- One row per project of the class, with:
  - final, group total and the adjustment;
  - factor and status.
- Under each project:
  - the rubric breakdown;
  - the student's five peer averages beside the team's.

**Data:** `score_sheet(project)` for each project, `board_scores`, `project_criteria`, `class_member_load`, and `peer_results`. **No new SQL.**

### Peer evaluation summary

Options: class, project, and round. The default round is the closed final round if there is one, otherwise the latest.

- **KPIs:** response rate (answered of expected), and how many students carry each flag.
- **One table per group:** member, received average, self, factor, raters, flags, and the five dimension averages.
- **Chart:** the class's five dimension averages.
- **Toggle "Include written comments"** (off by default):
  - Adds a "Comments" table with ratee and comment, rater names hidden.
  - The header shows `confidential: 'Contains confidential peer comments'`.

**Data:** `peer_results`, `peer_round_status`, `peer_comments`. **No new SQL.**

---

## B2 reports

### Weekly class check-in

Options: class, and a week (the default is this Manila week; any 7-day range can be chosen). The comparison is always the 7 days before.

- **KPIs**, each with its change from the previous week:
  - tasks finished and started;
  - hand-ins and returns;
  - comments;
  - students active.
- **Table "Moved this week":** one row per group, with finished, started, hand-ins and returns.
- **Table "Stuck":** one row per item, with a type column.
  - tasks in progress for 7 days or more;
  - groups idle for 7 days or more;
  - students inactive for 7 days or more.

  The threshold is the existing Phase A constant.
- **Table "Coming up":** task, project and milestone deadlines in the next 7 days after the range.
- **Table "Needs attention":** the `rankActions` list as of the date the report was made, plus follow-ups from notes that fall due inside the range.
- **Chart:** weekly activity for the 8 weeks ending on the range (`WeekBars`).

**Data:** the Phase A reads (`analytics_daily_activity`, `task_state`, `board_burn`, `analytics_student_roster`, `analytics_milestones`), `class_actions`, and `class_notes`. **No new SQL.**

### Intervention log

Options: class, range, an optional student or group, kinds (multi), and status (open, resolved, all).

- **KPIs:** notes by kind, open follow-ups, overdue follow-ups, reminders sent.
- **Table "Log":** date, kind, about, note, follow-up date, resolved date, outcome, and written by.

**New SQL:** `supabase/report-notes.sql` adds the view `class_note_log`.
- It is `security_invoker` and staff-only. It reads `class_notes` and adds `student_name`, `group_name`, `project_title` and `author_name`.
- Test: staff read it, students get zero rows, and archived classes are included.

---

## B3 reports

### Group progress report

Options: class, project, and one group or all groups.

**For each group:**
- **KPIs:** % done, tasks, late tasks, hand-in state, current verdict.
- **Chart:** burnup, scope against done over the project's span (`Burnup`).
- **Table "Members":** share, finished/held, late.
- **Table "Milestones":** milestone, due, done/total, and state (met, missed or upcoming).
- **Table "Sprints":** sprint, dates, committed, done, carried over.
- **Table "Feedback history":** every `board_results` row (decided at, verdict, reason, decided by), plus the current hand-in, oldest first.

**Data:** `task_state`, `analytics_milestones`, `analytics_sprints`, `board_results` (each decision is its own row), and `class_member_load`. **No new SQL.**

### Deliverables & milestone compliance

Options: class, project or all projects, and range.

- **Table "Compliance":**
  - Rows are groups. On an individual project, rows are students.
  - Columns are each milestone, then the project's hand-in.
  - Each cell is one of:
    - **On time**;
    - **Late (N days)**;
    - **Missing**, when past due and not done;
    - **Not due yet**.
  - Cells are chips in status tones.
- **KPIs:** on-time rate, late, missing.
- **Excel:** the grid as numbers (days late; 0 for on time; empty for missing or not due), plus a "Legend" sheet.

**Rules:**
- A milestone is **met** when all its tasks are done by the end of its Manila due day.
- The hand-in time is the board's current `submitted_at`. It is **on time** when that is no later than `due_at`. A board that was returned and not yet handed in again counts as **Missing** once it is past due. Collabify keeps only the current submission time, so the plan does not reconstruct earlier hand-ins.

**New SQL:** `supabase/report-deliverables.sql` adds the view `report_deliverables`.
- It has one row per board and deliverable: `kind`, `ref_id`, `title`, `due`, `done_at`, `days_late`, `state`.
- It is staff-only, and archived projects are included.
- Test: each state against a hand-built fixture.

---

## B4 reports

### Formal term record

Options: class. Ended classes are included. **With no class chosen,** the report is one row per class taught, with the same totals. This replaces today's Term summary.

- **Header:** course, section, term dates, the professor and co-teachers.
- **KPIs:** enrolled (active and removed), projects run, hand-in rate, accepted rate.
- **Table "Projects":** title, type, weeks, due, groups or students, hand-in rate, accepted rate, average released final, and how many are released.
- **Table "Syllabus coverage":** week, what the syllabus asks for, and what was set against it.
- **Table "Interventions":** notes by kind, and follow-ups resolved / total.
- **Signatures:** "Prepared by" (the professor) and "Reviewed by (program chair)", with blank lines.

**Data:** `report_class_summary`, `report_week_coverage`, `score_sheet`, `class_note_log`. **No further new SQL.**

### Activity / audit log

Options: class, project, group, student, range, and event kinds.

- **Table "Events":** time (Manila, to the minute), who, event, task, group, project.
- **Row cap:** `cap: 500`. The screen and print say "Showing 500 of N. Excel and CSV include every row."

**New SQL:** `supabase/report-events.sql` adds the view `report_task_events`.
- It is `security_invoker` and staff-only. It joins `task_events` to the task, board, group, project and actor names.
- It is read in pages through `pageAll`.
- Test: staff only, and archived classes included.

### Retiring the old sheets (B4)

| Old sheet | Replaced by |
|---|---|
| Class term report | Formal term record |
| Term summary | Formal term record, no class chosen |
| Syllabus coverage | Formal term record's coverage table |
| Student contribution | Grading sheet, one student |
| Class record | Grading sheet, all projects |
| Project comparison | Group progress, all groups |
| Group project report | Group progress, one group |

- Each old `?report=` value redirects to its replacement with the same class, project and student.
- `src/components/reports/*Sheet.tsx` (except `Sheet.tsx`) and `useReports.ts` are deleted once nothing imports them.
- The "not a grade record" footer is gone.

---

## Testing

- **Unit tests (Vitest)**, one test file per document builder, on fixtures. They cover:
  - the Not released tag;
  - the score-band edges, including a score equal to the total;
  - the all-projects percent;
  - the flag counts;
  - the change from the previous week, including a previous value of zero;
  - the Stuck thresholds;
  - each compliance state;
  - the 500-row cap;
  - the confidential header when comments are on.
- **Exporter tests:**
  - Excel: the sheet count, unique names of at most 31 characters, numeric cells stored as numbers, a cover sheet present.
  - Word: one table per table block, and the chart summary sentence present.
  - CSV: the file names.
- **SQL tests**, one file per new view: staff can read it, students get zero rows, archived data is included, and states are checked against hand values. `reports.test.sql` gets the new score rule.
- **Browser check after each part,** as faculty on live data: every report in the part, all four exports opened, light and dark, and widths of 375, 768 and 1440.

## Risks

- **Large classes.** Activity logs and grade books can run to thousands of rows. Reads page through `pageAll`, the screen caps at 500 rows, and the exporters write everything.
- **`class_actions` is slow** (5–9 s). The check-in loads it last, and shows the rest of the report while it waits.
- **Print fidelity.** Charts are SVG. Printing always forces the light palette, whatever theme is on screen, so dark mode never prints dark pages.

## Out of scope

- Saved report templates.
- Scheduling, or emailing reports.
- Student-facing reports (they stay as they are).
- Reports across several professors.
- Changing General workspace reports.
