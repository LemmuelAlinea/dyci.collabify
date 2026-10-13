# Phase B2: Weekly Check-in and Intervention Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two reports to the class report engine: the **Weekly class check-in** (what moved, what's stuck, what's coming up, what needs you) and the **Intervention log** (the C3 notes, filterable and printable). Both have date ranges, and the engine gains the pieces they need.

**Architecture:** Both reports reuse the B1 engine: a pure builder produces a `ReportDoc`, and `ReportDocView` and the exporters draw it.
- **Engine additions:** a Manila date-range helper; a `weekBars` chart; KPI changes against the previous period; and the Excel cover listing notes and chart summaries, with column widths (a deferred B1 minor).
- **Check-in data:** the existing Phase A reads, plus `board_results` history.
- **Log data:** one new staff-only view, `class_note_log`, which adds names to each note.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind tokens, Vitest, and Supabase Postgres (one view).

**Spec:** `docs/superpowers/specs/2026-10-13-phase-b-reports-design.md`. This plan covers "B2 reports", "Shared rules" and "Testing". B1 is live on main (`e49f409`). Read its plan's rulings, in `docs/superpowers/plans/2026-10-13-phase-b1-report-engine-grading.md`.

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | The check-in waits for all its data, including `class_actions` (5–9 s), and shows "Building the report…" until then. It does not draw the rest first. | A printed report should appear whole. Partial drawing adds a second loading state to the engine for one report. | A professor waits a few seconds on first open. |
| 2 | The check-in counts **events** (`analytics_daily_activity`): finished, started and commented. A task finished, reopened and finished again counts twice. | Events are what happened that week. They are also what Analytics' weekly bars count, so the two agree. | A reopened task is counted twice. |
| 3 | A "hand-in" is a board whose current `submitted_at` falls in the range. A "return" is a `board_results` row with verdict `returned` decided in the range. | Collabify keeps only the current submission time (the B3 ruling in the spec). Returns and accepts keep their history. | A board handed in, returned and handed in again within one week counts as one hand-in. |
| 4 | "Stuck" and "inactive" are measured **as of the last day of the range**, not as of today. | A week chosen from last month must read the same every time it is printed. | None. |
| 5 | The check-in reads Phase A views, which drop archived classes. On an ended class it says so in words ("This class has ended. The weekly check-in covers live classes."). The Intervention log includes archived classes, per the spec. | Weekly check-ins are for running classes. Changing Phase A's views is out of scope. | Someone wanting a past week of an ended class reads the Intervention log instead. |
| 6 | The log is ordered **oldest first**. | It is a record read like a diary. Accreditation reads it in order. | None; it is a sort in one place. |

## Global Constraints

- **Staff-only, archived kept.** Every report is staff-only. The new view is `security_invoker`, filtered by `public.is_class_professor(class_id)`, and returns nothing to students. Archived classes stay in the log.
- **New SQL.** The new SQL file goes in the `scripts/schema-drift.mjs` ORDER (after `class-notes`) and on both rebuild lines in `docs/07-backup.md` (after `supabase/class-notes.sql`). It revokes from `anon` inline. Re-run `supabase/anon-lockdown.sql` after applying it.
- **Live database.** The live database is the only database.
  - Apply only the new file and `anon-lockdown.sql`. Test files roll back.
  - Never re-run `results.sql`, `analytics.sql`, `admin-program.sql`, `task-archive.sql` or `automation.sql` as a whole.
- **Days are Manila days.** Use `manilaDay`, `mondayOf`, `addDays` and `daysBetween` from `src/lib/analyticsMath.ts`. Display with `Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', … })`.
- **Thresholds** are the existing named constants: `STUCK_DAYS` (7) and `INACTIVE_DAYS` (7) in `src/lib/analyticsMath.ts`.
- **Colours** come only from tokens (`TONE_CELL`). No raw hex.
- **Copy** uses sentence case. No "please", no "successfully", no exclamation marks. An empty result says why and what would fill it.
- **Exact strings:**
  - Empty log: "No notes in these dates. Widen the dates or add notes from Analytics."
  - Ended class: "This class has ended. The weekly check-in covers live classes."
  - Log footer: "Only teaching staff can read these notes."
- **React rules.** A `.tsx` file exports components only. Pure helpers go in `.ts` files.
- **Before calling a task done,** run `npm run build`, `npx eslint src` and `npx vitest run`.
- **Staging and editing:**
  - Stage files by name. Never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`.
  - Use the Edit/Write tools, never PowerShell `Set-Content`.

## Review Focus

1. **A week with no activity at all**, such as a semester break. The KPIs read 0 with their changes, the tables say there is nothing rather than showing empty grids, and the chart still shows the 8 weeks. *Task 3 test.*
2. **A previous week of 0 and a current week of 5.** The change reads "+5", with no `Infinity` and no percent. *Task 1 `deltaText` test and Task 3 KPI test.*
3. **A custom range typed backwards or half-filled** (from after to, or a missing date). It is ordered or falls back, and never throws. *Task 1 test.*
4. **A follow-up note dated inside the range but already resolved.** It does not appear under Needs attention. *Task 3 test.*
5. **Log filters that match nothing**, such as a kind nobody used, or a student with no notes. The empty-log sentence shows, and the KPIs read 0. *Task 4 test.*

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/reports/range.ts` + `.test.ts` (new) | `RangeChoice`, `RANGE_CHOICES`, `resolveRange`, `previousRange`, `rangeText`, `parseRangeChoice`. |
| `src/lib/reports/doc.ts` (modify) | `WeekBarsChart` in `ChartSpec`, `compareLabel` on the KPI block, `deltaText`. |
| `src/lib/reports/export.ts` (modify) | Changes on the Excel cover and in Word. The cover lists notes and chart summaries. Excel column widths. |
| `src/components/reports/ReportDocView.tsx` (modify) | Draws `weekBars` with `WeekBars`, and draws the KPI changes. |
| `supabase/report-notes.sql` + `supabase/tests/report-notes.test.sql` (new) | The `class_note_log` view. |
| `src/lib/api/notes.ts`, `src/lib/types.ts` (modify) | `NoteLogRow`, `listClassNoteLog(classId)`. |
| `src/lib/api/results.ts` (modify) | `boardResultsFor(boardIds)`. |
| `src/lib/reports/checkIn.ts` + `.test.ts` (new) | `checkInDoc`, `weekFigures`. |
| `src/lib/reports/interventionLog.ts` + `.test.ts` (new) | `interventionLogDoc`. |
| `src/pages/app/reports/reportKind.ts`, `useReports.ts`, `useReportDoc.ts`, `Reports.tsx`, `src/components/reports/ReportPicker.tsx` (modify) | New kinds, range and filter choices in the URL, loaders, and picker controls. |

---

### Task 1: Engine additions: ranges, week bars, KPI changes, a fuller Excel cover

**Files:**
- Create: `src/lib/reports/range.ts`, `src/lib/reports/range.test.ts`
- Modify: `src/lib/reports/doc.ts`, `src/lib/reports/doc.test.ts`
- Modify: `src/lib/reports/export.ts`, `src/lib/reports/export.test.ts`
- Modify: `src/components/reports/ReportDocView.tsx`

**Interfaces:**
- Consumes: `addDays`, `daysBetween`, `mondayOf`, and the `WeekRow` type from `src/lib/analyticsMath.ts`; `WeekBars` from `src/components/charts/WeekBars.tsx` (props `{ rows: WeekRow[]; title: string }`).
- Produces:
  - `type DayRange = { from: string; to: string }`
  - `type RangeChoice = 'thisWeek' | 'lastWeek' | 'last7' | 'last30' | 'custom'`
  - `RANGE_CHOICES: { value: RangeChoice; label: string }[]`
  - `resolveRange(choice, today: string, custom?: { from?: string; to?: string }): DayRange`
  - `previousRange(r: DayRange): DayRange`
  - `rangeText(r: DayRange): string`
  - `parseRangeChoice(raw: string | null, fallback: RangeChoice): RangeChoice`
  - `ChartSpec` gains `{ kind: 'weekBars'; rows: WeekRow[] }`.
  - The `kpis` block gains `compareLabel?: string`.
  - `deltaText(d: number): string`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/range.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseRangeChoice, previousRange, rangeText, resolveRange } from './range'

// 2026-10-14 is a Wednesday.
const today = '2026-10-14'

describe('resolveRange', () => {
  it('reads the presets as Manila days', () => {
    expect(resolveRange('thisWeek', today)).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(resolveRange('lastWeek', today)).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(resolveRange('last7', today)).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(resolveRange('last30', today)).toEqual({ from: '2026-09-15', to: '2026-10-14' })
  })
  it('orders a custom range typed backwards', () => {
    expect(resolveRange('custom', today, { from: '2026-10-10', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-10' })
  })
  it('falls back to the last 7 days when a custom date is missing or not a day', () => {
    expect(resolveRange('custom', today, { from: '2026-10-01' })).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(resolveRange('custom', today, { from: 'soon', to: '2026-13-40' })).toEqual({ from: '2026-10-08', to: '2026-10-14' })
  })
})

describe('previousRange', () => {
  it('is the same number of days, ending the day before', () => {
    expect(previousRange({ from: '2026-10-12', to: '2026-10-18' })).toEqual({ from: '2026-10-05', to: '2026-10-11' })
    expect(previousRange({ from: '2026-10-01', to: '2026-10-01' })).toEqual({ from: '2026-09-30', to: '2026-09-30' })
  })
})

describe('rangeText', () => {
  it('names the days, the year once when it is shared', () => {
    expect(rangeText({ from: '2026-10-12', to: '2026-10-18' })).toBe('Oct 12 to Oct 18, 2026')
    expect(rangeText({ from: '2025-12-29', to: '2026-01-04' })).toBe('Dec 29, 2025 to Jan 4, 2026')
    expect(rangeText({ from: '2026-10-12', to: '2026-10-12' })).toBe('Oct 12, 2026')
  })
})

describe('parseRangeChoice', () => {
  it('keeps a known choice and falls back otherwise', () => {
    expect(parseRangeChoice('lastWeek', 'thisWeek')).toBe('lastWeek')
    expect(parseRangeChoice('toString', 'thisWeek')).toBe('thisWeek')
    expect(parseRangeChoice(null, 'last30')).toBe('last30')
  })
})
```

Add to `src/lib/reports/doc.test.ts`:

```ts
import { deltaText } from './doc'

describe('deltaText', () => {
  it('signs a change and never divides', () => {
    expect(deltaText(5)).toBe('+5')
    expect(deltaText(-2)).toBe('−2')
    expect(deltaText(0)).toBe('±0')
    expect(deltaText(1.5)).toBe('+1.5')
  })
})
```

Add to `src/lib/reports/export.test.ts`. Reuse the file's existing `doc` fixture and imports, and add these cases:

```ts
describe('the fuller Excel cover', () => {
  const withMore: ReportDoc = {
    ...doc,
    blocks: [
      { kind: 'kpis', compareLabel: 'Oct 5 to Oct 11, 2026', items: [{ label: 'Tasks finished', value: 5, delta: 5 }] },
      { kind: 'note', tone: 'info', text: 'Nothing is stuck.' },
      { kind: 'paragraph', text: 'A quiet week.' },
      { kind: 'chart', id: 'w', title: 'Weekly activity', chart: { kind: 'weekBars', rows: [{ week: '2026-10-12', work: 3, talk: 1 }] }, summary: 'This week: 3 work, 1 talk.' },
      ...doc.blocks.filter((b) => b.kind === 'table'),
    ],
  }
  const wb = docToWorkbook(withMore)
  const cover = wb.sheets[0].rows

  it('lists each KPI with its change and the comparison', () => {
    expect(cover).toContainEqual(['Tasks finished', '5', '', '+5'])
    expect(cover.flat()).toContain('Changes are against Oct 5 to Oct 11, 2026')
  })
  it('carries notes, paragraphs and chart summaries', () => {
    const flat = cover.flat()
    expect(flat).toContain('Nothing is stuck.')
    expect(flat).toContain('A quiet week.')
    expect(flat).toContain('Weekly activity: This week: 3 work, 1 talk.')
  })
  it('sets a width on every table column', () => {
    for (const s of wb.sheets.slice(1)) {
      const widths = Object.values(s.cols ?? {})
      expect(widths.length).toBe(s.rows[0].length)
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(64)
    }
  })
  it('shows the change in Word', () => {
    expect(docToHtml(withMore)).toContain('5 (+5)')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports`
Expected: FAIL. `./range` is missing; `deltaText` and `compareLabel` are unknown; the cover lacks the new rows.

- [ ] **Step 3: Write `src/lib/reports/range.ts`**

```ts
import { addDays, daysBetween, mondayOf } from '../analyticsMath'

/** A run of Manila days, both ends included. */
export type DayRange = { from: string; to: string }

export type RangeChoice = 'thisWeek' | 'lastWeek' | 'last7' | 'last30' | 'custom'

export const RANGE_CHOICES: { value: RangeChoice; label: string }[] = [
  { value: 'thisWeek', label: 'This week' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Choose dates' },
]

const isDay = (v?: string): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

/** `today` is a Manila day. Weeks run Monday to Sunday. */
export function resolveRange(choice: RangeChoice, today: string, custom?: { from?: string; to?: string }): DayRange {
  switch (choice) {
    case 'thisWeek': {
      const m = mondayOf(today)
      return { from: m, to: addDays(m, 6) }
    }
    case 'lastWeek': {
      const m = addDays(mondayOf(today), -7)
      return { from: m, to: addDays(m, 6) }
    }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'custom':
      if (isDay(custom?.from) && isDay(custom?.to)) {
        return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from }
      }
      return { from: addDays(today, -6), to: today }
    case 'last7':
    default:
      return { from: addDays(today, -6), to: today }
  }
}

export function previousRange(r: DayRange): DayRange {
  const n = daysBetween(r.from, r.to) + 1
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) }
}

const SHORT = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const LONG = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const at = (day: string) => new Date(`${day}T00:00:00+08:00`)

export function rangeText(r: DayRange): string {
  if (r.from === r.to) return LONG.format(at(r.from))
  if (r.from.slice(0, 4) === r.to.slice(0, 4)) return `${SHORT.format(at(r.from))} to ${LONG.format(at(r.to))}`
  return `${LONG.format(at(r.from))} to ${LONG.format(at(r.to))}`
}

export function parseRangeChoice(raw: string | null, fallback: RangeChoice): RangeChoice {
  return RANGE_CHOICES.some((c) => c.value === raw) ? (raw as RangeChoice) : fallback
}
```

Check `daysBetween(from, to)` in `analyticsMath.ts`. It must return `to − from` in whole days; the test `previousRange({ from: '2026-10-01', to: '2026-10-01' })` pins that.

- [ ] **Step 4: Extend `doc.ts`**

- Import `type { WeekRow } from '../analyticsMath'`.
- Add `export type WeekBarsChart = { kind: 'weekBars'; rows: WeekRow[] }` and change `ChartSpec` to `BarsChart | WeekBarsChart`.
- Change the `kpis` member of `Block` to `{ kind: 'kpis'; items: Kpi[]; compareLabel?: string }`.
- Add:

```ts
/** A change against the previous period: signed, never a ratio. */
export function deltaText(d: number): string {
  if (d === 0) return '±0'
  const v = formatPoints(Math.abs(d))
  return d > 0 ? `+${v}` : `−${v}`
}
```

- [ ] **Step 5: Extend `export.ts`**

In `docToWorkbook`:
- Each KPI row becomes `[label, value, unit, delta]`, where `delta = k.delta === null || k.delta === undefined ? '' : deltaText(k.delta)`, all through `gridText`.
- After a KPI block with `compareLabel`, push `[gridText(`Changes are against ${compareLabel}`)]`.
- After the KPIs, push one cover row for each of these blocks, in order:
  - `note` → `[text]`
  - `paragraph` → `[text]`
  - `chart` → `[`${title}: ${summary}`]`
  - a table with a `note` → `[`${title}: ${note}`]`

  Every row goes through `gridText`. If any were added, put a blank row before them.
- **Column widths:** for each table sheet, set `cols` to a record from column index (as a string) to pixels. The width is `Math.min(420, Math.max(64, longest * 7 + 16))`, where `longest` is the longest string length in that column, including the header.

In `docToHtml`, the `kpis` case renders the value as `${value}${unit ? ` ${unit}` : ''}${delta != null ? ` (${deltaText(delta)})` : ''}`. When `compareLabel` is set, add `<p>Changes are against …</p>` after the table.

Import `deltaText` from `./doc`.

- [ ] **Step 6: Draw the new pieces in `ReportDocView.tsx`**

- Import `WeekBars` from `../charts/WeekBars` and `deltaText` from `../../lib/reports/doc`.
- **Chart case:** render `block.chart.kind === 'weekBars' ? <WeekBars rows={block.chart.rows} title={block.title} /> : <Bars … />`.
- **KPI case:** under each value, when `k.delta` is a number, add:

```tsx
<span className="block font-mono text-[11px] text-faint">{deltaText(k.delta)}</span>
```

  After the `<dl>`, when `block.compareLabel` is set, add:

```tsx
<p className="text-[12px] text-faint">Changes are against {block.compareLabel}.</p>
```

  To do that, wrap the case in a fragment or a `div className="space-y-2"`.

- [ ] **Step 7: Run the tests, build and lint**

Run: `npx vitest run src/lib/reports`, then `npm run build`, then `npx eslint src`.
Expected: all pass and clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/reports/range.ts src/lib/reports/range.test.ts src/lib/reports/doc.ts src/lib/reports/doc.test.ts src/lib/reports/export.ts src/lib/reports/export.test.ts src/components/reports/ReportDocView.tsx
git commit -m "Add Manila ranges, week bars and period changes to the report engine"
```

---

### Task 2: The `class_note_log` view and its reads

**Files:**
- Create: `supabase/report-notes.sql`, `supabase/tests/report-notes.test.sql`
- Modify:
  - `scripts/schema-drift.mjs` (the ORDER ends `… scoring class-notes`; append ` report-notes`)
  - `docs/07-backup.md` (lines 26 and 53: append ` supabase/report-notes.sql`; add one paragraph after the `class-notes.sql` paragraph)
- Modify: `src/lib/types.ts`, `src/lib/api/notes.ts`, `src/lib/api/results.ts`

**Interfaces:**
- Produces:
  - **View** `public.class_note_log`, with the columns of `class_notes` plus `student_name`, `group_name`, `project_title` and `author_name`.
  - **Type** `NoteLogRow = ClassNote & { student_name: string | null; group_name: string | null; project_title: string | null; author_name: string | null }`.
  - **Reads:**
    - `listClassNoteLog(classId: string): Promise<NoteLogRow[]>`, paged and oldest first.
    - `boardResultsFor(boardIds: string[]): Promise<{ board_id: string; verdict: 'accepted' | 'returned'; decided_at: string }[]>`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/report-notes.test.sql`:

```sql
-- class_note_log — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/report-notes.test.sql

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_set uuid; v_g uuid; v_proj uuid; v_board uuid;
  r record;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-log-set', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-log-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id) values (v_g, v_set, v_a);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-log-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  perform pg_temp.act_as(v_prof);
  perform public.add_class_note(v_class, v_a, null, 'meeting', 'zz-log student note', null);
  perform public.add_class_note(v_class, null, v_board, 'note', 'zz-log group note', null);

  select * into r from public.class_note_log where class_id = v_class and body = 'zz-log student note';
  perform pg_temp.must_be('the professor reads a student note with the student and author named',
    r.student_name is not null and r.author_name is not null and r.group_name is null);
  select * into r from public.class_note_log where class_id = v_class and body = 'zz-log group note';
  perform pg_temp.must_be('a group note carries the group and project',
    r.group_name = 'zz-log-group' and r.project_title = 'zz-log-proj' and r.student_name is null);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads nothing from the log, even about themselves',
    (select count(*) from public.class_note_log where class_id = v_class) = 0);

  perform pg_temp.act_as_service();
  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('an ended class keeps its log',
    (select count(*) from public.class_note_log where class_id = v_class and body like 'zz-log%') = 2);
  perform pg_temp.act_as_service();
end $$;

rollback;
```

Run: `node scripts/db.mjs supabase/tests/report-notes.test.sql`
Expected: FAIL (`relation "public.class_note_log" does not exist`).

- [ ] **Step 2: Write `supabase/report-notes.sql`**

```sql
-- Collabify — the intervention log, with names, for reports.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/report-notes.sql
-- Requires: class-notes.sql. Re-run supabase/anon-lockdown.sql afterwards.

/**
 * class_notes holds ids. A printed log needs who the note is about, which
 * group and project, and who wrote it. Staff only (class_notes' own policy
 * still applies through security_invoker), and ended classes stay in: a log
 * is read after the term, for accreditation.
 */

begin;

drop view if exists public.class_note_log;

create view public.class_note_log
with (security_invoker = true) as
select n.id, n.class_id, n.student_id, n.board_id, n.kind, n.body, n.follow_up_on,
       n.resolved_at, n.outcome, n.created_by, n.created_at,
       nullif(btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), '') as student_name,
       coalesce(g.name, nullif(btrim(coalesce(bs.first_name, '') || ' ' || coalesce(bs.last_name, '')), '')) as group_name,
       p.title as project_title,
       nullif(btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '') as author_name
  from public.class_notes n
  left join public.profiles s on s.id = n.student_id
  left join public.project_boards b on b.id = n.board_id
  left join public.groups g on g.id = b.group_id
  left join public.profiles bs on bs.id = b.student_id
  left join public.projects p on p.id = b.project_id
  left join public.profiles a on a.id = n.created_by
 where public.is_class_professor(n.class_id);

revoke all on public.class_note_log from anon;
grant select on public.class_note_log to authenticated;

commit;
```

Apply and test:
```bash
node scripts/db.mjs supabase/report-notes.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/report-notes.test.sql
node scripts/db.mjs supabase/tests/reports.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: no `FAIL`.

If `author_name` comes back null because `profiles` RLS hides the author from the staff reader, report it. The page then shows "—". That is acceptable, but say so in the report.

- [ ] **Step 3: The rebuild order**

- `scripts/schema-drift.mjs`: the ORDER becomes `… scoring class-notes report-notes`.
- `docs/07-backup.md`: append ` supabase/report-notes.sql` to lines 26 and 53. After the `class-notes.sql` paragraph, add:

```markdown
`report-notes.sql` runs after `class-notes.sql`. It holds `class_note_log`, the notes with
student, group, project and author names, for the Intervention log report. Re-run
`anon-lockdown.sql` after it.
```

- [ ] **Step 4: Types and reads**

In `src/lib/types.ts`, after `ClassNote`:

```ts
/** class_note_log: a note with the names a printed log needs. Staff only. */
export type NoteLogRow = ClassNote & {
  student_name: string | null
  group_name: string | null
  project_title: string | null
  author_name: string | null
}
```

In `src/lib/api/notes.ts`:

```ts
/** One class's notes with names, oldest first, archived classes included. */
export async function listClassNoteLog(classId: string) {
  return pageAll<NoteLogRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_note_log')
      .select('*')
      .eq('class_id', classId)
      .order('created_at')
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as NoteLogRow[]
  })
}
```

In `src/lib/api/results.ts`:

```ts
/** Every decision on the given boards, oldest first. */
export async function boardResultsFor(boardIds: string[]) {
  if (boardIds.length === 0) return []
  const { data, error } = await supabase
    .from('board_results')
    .select('board_id, verdict, decided_at')
    .in('board_id', boardIds)
    .order('decided_at')
  if (error) throw error
  return (data ?? []) as { board_id: string; verdict: 'accepted' | 'returned'; decided_at: string }[]
}
```

- [ ] **Step 5: Build, lint, test, commit**

Run `npm run build`, `npx eslint src` and `npx vitest run`. All must be clean.

```bash
git add supabase/report-notes.sql supabase/tests/report-notes.test.sql scripts/schema-drift.mjs docs/07-backup.md src/lib/types.ts src/lib/api/notes.ts src/lib/api/results.ts
git commit -m "Add the named notes log view and the reads the check-in needs"
```

---

### Task 3: The Weekly class check-in

**Files:**
- Create: `src/lib/reports/checkIn.ts`, `src/lib/reports/checkIn.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `DayRange`, `previousRange`, `rangeText`, `deltaText`, and the `weekBars` chart.
  - From B1: the `ReportHead` type (`src/lib/reports/grading.ts`).
  - Types: `Action` (`src/lib/insight.ts`); `ActivityDay`, `TaskState`, `RosterRow`, `MilestoneProgress` and `ClassNote` (`src/lib/types.ts`).
  - Helpers: `STUCK_DAYS`, `INACTIVE_DAYS`, `addDays`, `daysBetween`, `manilaDay`, `mondayOf` and `weeklyActivity` (`src/lib/analyticsMath.ts`).
- Produces:
  - `type CheckInBoard = { board_id: string; name: string; project_title: string; submitted_at: string | null }`
  - `type CheckInResult = { board_id: string; verdict: 'accepted' | 'returned'; decided_at: string }`
  - `weekFigures(input: Pick<CheckInInput, 'activity' | 'boards' | 'results' | 'roster'>, r: DayRange): WeekFigures`
  - `checkInDoc(input: CheckInInput): ReportDoc`
  - `CheckInInput = ReportHead & { range: DayRange; ended: boolean; activity: ActivityDay[]; tasks: TaskState[]; boards: CheckInBoard[]; results: CheckInResult[]; roster: RosterRow[]; milestones: MilestoneProgress[]; projects: { id: string; title: string; due_at: string | null }[]; actions: Action[]; notes: ClassNote[]; noteName: (n: ClassNote) => string }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/checkIn.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkInDoc, weekFigures } from './checkIn'
import type { CheckInInput } from './checkIn'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { ActivityDay, ClassNote, RosterRow, TaskState } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const week = { from: '2026-10-12', to: '2026-10-18' }

const act = (day: string, kind: ActivityDay['kind'], n: number, actor = 's1', board = 'b1'): ActivityDay => ({
  class_id: 'c', project_id: 'p1', board_id: board, actor_id: actor, day, kind, n,
})
const task = (over: Partial<TaskState>): TaskState => ({
  task_id: 't', title: 'Task', status: 'todo', due_at: null, late: false, weight: 1, started_at: null, done_at: null,
  created_at: '2026-10-01T00:00:00Z', board_id: 'b1', class_id: 'c', project_id: 'p1', project_title: 'Lab 6',
  group_id: 'g1', group_name: 'Group 1', board_student_name: null, assignee_ids: [], assignee_names: '', ...over,
})
const student = (id: string, name: string): RosterRow => ({
  class_id: 'c', student_id: id, student_name: name, avatar_url: null, group_names: ['Group 1'], held: 1, done: 0,
  late: 0, worklog_minutes: 0, comments: 0, last_active_at: null,
})
const note = (over: Partial<ClassNote>): ClassNote => ({
  id: 'n', class_id: 'c', student_id: 's1', board_id: null, kind: 'follow_up', body: 'Check the draft',
  follow_up_on: '2026-10-15', resolved_at: null, outcome: '', created_by: 'p', created_at: '2026-10-10T00:00:00Z', ...over,
})

const base: CheckInInput = {
  ...head, range: week, ended: false,
  activity: [
    act('2026-10-13', 'finished', 3), act('2026-10-13', 'started', 2), act('2026-10-14', 'commented', 4),
    act('2026-10-06', 'finished', 1),
  ],
  tasks: [
    task({ task_id: 't1', title: 'Write the model', status: 'in_progress', started_at: '2026-10-05T01:00:00Z' }),
    task({ task_id: 't2', title: 'Due soon', due_at: '2026-10-20T15:00:00Z' }),
  ],
  boards: [
    { board_id: 'b1', name: 'Group 1', project_title: 'Lab 6', submitted_at: '2026-10-16T02:00:00Z' },
    { board_id: 'b2', name: 'Group 2', project_title: 'Lab 6', submitted_at: null },
  ],
  results: [{ board_id: 'b2', verdict: 'returned', decided_at: '2026-10-14T03:00:00Z' }],
  roster: [student('s1', 'Ana Cruz'), student('s2', 'Ben Diaz')],
  milestones: [],
  projects: [{ id: 'p1', title: 'Lab 6', due_at: '2026-10-22T15:00:00Z' }],
  actions: [{ key: 'a', kind: 'stalled_board', severity: 1, title: 'Group 2 has stopped', evidence: 'Nothing moved.', to: null, classId: 'c', boardId: 'b2', projectId: 'p1' }],
  notes: [note({ id: 'n1' }), note({ id: 'n2', follow_up_on: '2026-10-16', resolved_at: '2026-10-16T00:00:00Z' })],
  noteName: (n) => (n.student_id === 's1' ? 'Ana Cruz' : 'Group 2'),
}

const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)
const table = (doc: ReportDoc, id: string) => tableBlocks(doc).find((t) => t.id === id)

describe('weekFigures', () => {
  it('counts events, hand-ins, returns and active students inside the range only', () => {
    expect(weekFigures(base, week)).toEqual({ finished: 3, started: 2, comments: 4, handIns: 1, returns: 1, active: 1 })
    expect(weekFigures(base, { from: '2026-10-05', to: '2026-10-11' }).finished).toBe(1)
  })
})

describe('checkInDoc', () => {
  const doc = checkInDoc(base)

  it('shows each figure with its change from the week before', () => {
    expect(kpi(doc, 'Tasks finished')).toMatchObject({ value: 3, delta: 2 })
    expect(kpi(doc, 'Tasks started')).toMatchObject({ value: 2, delta: 2 })
    expect(kpi(doc, 'Students active')).toMatchObject({ value: 1, delta: 0 })
    const block = doc.blocks.find((b) => b.kind === 'kpis')
    expect(block && block.kind === 'kpis' && block.compareLabel).toBe('Oct 5 to Oct 11, 2026')
  })
  it('lists every group with what moved', () => {
    const moved = table(doc, 'moved')!
    expect(moved.rows.map((r) => r[0])).toEqual(['Group 1', 'Group 2'])
    expect(moved.rows[0]).toEqual(['Group 1', 'Lab 6', 3, 2, 4, '2026-10-16T02:00:00Z', 0])
    expect(moved.rows[1][6]).toBe(1)
  })
  it('measures stuck work and idle people as of the last day of the range', () => {
    const stuck = table(doc, 'stuck')!
    const kinds = stuck.rows.map((r) => (r[0] as { value: string }).value)
    expect(kinds).toContain('Task')
    expect(kinds).toContain('Group')
    expect(kinds).toContain('Student')
    const t = stuck.rows.find((r) => r[1] === 'Write the model')!
    expect(t[4]).toBe(13)
    expect(stuck.rows.some((r) => r[1] === 'Ben Diaz')).toBe(true)
    expect(stuck.rows.some((r) => r[1] === 'Ana Cruz')).toBe(false)
  })
  it('lists what falls due in the 7 days after the range', () => {
    const coming = table(doc, 'coming')!
    expect(coming.rows.map((r) => [r[1], r[2]])).toEqual([['Task', 'Due soon'], ['Project', 'Lab 6']])
  })
  it('lists the ranked actions, then open follow-ups due in the range', () => {
    const attention = table(doc, 'attention')!
    expect(attention.rows.map((r) => r[1])).toEqual(['Group 2 has stopped', 'Follow up with Ana Cruz'])
  })
  it('charts the 8 weeks ending on the range', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.kind === 'weekBars' && chart.chart.rows.length).toBe(8)
  })
  it('says so in words when nothing happened', () => {
    // No boards, nobody on the roster, nothing due: idle groups and students would otherwise be "stuck".
    const quiet = checkInDoc({ ...base, activity: [], results: [], tasks: [], actions: [], notes: [],
      boards: [], roster: [], projects: [], milestones: [] })
    expect(kpi(quiet, 'Tasks finished')).toMatchObject({ value: 0, delta: 0 })
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text === 'This class has no project boards yet.')).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing is stuck'))).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing falls due'))).toBe(true)
    expect(quiet.blocks.some((b) => b.kind === 'note' && b.text.includes('Nothing needs you'))).toBe(true)
  })
  it('says the class has ended instead of reporting on it', () => {
    const ended = checkInDoc({ ...base, ended: true })
    expect(ended.blocks).toEqual([{ kind: 'note', tone: 'info', text: 'This class has ended. The weekly check-in covers live classes.' }])
  })
})
```

The stuck task: started Oct 5 (Manila), measured as of Oct 18, is 13 days. Ben Diaz has no activity, so he is inactive. Ana was last active on Oct 14, which is 4 days before Oct 18, under `INACTIVE_DAYS`. Group 1 was active, but Group 2 has no activity and no hand-in, so it is idle.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/checkIn.test.ts`
Expected: FAIL (`./checkIn` is missing).

- [ ] **Step 3: Write `src/lib/reports/checkIn.ts`**

```ts
import { INACTIVE_DAYS, STUCK_DAYS, addDays, daysBetween, manilaDay, mondayOf, weeklyActivity } from '../analyticsMath'
import type { Action } from '../insight'
import type { ActivityDay, ClassNote, MilestoneProgress, RosterRow, TaskState } from '../types'
import type { Block, Cell, Kpi, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { previousRange, rangeText } from './range'
import type { DayRange } from './range'

export type CheckInBoard = { board_id: string; name: string; project_title: string; submitted_at: string | null }
export type CheckInResult = { board_id: string; verdict: 'accepted' | 'returned'; decided_at: string }

export type CheckInInput = ReportHead & {
  range: DayRange
  /** The class has ended; Phase A views carry nothing for it. */
  ended: boolean
  activity: ActivityDay[]
  tasks: TaskState[]
  boards: CheckInBoard[]
  results: CheckInResult[]
  roster: RosterRow[]
  milestones: MilestoneProgress[]
  projects: { id: string; title: string; due_at: string | null }[]
  actions: Action[]
  notes: ClassNote[]
  noteName: (n: ClassNote) => string
}

export type WeekFigures = { finished: number; started: number; comments: number; handIns: number; returns: number; active: number }

const within = (day: string, r: DayRange) => day >= r.from && day <= r.to

export function weekFigures(
  input: Pick<CheckInInput, 'activity' | 'boards' | 'results' | 'roster'>,
  r: DayRange,
): WeekFigures {
  const sum = (kind: ActivityDay['kind']) =>
    input.activity.filter((a) => a.kind === kind && within(a.day, r)).reduce((s, a) => s + a.n, 0)
  const students = new Set(input.roster.map((s) => s.student_id))
  const active = new Set(
    input.activity.filter((a) => within(a.day, r) && a.actor_id && students.has(a.actor_id)).map((a) => a.actor_id),
  )
  return {
    finished: sum('finished'),
    started: sum('started'),
    comments: sum('commented'),
    handIns: input.boards.filter((b) => b.submitted_at && within(manilaDay(b.submitted_at), r)).length,
    returns: input.results.filter((x) => x.verdict === 'returned' && within(manilaDay(x.decided_at), r)).length,
    active: active.size,
  }
}

const SEVERITY: Record<number, { value: string; tone: 'danger' | 'warning' | 'pending' }> = {
  1: { value: 'Urgent', tone: 'danger' },
  2: { value: 'Soon', tone: 'warning' },
  3: { value: 'Note', tone: 'pending' },
}
const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const brief = (s: string) => (s.trim().length > 140 ? `${s.trim().slice(0, 140)}…` : s.trim())

export function checkInDoc(input: CheckInInput): ReportDoc {
  const r = input.range
  const prev = previousRange(r)
  const header = {
    title: 'Weekly class check-in',
    subtitle: rangeText(r),
    classLine: input.classLine,
    rangeLabel: `Compared with ${rangeText(prev)}`,
    madeAt: input.madeAt,
  }
  const footer = {
    lines: ['Counts are events recorded in Collabify. A flag is a prompt for a conversation, not a verdict.'],
    signatures: [{ role: 'Prepared by', name: input.professor }],
  }
  if (input.ended) {
    return { header, blocks: [{ kind: 'note', tone: 'info', text: 'This class has ended. The weekly check-in covers live classes.' }], footer }
  }

  const now = weekFigures(input, r)
  const before = weekFigures(input, prev)
  const kpi = (label: string, k: keyof WeekFigures): Kpi => ({ label, value: now[k], delta: now[k] - before[k] })

  const blocks: Block[] = [
    {
      kind: 'kpis',
      compareLabel: rangeText(prev),
      items: [
        kpi('Tasks finished', 'finished'),
        kpi('Tasks started', 'started'),
        kpi('Hand-ins', 'handIns'),
        kpi('Returns', 'returns'),
        kpi('Comments', 'comments'),
        kpi('Students active', 'active'),
      ],
    },
  ]

  // Moved this week: every board, quiet ones included, so silence shows.
  const boards = [...input.boards].sort((a, b) => a.name.localeCompare(b.name) || a.project_title.localeCompare(b.project_title))
  if (boards.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'This class has no project boards yet.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'moved',
      title: 'Moved this week',
      columns: [
        { key: 'group', label: 'Group', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'finished', label: 'Finished', type: 'number' },
        { key: 'started', label: 'Started', type: 'number' },
        { key: 'comments', label: 'Comments', type: 'number' },
        { key: 'handedIn', label: 'Handed in', type: 'date' },
        { key: 'returns', label: 'Returns', type: 'number' },
      ],
      rows: boards.map<Cell[]>((b) => {
        const mine = input.activity.filter((a) => a.board_id === b.board_id && within(a.day, r))
        const n = (kind: ActivityDay['kind']) => mine.filter((a) => a.kind === kind).reduce((s, a) => s + a.n, 0)
        return [
          b.name,
          b.project_title,
          n('finished'),
          n('started'),
          n('commented'),
          b.submitted_at && within(manilaDay(b.submitted_at), r) ? b.submitted_at : null,
          input.results.filter((x) => x.board_id === b.board_id && x.verdict === 'returned' && within(manilaDay(x.decided_at), r)).length,
        ]
      }),
    })
  }

  // Stuck, measured as of the last day of the range.
  const asOf = r.to
  const stuck: Cell[][] = []
  for (const t of input.tasks) {
    if (t.status !== 'in_progress' || !t.started_at) continue
    const since = manilaDay(t.started_at)
    if (since > asOf) continue
    const days = daysBetween(since, asOf)
    if (days >= STUCK_DAYS) {
      stuck.push([{ value: 'Task', tone: 'warning' }, t.title, `${t.group_name ?? t.board_student_name ?? 'A board'} · ${t.project_title}`, since, days])
    }
  }
  for (const b of boards) {
    if (b.submitted_at && manilaDay(b.submitted_at) <= asOf) continue
    const days = input.activity.filter((a) => a.board_id === b.board_id && a.day <= asOf).map((a) => a.day).sort()
    const last = days.at(-1) ?? null
    const idle = last ? daysBetween(last, asOf) : null
    if (idle === null || idle >= INACTIVE_DAYS) {
      stuck.push([{ value: 'Group', tone: 'warning' }, b.name, b.project_title, last, idle])
    }
  }
  for (const s of [...input.roster].sort((a, b) => a.student_name.localeCompare(b.student_name))) {
    const days = input.activity.filter((a) => a.actor_id === s.student_id && a.day <= asOf).map((a) => a.day).sort()
    const last = days.at(-1) ?? null
    const idle = last ? daysBetween(last, asOf) : null
    if (idle === null || idle >= INACTIVE_DAYS) {
      stuck.push([{ value: 'Student', tone: 'pending' }, s.student_name, s.group_names.join(', ') || null, last, idle])
    }
  }
  if (stuck.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing is stuck: no task has sat in progress, and every group and student has been active.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'stuck',
      title: 'Stuck',
      columns: [
        { key: 'type', label: 'What', type: 'status' },
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'where', label: 'Where', type: 'text' },
        { key: 'since', label: 'Last moved', type: 'date' },
        { key: 'days', label: 'Days', type: 'number' },
      ],
      rows: stuck,
      note: `A task counts after ${STUCK_DAYS} days in progress; a group or student after ${INACTIVE_DAYS} days with no activity. Never active shows no date.`,
    })
  }

  // Coming up: the 7 days after the range.
  const from = addDays(r.to, 1)
  const to = addDays(r.to, 7)
  const soon = (day: string) => day >= from && day <= to
  const coming: Cell[][] = []
  for (const t of input.tasks) {
    if (t.status === 'done' || !t.due_at) continue
    const d = manilaDay(t.due_at)
    if (soon(d)) coming.push([d, 'Task', t.title, `${t.group_name ?? t.board_student_name ?? 'A board'} · ${t.project_title}`])
  }
  for (const p of input.projects) {
    if (p.due_at && soon(manilaDay(p.due_at))) coming.push([manilaDay(p.due_at), 'Project', p.title, null])
  }
  const seen = new Set<string>()
  for (const m of input.milestones) {
    if (seen.has(m.milestone_id) || !soon(m.due_on)) continue
    seen.add(m.milestone_id)
    coming.push([m.due_on, 'Milestone', m.name, input.projects.find((p) => p.id === m.project_id)?.title ?? null])
  }
  const ORDER = { Task: 0, Milestone: 1, Project: 2 } as Record<string, number>
  coming.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || ORDER[String(a[1])] - ORDER[String(b[1])])
  if (coming.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: `Nothing falls due between ${DAY.format(new Date(`${from}T00:00:00+08:00`))} and ${DAY.format(new Date(`${to}T00:00:00+08:00`))}.` })
  } else {
    blocks.push({
      kind: 'table',
      id: 'coming',
      title: 'Coming up in the next 7 days',
      columns: [
        { key: 'due', label: 'Due', type: 'date' },
        { key: 'kind', label: 'Kind', type: 'text' },
        { key: 'what', label: 'What', type: 'text' },
        { key: 'where', label: 'Where', type: 'text' },
      ],
      rows: coming,
    })
  }

  // Needs attention: the ranked list as of now, then follow-ups due in the range.
  const attention: Cell[][] = [
    ...input.actions.map<Cell[]>((a) => [SEVERITY[a.severity] ?? SEVERITY[3], a.title, a.evidence || null]),
    ...input.notes
      .filter((n) => !n.resolved_at && n.follow_up_on !== null && within(n.follow_up_on, r))
      .sort((a, b) => String(a.follow_up_on).localeCompare(String(b.follow_up_on)))
      .map<Cell[]>((n) => [
        { value: 'Follow-up', tone: 'warning' },
        `Follow up with ${input.noteName(n)}`,
        `Due ${DAY.format(new Date(`${n.follow_up_on}T00:00:00+08:00`))}. Noted: ${brief(n.body)}`,
      ]),
  ]
  if (attention.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nothing needs you right now.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'attention',
      title: 'Needs attention',
      columns: [
        { key: 'level', label: 'Level', type: 'status' },
        { key: 'what', label: 'What', type: 'text' },
        { key: 'why', label: 'Why', type: 'text' },
      ],
      rows: attention,
      note: 'The ranked list is as of the day this report was made.',
    })
  }

  const weeks = weeklyActivity(input.activity, addDays(mondayOf(r.to), -49), r.to)
  const last = weeks.at(-1)
  const avg = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.work + w.talk, 0) / weeks.length) : 0
  blocks.push({
    kind: 'chart',
    id: 'weekly',
    title: 'Activity, the last 8 weeks',
    chart: { kind: 'weekBars', rows: weeks },
    summary: `The week of ${DAY.format(new Date(`${last?.week ?? r.to}T00:00:00+08:00`))}: ${last?.work ?? 0} work events and ${last?.talk ?? 0} comments or files. The 8-week average is ${avg} a week.`,
  })

  return { header, blocks, footer }
}
```

Two checks against the tests:
- The `moved` row for Group 1 is `['Group 1', 'Lab 6', 3, 2, 4, '2026-10-16T02:00:00Z', 0]`. The hand-in cell is the raw `submitted_at`, which the `date` column formats.
- `weeklyActivity(rows, from, to)` covers Mondays from `mondayOf(from)` to `mondayOf(to)`. With `from = addDays(mondayOf(to), -49)` that is 8 weeks.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reports/checkIn.test.ts`, then `npx eslint src/lib/reports`.
Expected: PASS and clean. If a hand value fails, work out by hand which side is wrong. Do not change the expected value; report it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/checkIn.ts src/lib/reports/checkIn.test.ts
git commit -m "Build the weekly class check-in"
```

---

### Task 4: The Intervention log

**Files:**
- Create: `src/lib/reports/interventionLog.ts`, `src/lib/reports/interventionLog.test.ts`

**Interfaces:**
- Consumes: `NoteLogRow`, `ClassNoteKind` (`src/lib/types.ts`); `NOTE_KIND_META` (`src/lib/notes.ts`); `manilaDay`; `DayRange`, `rangeText` (Task 1); `ReportHead`.
- Produces:
  - `type LogFilters = { kinds: ClassNoteKind[]; status: 'open' | 'resolved' | 'all'; studentId: string; boardId: string }`
  - `interventionLogDoc(input: ReportHead & { range: DayRange; asOf: string; notes: NoteLogRow[]; filters: LogFilters }): ReportDoc`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/interventionLog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { interventionLogDoc } from './interventionLog'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { NoteLogRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 14, 2026' }
const range = { from: '2026-10-01', to: '2026-10-31' }
const all = { kinds: [], status: 'all' as const, studentId: '', boardId: '' }

const row = (over: Partial<NoteLogRow>): NoteLogRow => ({
  id: 'n', class_id: 'c', student_id: 's1', board_id: null, kind: 'note', body: 'zz', follow_up_on: null,
  resolved_at: null, outcome: '', created_by: 'p', created_at: '2026-10-10T02:00:00Z',
  student_name: 'Ana Cruz', group_name: null, project_title: null, author_name: 'Prof. Reyes', ...over,
})
const notes = [
  row({ id: 'late', created_at: '2026-10-20T02:00:00Z', kind: 'meeting', body: 'Talked' }),
  row({ id: 'early', created_at: '2026-10-05T02:00:00Z', kind: 'follow_up', follow_up_on: '2026-10-08', body: 'Check draft' }),
  row({ id: 'nudge', created_at: '2026-10-06T02:00:00Z', kind: 'nudge', student_id: null, board_id: 'b1', student_name: null, group_name: 'Group 1', project_title: 'Lab 6', body: 'Reminder sent' }),
  row({ id: 'resolved', created_at: '2026-10-07T02:00:00Z', kind: 'follow_up', follow_up_on: '2026-10-09', resolved_at: '2026-10-09T02:00:00Z', outcome: 'Caught up' }),
  row({ id: 'outside', created_at: '2026-09-20T02:00:00Z' }),
]
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('interventionLogDoc', () => {
  const doc = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: all })
  const log = tableBlocks(doc)[0]

  it('keeps notes inside the range, oldest first', () => {
    expect(log.rows.map((r) => r[3])).toEqual(['Check draft', 'Reminder sent', 'zz', 'Talked'])
  })
  it('names what each note is about and who wrote it', () => {
    const nudge = log.rows.find((r) => r[3] === 'Reminder sent')!
    expect(nudge[2]).toBe('Group 1 · Lab 6')
    expect(nudge[1]).toEqual({ value: 'Reminder', tone: 'pending' })
    expect(log.rows[0][7]).toBe('Prof. Reyes')
  })
  it('counts kinds, open and overdue follow-ups, and reminders', () => {
    expect(kpi(doc, 'Follow-up')).toBe(2)
    expect(kpi(doc, 'Meeting')).toBe(1)
    expect(kpi(doc, 'Open follow-ups')).toBe(1)
    expect(kpi(doc, 'Overdue follow-ups')).toBe(1)
    expect(kpi(doc, 'Reminders sent')).toBe(1)
  })
  it('filters by kind, status, student and group', () => {
    const only = (f: Partial<typeof all>) =>
      tableBlocks(interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: { ...all, ...f } }))[0]?.rows.length ?? 0
    expect(only({ kinds: ['meeting'] })).toBe(1)
    expect(only({ status: 'resolved' })).toBe(1)
    expect(only({ status: 'open' })).toBe(3)
    expect(only({ boardId: 'b1' })).toBe(1)
    expect(only({ studentId: 's1' })).toBe(3)
  })
  it('says so when the filters match nothing', () => {
    const none = interventionLogDoc({ ...head, range, asOf: '2026-10-14', notes, filters: { ...all, kinds: ['peer_reminder'] } })
    expect(tableBlocks(none)).toHaveLength(0)
    expect(none.blocks.some((b) => b.kind === 'note' && b.text === 'No notes in these dates. Widen the dates or add notes from Analytics.')).toBe(true)
    expect(kpi(none, 'Open follow-ups')).toBe(0)
  })
  it('carries the staff-only footer', () => {
    expect(doc.footer.lines).toContain('Only teaching staff can read these notes.')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/interventionLog.test.ts`
Expected: FAIL (`./interventionLog` is missing).

- [ ] **Step 3: Write `src/lib/reports/interventionLog.ts`**

```ts
import { manilaDay } from '../analyticsMath'
import { NOTE_KIND_META } from '../notes'
import type { ClassNoteKind, NoteLogRow } from '../types'
import type { Block, Cell, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

export type LogFilters = { kinds: ClassNoteKind[]; status: 'open' | 'resolved' | 'all'; studentId: string; boardId: string }

const KIND_ORDER: ClassNoteKind[] = ['note', 'meeting', 'follow_up', 'nudge', 'peer_reminder']

export function interventionLogDoc(input: ReportHead & {
  range: DayRange
  /** Today, a Manila day: what "overdue" is measured against. */
  asOf: string
  notes: NoteLogRow[]
  filters: LogFilters
}): ReportDoc {
  const { range, filters } = input
  const shown = input.notes
    .filter((n) => {
      const day = manilaDay(n.created_at)
      return day >= range.from && day <= range.to
    })
    .filter((n) => filters.kinds.length === 0 || filters.kinds.includes(n.kind))
    .filter((n) => (filters.status === 'open' ? !n.resolved_at : filters.status === 'resolved' ? !!n.resolved_at : true))
    .filter((n) => !filters.studentId || n.student_id === filters.studentId)
    .filter((n) => !filters.boardId || n.board_id === filters.boardId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  const count = (k: ClassNoteKind) => shown.filter((n) => n.kind === k).length
  const openFollowUps = shown.filter((n) => !n.resolved_at && n.follow_up_on !== null)
  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        ...KIND_ORDER.filter((k) => count(k) > 0).map((k) => ({ label: NOTE_KIND_META[k].label, value: count(k) })),
        { label: 'Open follow-ups', value: openFollowUps.length },
        { label: 'Overdue follow-ups', value: openFollowUps.filter((n) => (n.follow_up_on as string) < input.asOf).length },
        { label: 'Reminders sent', value: count('nudge') + count('peer_reminder') },
      ],
    },
  ]

  if (shown.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No notes in these dates. Widen the dates or add notes from Analytics.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'log',
      title: 'Log',
      columns: [
        { key: 'date', label: 'Date', type: 'datetime' },
        { key: 'kind', label: 'Kind', type: 'status' },
        { key: 'about', label: 'About', type: 'text' },
        { key: 'note', label: 'Note', type: 'text' },
        { key: 'followUp', label: 'Follow up by', type: 'date' },
        { key: 'resolved', label: 'Resolved', type: 'date' },
        { key: 'outcome', label: 'Outcome', type: 'text' },
        { key: 'by', label: 'Written by', type: 'text' },
      ],
      rows: shown.map<Cell[]>((n) => [
        n.created_at,
        { value: NOTE_KIND_META[n.kind].label, tone: NOTE_KIND_META[n.kind].tone },
        n.student_name ?? (n.group_name ? `${n.group_name}${n.project_title ? ` · ${n.project_title}` : ''}` : null),
        n.body,
        n.follow_up_on,
        n.resolved_at,
        n.outcome || null,
        n.author_name,
      ]),
    })
  }

  const parts = [
    filters.kinds.length ? filters.kinds.map((k) => NOTE_KIND_META[k].label).join(', ') : null,
    filters.status !== 'all' ? (filters.status === 'open' ? 'Open only' : 'Resolved only') : null,
  ].filter(Boolean)

  return {
    header: {
      title: 'Intervention log',
      subtitle: rangeText(range),
      classLine: input.classLine,
      rangeLabel: parts.length ? parts.join(' · ') : null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: ['Only teaching staff can read these notes.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
```

The KPI test expects these values:
- `Follow-up` 2: early and resolved.
- `Open follow-ups` 1: only early is open with a date.
- `Overdue` 1: early, Oct 8, is before Oct 14.
- `Reminders` 1: the nudge.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reports/interventionLog.test.ts`, then `npx eslint src/lib/reports`.
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/interventionLog.ts src/lib/reports/interventionLog.test.ts
git commit -m "Build the intervention log"
```

---

### Task 5: The two reports on the Reports page

**Files:**
- Modify: `src/pages/app/reports/reportKind.ts` (+ `reportKind.test.ts`)
- Modify: `src/pages/app/reports/useReports.ts`, `src/pages/app/reports/useReportDoc.ts`
- Modify: `src/components/reports/ReportPicker.tsx`, `src/pages/app/reports/Reports.tsx`

**Interfaces:**
- Consumes:
  - Tasks 1–4;
  - `dailyActivity`, `taskStates`, `studentRoster`, `milestoneProgress`, `classActions` and `boardBurn` (`src/lib/api/analytics.ts`);
  - `rankActions` (`src/lib/insight.ts`);
  - `listClassNoteLog` (`src/lib/api/notes.ts`);
  - `boardResultsFor` (`src/lib/api/results.ts`);
  - `manilaDay`.
- Produces:
  - `ReportKind` gains `'checkin' | 'notes'`, with `NEEDS` set to `['class']` for both.
  - `useReports` gains:
    - `rangeChoice` / `setRangeChoice`
    - `customFrom` / `customTo` / `setCustomRange`
    - `noteKinds` / `setNoteKinds`
    - `noteStatus` / `setNoteStatus`

    These are held in the URL under `rrange`, `rfrom`, `rto`, `rkinds` (comma-separated) and `rstatus`.

- [ ] **Step 1: The kinds**

In `reportKind.ts`:
- Add `'checkin' | 'notes'` to `ReportKind`.
- Add `checkin: ['class']` and `notes: ['class']` to `NEEDS`.

In `reportKind.test.ts`, add a case: `parseReportKind('checkin')` returns `'checkin'`, and `parseReportKind('notes')` returns `'notes'`.

- [ ] **Step 2: Choices in `useReports.ts`**

Read from the URL:
- `rangeChoice`: `parseRangeChoice(params.get('rrange'), kind === 'notes' ? 'last30' : 'thisWeek')`
- `customFrom`: `params.get('rfrom') ?? ''`
- `customTo`: `params.get('rto') ?? ''`
- `noteKinds`: `(params.get('rkinds') ?? '').split(',').filter((k) => k in NOTE_KIND_META) as ClassNoteKind[]`. Use `Object.hasOwn(NOTE_KIND_META, k)`, not `in`.
- `noteStatus`: `['open', 'resolved'].includes(params.get('rstatus') ?? '') ? … : 'all'`

Setters (each one `patch`es):
- `setRangeChoice(v)` sets `rrange`. It also clears `rfrom` and `rto` unless `v === 'custom'`.
- `setCustomRange(from, to)` sets `rfrom` and `rto`.
- `setNoteKinds(list)` sets `rkinds` to `list.join(',')`.
- `setNoteStatus(v)` sets `rstatus`; `'all'` clears it.

`choose(next)` clears `rrange`, `rfrom` and `rto` when leaving `checkin` or `notes` for a kind that is neither. It clears `rkinds` and `rstatus` when leaving `notes`.

For `notes`, the optional student and group pickers use the existing `rstudent` / `rgroup`. Add `'notes'` to `OPTIONAL_STUDENT` so the student select shows with "Whole class". For the group, see Step 4. `ready` for both kinds needs only the class (`NEEDS` already says so).

Return all of these from the hook.

- [ ] **Step 3: Loading in `useReportDoc.ts`**

- **The key:** extend `currentKey` with `rangeChoice`, `customFrom`, `customTo`, `noteKinds.join(',')`, `noteStatus` and `boardId`. Compute `today = manilaDay(new Date())` once inside the build, and `range = resolveRange(rangeChoice, today, { from: customFrom, to: customTo })`.
- **Live updates:** the existing `useLive(retry, […], { every: 0, enabled })` gains `'class_notes'`, `'task_events'`, `'project_tasks'` and `'board_results'` in its table list. `enabled` now covers all four new kinds: `['grading', 'peer', 'checkin', 'notes'].includes(kind) && ready`.
- **The `checkin` branch:**

```ts
} else if (kind === 'checkin') {
  const [activity, tasks, roster, milestones, actionRows, burns, results, notes] = await Promise.all([
    dailyActivity(), taskStates(), studentRoster(), milestoneProgress(), classActions(), boardBurn(),
    boardResultsFor(boardsAll.map((b) => b.id)), listClassNotes(),
  ])
  const inClass = <T extends { class_id: string }>(xs: T[]) => xs.filter((x) => x.class_id === cls.class_id)
  const ownBurns = inClass(burns)
  const names = new Map(inClass(roster).map((x) => [x.student_id, x.student_name]))
  const boardName = new Map(boardsAll.map((b) => [b.id, b.group_name ?? b.student_name ?? 'A board']))
  next = checkInDoc({
    ...head, range, ended: Boolean(cls.archived_at),
    activity: inClass(activity), tasks: inClass(tasks), roster: inClass(roster), milestones: inClass(milestones),
    boards: boardsAll.map((b) => ({ board_id: b.id, name: boardName.get(b.id)!, project_title: b.project_title, submitted_at: b.submitted_at })),
    results,
    projects: projectsAll.map((p) => ({ id: p.id, title: p.title, due_at: p.due_at })),
    actions: rankActions(inClass(actionRows), ownBurns),
    notes: inClass(notes),
    noteName: (n) => (n.student_id ? names.get(n.student_id) ?? 'a student' : boardName.get(n.board_id ?? '') ?? 'a group'),
  })
}
```

  `boardsAll` and `projectsAll` are the class's boards and projects, **not** narrowed by the project picker. Expose `allBoards` from `useReports` (the unfiltered `boards` state) if the hook only returns `shownBoards`. `rankActions` and `boardBurn` already exist; check `rankActions`' signature (`(rows, burns, extra?)`).
- **The `notes` branch:**

```ts
} else if (kind === 'notes') {
  const rows = await listClassNoteLog(cls.class_id)
  next = interventionLogDoc({
    ...head, range, asOf: today, notes: rows,
    filters: { kinds: noteKinds, status: noteStatus, studentId, boardId },
  })
}
```

- **Content keys:** keep the B1 signature-based keys. The new kinds key on the choices above and on `classId`. Their data loads inside the build, so they need no array signatures.

- [ ] **Step 4: Picker controls (`ReportPicker.tsx` via `extras`, built in `Reports.tsx`)**

For `checkin` and `notes`, build the `extras` node:

- **Range select:** `RANGE_CHOICES` (for `checkin`, drop `last30`) bound to `r.rangeChoice`. When `custom` is chosen, show two `<input type="date">` fields bound to `r.customFrom` and `r.customTo` through `r.setCustomRange`. Label each with visible text ("From", "To").
- **Notes only:**
  - **Kinds:** a row of checkbox chips, one per `NOTE_KIND_META` entry, toggling into `r.noteKinds`.
  - **Status:** a select (All, Open, Resolved).
  - **Group:** an optional select over the class's boards, with "Every group" as `''`, labelled `${group or student name} · ${project_title}` and bound to `r.boardId` / `r.setBoardId`.

  The student select comes from `OPTIONAL_STUDENT`.

Use the same field classes as the B1 peer extras (`h-9 rounded-lg border border-line surface px-2 text-ink`) and tokens only.

- [ ] **Step 5: The catalogue and previews (`Reports.tsx`)**

Add a group between "For grading" and "Older reports":

```ts
{
  group: 'For check-ins',
  items: [
    { kind: 'checkin', label: 'Weekly class check-in', body: 'What moved this week against the week before, what is stuck, what falls due next, and what needs you.' },
    { kind: 'notes', label: 'Intervention log', body: 'Every note, meeting, follow-up and reminder in a date range, with who wrote it. The record that you acted.' },
  ],
},
```

The new kinds use the same preview path as `grading` and `peer`: spinner, error with Retry, `ReportDocView`, and the Export menu. Add them to whatever list or condition decides "new-style kind" (B1 calls it `newKind`).

The export base names are `reportBase('weekly-check-in', subtitle)` and `reportBase('intervention-log', subtitle)`.

- [ ] **Step 6: Build, lint, test, commit**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.
Expected: all clean.

```bash
git add src/pages/app/reports/reportKind.ts src/pages/app/reports/reportKind.test.ts src/pages/app/reports/useReports.ts src/pages/app/reports/useReportDoc.ts src/components/reports/ReportPicker.tsx src/pages/app/reports/Reports.tsx
git commit -m "Add the weekly check-in and the intervention log to Reports"
```

---

## After the tasks (controller)

1. **Browser check, as faculty** (it only reads, so it needs no approval).
   - **Check-in:**
     - QM class, This week, then Last week, then a custom range typed backwards;
     - check each table and the 8-week chart, and that the KPI changes read "+N".
   - **Intervention log:**
     - the two "zz test" C3 notes appear with the author named;
     - try kind and status filters, a student filter and a group filter;
     - a filter that matches nothing shows the empty sentence.
   - **Both reports:**
     - run the Excel and Word writers in the page (as in B1), without downloading;
     - check light and dark, and widths of 375, 768 and 1440.
2. **Ship:**
   - fast-forward to `main` and push;
   - add a "Phase B2" section to `handoff.md`;
   - update the memory with B2 live, next B3.

---

## Self-review

- **Spec coverage (B2):**

  | Spec item | Where |
  |---|---|
  | Check-in options (class, week, any 7-day range, previous week compared) | Tasks 1 and 5 |
  | KPIs with changes | Tasks 1 and 3 |
  | Moved this week, Stuck (thresholds), Coming up, Needs attention + follow-ups | Task 3 |
  | Chart: 8 weeks | Task 3 |
  | Data needs no new SQL | Rulings 2–3; `board_results` read added in Task 2 |
  | Log options (class, range, student or group, kinds, status) | Task 5 |
  | Log KPIs and table, including who wrote it | Task 4 |
  | New view `class_note_log` (staff only, archived included) | Task 2 |
  | Testing: unit tests for the week-over-week changes (including previous 0), the Stuck thresholds and the empty states; SQL test for the view | Tasks 1–4 |
  | Deferred B1 minors: Excel notes and summaries, column widths | Task 1 |
- **Placeholders:** none. Task 5 names every key, setter and code path. The exact JSX for the picker extras follows the existing B1 peer extras, which the implementer reads.
- **Type consistency:**
  - `DayRange` comes from `range.ts` and is used by `checkIn.ts` and `interventionLog.ts`.
  - `CheckInBoard` and `CheckInResult` match `boardResultsFor`'s row shape.
  - `NoteLogRow` comes from Task 2 and is used by Task 4.
  - `LogFilters` uses `ClassNoteKind`.
  - `ReportHead` is from B1.
- **Review Focus:** each of the five items has its test in the task noted beside it.
