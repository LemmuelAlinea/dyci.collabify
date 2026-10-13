# Phase B1: Report Engine and Grading Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the class report engine, which turns one document model into four outputs (screen and print, Excel, Word, CSV). Ship the first two reports on it: the Individual grading sheet (one project, all projects, or one student) and the Peer evaluation summary.

**Architecture:**
- Each report is a pure builder, `(data, options) → ReportDoc`, unit-tested on fixtures.
- `ReportDocView` draws a `ReportDoc` on the existing A4 `Sheet`. Pure exporters turn the same `ReportDoc` into an Excel workbook model, Word-ready HTML, and CSV files. Thin async wrappers hand those to the existing writers.
- The Reports page gains the two new reports at the top of its catalogue and moves its choices into the URL. The seven old sheets stay under "Older reports" until B4.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind tokens, Vitest, plus the existing `exceljs` writer (`workbookToXlsx`) and `docx` writer (`htmlToDocx`) in `src/lib/general/office.ts`.

**Spec:** `docs/superpowers/specs/2026-10-13-phase-b-reports-design.md`. This plan covers "The engine (B1)", "B1 reports", "Shared rules" and the relevant parts of "Testing".

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | Excel stores dates as text `YYYY-MM-DD` (Manila day), not as date cells. | `workbookToXlsx` writes from a string grid. It turns numeric strings into numbers, but has no date type. A date that sorts as text is enough for a grade book. | Someone who wants date arithmetic in Excel converts the column once. |
| 2 | In the all-projects grid, "Not released" is marked on the **column header** (`Lab 6 (not released)`), not on each cell. | A release covers a whole project, so the column is the true unit. Cell tags would be lost in Excel anyway, because a cell keeps only its number. | None. |
| 3 | B1 adds one new chart, `Bars` (labelled horizontal bars), and `ChartSpec` has only `bars` for now. Later parts add `weekBars` and `burnup` when they need them. | The score spread and the dimension averages are both categorical bars, and no existing chart draws those. | None. |
| 4 | The choices live in the URL under report-specific keys: `report`, `rclass`, `rproject`, `rgroup`, `rstudent`, `rround` and `rcomments`. | Reports also render inside the class page, whose own address already uses keys such as `tab`. Prefixed keys cannot collide with them. | None. |
| 5 | Picking a student in the grading sheet switches to the one-student version across every project of the class, whichever project is selected. | That is the spec's wording ("the sheet switches to that one student across every project"). | The project select does nothing while a student is picked; the picker says so. |
| 6 | `reports.test.sql`'s score rule becomes: "any `report_%` view that reads a score table returns zero rows to a student". B1 adds no such view, so the test still holds; it is there for B2–B4. | This is the spec's new rule, written as a real check. | None. |

## Global Constraints

- **Staff only.** Every report is staff-only. B1 reads only existing staff-only sources: `score_sheet(project)`, `board_scores`, `project_criteria`, `peer_results`, `peer_round_status`, `peer_comments` and `report_student_work`. **No new SQL objects in B1.**
- **Archived data.** Archived classes and projects stay in reports. The class list already comes from `report_class_summary`, which keeps them.
- **Manila days.** Dates display as Manila days (`Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', … })`) and export as `YYYY-MM-DD` (`manilaDay` from `src/lib/analyticsMath.ts`).
- **Colours** come only from tokens: `TONE_CELL` from `src/components/charts/format.ts`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `surface-sunken`, `bg-progress`. No raw hex. Printing already forces the light palette (`src/styles/index.css` `@media print`).
- **Copy:** sentence case and active voice. No "please", no "successfully", no exclamation marks. An error says what happened and what to do next.
- **Exact strings** (from the spec):
  - footer line on the grading sheet: "Scores tagged Not released are not yet visible to students."
  - status labels: `Released`, `Not released`, and `Not confirmed` (for a row with no confirmed final);
  - confidential header: "Contains confidential peer comments";
  - the row-cap note: "Showing {cap} of {n}. Excel and CSV include every row."
- **React rules.**
  - A `.tsx` file exports components only (`react-refresh/only-export-components`); helpers, hooks and types go in `.ts` files.
  - Render-time clocks use `useNow()`.
- **Database:** the live database is the only one. B1 runs no SQL except rolled-back test files.
- **Staging:** never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`. Stage by name.
- **Editing:** use the Edit or Write tools, never PowerShell `Set-Content`.
- **Before calling a task done,** run `npm run build`, `npx eslint src` and `npx vitest run`.

## Review Focus

1. **A project with criteria but nothing confirmed yet**, or a class with no students. The sheet says so in words. It shows no `NaN`, no empty chart, and no average of nothing. *Task 4 test: `gradingClassDoc` with no confirmed finals gives an average and median of `—` and a note block instead of the chart.*
2. **A final equal to the total, or a final of zero.** The score lands in the top band (90–100%) or the bottom band. *Task 4 test: `scoreBand(100, 100) === 9`, `scoreBand(0, 100) === 0`, `scoreBand(89.5, 100) === 8`.*
3. **Two tables with the same title, or a title over 31 characters.** Excel sheet names stay unique and within 31 characters. *Task 2 test.*
4. **A group or comment that starts with `=`.** It is never written to Excel as a formula. *Task 2 test.*
5. **A peer round with no expected raters (expected 0) or no answers.** The response rate shows `—` or `0%`, and nothing divides by zero. *Task 5 test.*

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/reports/doc.ts` + `.test.ts` (new) | The `ReportDoc` types, plus formatting a cell for display (`cellText`) and for export (`cellExport`). |
| `src/lib/reports/export.ts` + `.test.ts` (new) | `docToWorkbook`, `docToHtml`, `docCsvFiles`, `sheetName`, `reportBase`; async `exportXlsx`, `exportDocx`, `exportCsv`. |
| `src/components/charts/Bars.tsx` (new) | Labelled horizontal bars. |
| `src/components/reports/ReportDocView.tsx` (new) | Draws a `ReportDoc` on the `Sheet`. |
| `src/lib/reports/grading.ts` + `.test.ts` (new) | `gradingClassDoc`, `gradingGridDoc`, `gradingStudentDoc`, `scoreBand`. |
| `src/lib/reports/peerSummary.ts` + `.test.ts` (new) | `peerSummaryDoc`, `defaultRound`. |
| `src/pages/app/reports/useReports.ts` (modify) | URL-held choices; new kinds `grading` and `peer`; round and comments. |
| `src/pages/app/reports/useReportDoc.ts` (new) | Loads a new report's data and builds its document. |
| `src/components/reports/ReportPicker.tsx` (modify) | Optional student, project-option override, extra options slot, and an export menu. |
| `src/pages/app/reports/Reports.tsx` (modify) | Catalogue groups, the new previews, and exports. |
| `supabase/tests/reports.test.sql` (modify) | The new score rule. |

---

### Task 1: The document model and cell formatting

**Files:**
- Create: `src/lib/reports/doc.ts`
- Create: `src/lib/reports/doc.test.ts`

**Interfaces:**
- Consumes: `Tone` and `manilaDay` from `src/lib/analyticsMath.ts`; `formatPoints` from `src/lib/scoreMath.ts`.
- Produces:
  - types `ReportDoc`, `Block`, `TableBlock`, `Column`, `ColumnType`, `Cell`, `RichCell`, `Kpi`, `ChartSpec`, `BarsChart`;
  - `cellValue(c: Cell): string | number | null`;
  - `cellText(c: Cell, col: Column): string`;
  - `cellExport(c: Cell, col: Column): string | number | null`;
  - `columnHeader(col: Column): string`;
  - `tableBlocks(doc: ReportDoc): TableBlock[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/doc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cellExport, cellText, columnHeader, tableBlocks } from './doc'
import type { Column, ReportDoc } from './doc'

const col = (type: Column['type'], outOf?: number): Column => ({ key: 'k', label: 'Final', type, outOf })

describe('cellText', () => {
  it('shows an empty cell as a dash', () => {
    expect(cellText(null, col('text'))).toBe('—')
    expect(cellText('', col('number'))).toBe('—')
  })
  it('formats numbers, percents and scores', () => {
    expect(cellText(84, col('number'))).toBe('84')
    expect(cellText(84.5, col('number'))).toBe('84.5')
    expect(cellText(66.666, col('percent'))).toBe('66.7%')
    expect(cellText(84.5, col('score', 100))).toBe('84.5 / 100')
    expect(cellText(84, col('score'))).toBe('84')
  })
  it('shows days and moments in Manila', () => {
    expect(cellText('2026-10-13', col('date'))).toBe('Oct 13, 2026')
    // 16:30 UTC is 00:30 the next day in Manila.
    expect(cellText('2026-10-13T16:30:00Z', col('date'))).toBe('Oct 14, 2026')
  })
  it('reads the value out of a rich cell', () => {
    expect(cellText({ value: 'Released', tone: 'success' }, col('status'))).toBe('Released')
  })
})

describe('cellExport', () => {
  it('keeps numbers as numbers', () => {
    expect(cellExport(84.5, col('score', 100))).toBe(84.5)
    expect(cellExport('12', col('number'))).toBe(12)
    expect(cellExport(66.666, col('percent'))).toBe(66.7)
  })
  it('writes days as YYYY-MM-DD in Manila and moments to the minute', () => {
    expect(cellExport('2026-10-13T16:30:00Z', col('date'))).toBe('2026-10-14')
    expect(cellExport('2026-10-13T16:30:00Z', col('datetime'))).toBe('2026-10-14 00:30')
  })
  it('leaves an empty cell empty', () => {
    expect(cellExport(null, col('number'))).toBeNull()
  })
})

describe('columnHeader', () => {
  it('says what a score is out of and marks percents', () => {
    expect(columnHeader(col('score', 100))).toBe('Final (of 100)')
    expect(columnHeader({ key: 'p', label: 'Share', type: 'percent' })).toBe('Share (%)')
    expect(columnHeader(col('text'))).toBe('Final')
  })
})

describe('tableBlocks', () => {
  it('lists only the tables, in order', () => {
    const doc: ReportDoc = {
      header: { title: 't', subtitle: 's', classLine: 'c', rangeLabel: null, madeAt: 'now' },
      blocks: [
        { kind: 'paragraph', text: 'p' },
        { kind: 'table', id: 'a', title: 'A', columns: [], rows: [] },
        { kind: 'note', tone: 'info', text: 'n' },
        { kind: 'table', id: 'b', title: 'B', columns: [], rows: [] },
      ],
      footer: { lines: [], signatures: [] },
    }
    expect(tableBlocks(doc).map((t) => t.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/doc.test.ts`
Expected: FAIL (`Failed to resolve import "./doc"`).

- [ ] **Step 3: Write `src/lib/reports/doc.ts`**

```ts
import type { Tone } from '../analyticsMath'
import { manilaDay } from '../analyticsMath'
import { formatPoints } from '../scoreMath'

/**
 * One report as data. A builder turns loaded rows into this; the screen, the
 * printer, Excel, Word and CSV all read the same object, so a report is written
 * once and never drifts between its outputs.
 */

export type ColumnType = 'text' | 'number' | 'percent' | 'date' | 'datetime' | 'score' | 'status'

export type Column = {
  key: string
  label: string
  type: ColumnType
  /** For a score column: what it is out of. */
  outOf?: number
}

export type RichCell = { value: string | number | null; tag?: string; tone?: Tone }
export type Cell = string | number | null | RichCell

export type Kpi = { label: string; value: number | string; unit?: string; delta?: number | null }

export type BarsChart = { kind: 'bars'; rows: { label: string; value: number }[]; max: number; unit?: string }
export type ChartSpec = BarsChart

export type TableBlock = {
  kind: 'table'
  id: string
  title: string
  columns: Column[]
  rows: Cell[][]
  note?: string
  /** Rows drawn on screen and in print. Exports always carry every row. */
  cap?: number
}

export type Block =
  | { kind: 'kpis'; items: Kpi[] }
  | { kind: 'heading'; text: string; level: 2 | 3 }
  | { kind: 'paragraph'; text: string }
  | TableBlock
  | { kind: 'chart'; id: string; title: string; chart: ChartSpec; summary: string }
  | { kind: 'note'; tone: 'info' | 'warning'; text: string }

export type ReportDoc = {
  header: {
    title: string
    subtitle: string
    classLine: string
    rangeLabel: string | null
    madeAt: string
    confidential?: string
  }
  blocks: Block[]
  footer: { lines: string[]; signatures: { role: string; name?: string }[] }
}

export function cellValue(c: Cell): string | number | null {
  return c !== null && typeof c === 'object' ? c.value : c
}

const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })
const MOMENT = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** A bare day is a Manila day; anything else is a moment. */
const asDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+08:00`) : new Date(v))
const toNumber = (v: string | number) => (typeof v === 'number' ? v : Number(v))

export function cellText(c: Cell, col: Column): string {
  const v = cellValue(c)
  if (v === null || v === '') return '—'
  switch (col.type) {
    case 'number':
      return Number.isFinite(toNumber(v)) ? formatPoints(toNumber(v)) : String(v)
    case 'percent':
      return Number.isFinite(toNumber(v)) ? `${toNumber(v).toFixed(1)}%` : String(v)
    case 'score': {
      if (!Number.isFinite(toNumber(v))) return String(v)
      const s = formatPoints(toNumber(v))
      return col.outOf ? `${s} / ${col.outOf}` : s
    }
    case 'date':
      return DAY.format(asDate(String(v)))
    case 'datetime':
      return MOMENT.format(asDate(String(v)))
    default:
      return String(v)
  }
}

/** What a spreadsheet or CSV gets: numbers as numbers, days as YYYY-MM-DD. */
export function cellExport(c: Cell, col: Column): string | number | null {
  const v = cellValue(c)
  if (v === null || v === '') return null
  switch (col.type) {
    case 'number':
    case 'score':
      return Number.isFinite(toNumber(v)) ? toNumber(v) : String(v)
    case 'percent':
      return Number.isFinite(toNumber(v)) ? Math.round(toNumber(v) * 10) / 10 : String(v)
    case 'date':
      return manilaDay(asDate(String(v)))
    case 'datetime': {
      const d = asDate(String(v))
      return `${manilaDay(d)} ${CLOCK.format(d)}`
    }
    default:
      return String(v)
  }
}

export function columnHeader(col: Column): string {
  if (col.type === 'score' && col.outOf) return `${col.label} (of ${col.outOf})`
  if (col.type === 'percent') return `${col.label} (%)`
  return col.label
}

export function tableBlocks(doc: ReportDoc): TableBlock[] {
  return doc.blocks.filter((b): b is TableBlock => b.kind === 'table')
}
```

- [ ] **Step 4: Run the tests and lint**

Run: `npx vitest run src/lib/reports/doc.test.ts`
Expected: PASS.

Then run `npx eslint src/lib/reports`. If `CLOCK` gives `24:30` for midnight in this Node version, keep `hourCycle: 'h23'`, which gives `00:30`. The test pins the expected value.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/doc.ts src/lib/reports/doc.test.ts
git commit -m "Add the report document model and cell formatting"
```

---

### Task 2: The exporters

**Files:**
- Create: `src/lib/reports/export.ts`
- Create: `src/lib/reports/export.test.ts`

**Interfaces:**
- Consumes: Task 1's types and helpers; `toCsv`, `downloadCsv` and `reportFilename` from `src/lib/report.ts`; the `Workbook` type from `src/lib/general/sheet.ts`; `workbookToXlsx`, `htmlToDocx` and `downloadBlob` from `src/lib/general/office.ts` (loaded lazily).
- Produces:
  - `sheetName(title: string, used: Set<string>): string`
  - `docToWorkbook(doc: ReportDoc): Workbook`
  - `docToHtml(doc: ReportDoc): string`
  - `docCsvFiles(doc: ReportDoc, base: string): { name: string; label: string; csv: string }[]`
  - `reportBase(kind: string, subject: string): string`
  - `exportXlsx(doc: ReportDoc, base: string): Promise<void>`
  - `exportDocx(doc: ReportDoc, base: string): Promise<void>`
  - `exportCsv(file: { name: string; csv: string }): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { docCsvFiles, docToHtml, docToWorkbook, reportBase, sheetName } from './export'
import type { ReportDoc } from './doc'

const doc: ReportDoc = {
  header: { title: 'Individual grading sheet', subtitle: 'Lab 6', classLine: 'QM · BSIT 3A', rangeLabel: null, madeAt: 'October 13, 2026' },
  blocks: [
    { kind: 'kpis', items: [{ label: 'Students', value: 3 }, { label: 'Average final', value: 84.5 }] },
    {
      kind: 'table', id: 'grades', title: 'Grades',
      columns: [
        { key: 's', label: 'Student', type: 'text' },
        { key: 'f', label: 'Final', type: 'score', outOf: 100 },
        { key: 'st', label: 'Status', type: 'status' },
      ],
      rows: [
        ['=SUM(A1)', 84.5, { value: 'Not released', tone: 'warning' }],
        ['Ana Cruz', null, { value: 'Not confirmed', tone: 'pending' }],
      ],
    },
    { kind: 'chart', id: 'spread', title: 'Spread', chart: { kind: 'bars', rows: [{ label: '80–89%', value: 1 }], max: 1 }, summary: 'Most finals fall in 80–89%.' },
    { kind: 'table', id: 'rubric', title: 'Grades', columns: [{ key: 'c', label: 'Criterion', type: 'text' }], rows: [['Function']] },
  ],
  footer: { lines: ['Scores tagged Not released are not yet visible to students.'], signatures: [{ role: 'Prepared by', name: 'Prof. Reyes' }] },
}

describe('sheetName', () => {
  it('keeps names unique and within 31 characters', () => {
    const used = new Set<string>()
    const a = sheetName('A very long table title that goes past thirty-one', used)
    const b = sheetName('A very long table title that goes past thirty-one', used)
    expect(a.length).toBeLessThanOrEqual(31)
    expect(b.length).toBeLessThanOrEqual(31)
    expect(a).not.toBe(b)
    expect(b.endsWith('(2)')).toBe(true)
  })
  it('drops characters Excel refuses', () => {
    expect(sheetName('Grades: [Lab 6]/final?', new Set())).not.toMatch(/[[\]:*?/\\]/)
  })
})

describe('docToWorkbook', () => {
  const wb = docToWorkbook(doc)
  it('has a cover sheet and one sheet per table, uniquely named', () => {
    expect(wb.sheets).toHaveLength(3)
    expect(wb.sheets[0].name).toBe('Report')
    expect(new Set(wb.sheets.map((s) => s.name)).size).toBe(3)
  })
  it('writes headers, numbers as numeric text, and never a formula', () => {
    const grades = wb.sheets[1]
    expect(grades.rows[0]).toEqual(['Student', 'Final (of 100)', 'Status'])
    expect(grades.rows[1][1]).toBe('84.5')
    expect(grades.rows[1][0].startsWith('=')).toBe(false)
    expect(grades.rows[2][1]).toBe('')
  })
  it('puts the header, KPIs and footer on the cover', () => {
    const flat = wb.sheets[0].rows.flat()
    expect(flat).toContain('Individual grading sheet')
    expect(flat).toContain('Average final')
    expect(flat).toContain('84.5')
    expect(flat).toContain('Scores tagged Not released are not yet visible to students.')
  })
})

describe('docToHtml', () => {
  const html = docToHtml(doc)
  it('has one table per table block, plus one for the key figures', () => {
    expect(html.match(/<table>/g)).toHaveLength(3)
  })
  it('replaces the chart with its summary sentence', () => {
    expect(html).toContain('Most finals fall in 80–89%.')
    expect(html).not.toContain('<svg')
  })
  it('escapes text', () => {
    expect(docToHtml({ ...doc, header: { ...doc.header, subtitle: '<b>x</b>' } })).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('docCsvFiles', () => {
  it('writes one file per table, named after it', () => {
    const files = docCsvFiles(doc, 'grading-lab-6-2026-10-13')
    expect(files.map((f) => f.name)).toEqual(['grading-lab-6-2026-10-13-grades.csv', 'grading-lab-6-2026-10-13-grades-2.csv'])
    expect(files[0].csv).toContain('Final (of 100)')
  })
})

describe('reportBase', () => {
  it('drops the csv extension from the shared filename helper', () => {
    expect(reportBase('grading', 'Lab 6')).toMatch(/^grading-lab-6-\d{4}-\d{2}-\d{2}$/)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/export.test.ts`
Expected: FAIL (`Failed to resolve import "./export"`).

- [ ] **Step 3: Write `src/lib/reports/export.ts`**

```ts
import { downloadCsv, reportFilename, toCsv } from '../report'
import type { Workbook } from '../general/sheet'
import { cellExport, cellText, columnHeader, tableBlocks } from './doc'
import type { Block, ReportDoc } from './doc'

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique ignoring case. */
export function sheetName(title: string, used: Set<string>): string {
  const base = (title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet').slice(0, 31)
  let name = base
  let n = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`
    name = base.slice(0, 31 - suffix.length).trimEnd() + suffix
  }
  used.add(name.toLowerCase())
  return name
}

/** A grid cell. The writer turns numeric text into a number, and "=…" into a formula — so text never starts with "=". */
function gridText(v: string | number | null): string {
  if (v === null) return ''
  if (typeof v === 'number') return String(v)
  return v.startsWith('=') ? ` ${v}` : v
}

const kpiText = (v: number | string) => (typeof v === 'number' ? String(v) : gridText(v))

export function docToWorkbook(doc: ReportDoc): Workbook {
  const used = new Set<string>()
  const h = doc.header
  const cover: string[][] = [
    [h.title],
    [h.subtitle],
    [h.classLine],
    ...(h.rangeLabel ? [[h.rangeLabel]] : []),
    [`Made ${h.madeAt}`],
    ...(h.confidential ? [[h.confidential]] : []),
    [''],
  ]
  for (const b of doc.blocks) {
    if (b.kind === 'kpis') for (const k of b.items) cover.push([k.label, kpiText(k.value), k.unit ?? ''])
  }
  if (doc.footer.lines.length) cover.push([''], ...doc.footer.lines.map((l) => [l]))

  const sheets = [{ name: sheetName('Report', used), rows: cover }]
  for (const t of tableBlocks(doc)) {
    sheets.push({
      name: sheetName(t.title, used),
      rows: [
        t.columns.map(columnHeader),
        ...t.rows.map((row) => t.columns.map((col, i) => gridText(cellExport(row[i] ?? null, col)))),
      ],
      freeze: { rows: 1, cols: 0 },
    } as Workbook['sheets'][number])
  }
  return { sheets }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function blockHtml(b: Block): string {
  switch (b.kind) {
    case 'kpis':
      return `<table><tbody>${b.items
        .map((k) => `<tr><td>${esc(k.label)}</td><td>${esc(String(k.value))}${k.unit ? ` ${esc(k.unit)}` : ''}</td></tr>`)
        .join('')}</tbody></table>`
    case 'heading':
      return `<h${b.level}>${esc(b.text)}</h${b.level}>`
    case 'paragraph':
      return `<p>${esc(b.text)}</p>`
    case 'note':
      return `<p><em>${esc(b.text)}</em></p>`
    case 'chart':
      return `<h3>${esc(b.title)}</h3><p>${esc(b.summary)}</p>`
    case 'table': {
      const head = b.columns.map((c) => `<th>${esc(columnHeader(c))}</th>`).join('')
      const body = b.rows
        .map(
          (row) =>
            `<tr>${b.columns
              .map((c, i) => {
                const cell = row[i] ?? null
                const tag = cell !== null && typeof cell === 'object' && cell.tag ? ` (${cell.tag})` : ''
                return `<td>${esc(cellText(cell, c) + tag)}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')
      return `<h3>${esc(b.title)}</h3><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${
        b.note ? `<p>${esc(b.note)}</p>` : ''
      }`
    }
  }
}

/** Word-ready HTML. Charts become their summary sentence; every row is included. */
export function docToHtml(doc: ReportDoc): string {
  const h = doc.header
  const head = [
    `<h1>${esc(h.title)}</h1>`,
    `<p>${esc(h.subtitle)}</p>`,
    `<p>${esc(h.classLine)}${h.rangeLabel ? ` · ${esc(h.rangeLabel)}` : ''}</p>`,
    `<p>Made ${esc(h.madeAt)}</p>`,
    h.confidential ? `<p><strong>${esc(h.confidential)}</strong></p>` : '',
  ].join('')
  const foot = [
    ...doc.footer.lines.map((l) => `<p>${esc(l)}</p>`),
    ...doc.footer.signatures.map((s) => `<p>${esc(s.role)}: ${s.name ? esc(s.name) : '____________________'}</p>`),
  ].join('')
  return head + doc.blocks.map(blockHtml).join('') + foot
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'table'

/** One CSV per table. Duplicate table titles get -2, -3. */
export function docCsvFiles(doc: ReportDoc, base: string) {
  const seen = new Map<string, number>()
  return tableBlocks(doc).map((t) => {
    const s = slug(t.title)
    const n = (seen.get(s) ?? 0) + 1
    seen.set(s, n)
    return {
      name: `${base}-${n === 1 ? s : `${s}-${n}`}.csv`,
      label: t.title,
      csv: toCsv(
        t.columns.map(columnHeader),
        t.rows.map((row) => t.columns.map((col, i) => cellExport(row[i] ?? null, col))),
      ),
    }
  })
}

export function reportBase(kind: string, subject: string) {
  return reportFilename(kind, subject).replace(/\.csv$/, '')
}

export async function exportXlsx(doc: ReportDoc, base: string) {
  const { workbookToXlsx, downloadBlob } = await import('../general/office')
  downloadBlob(await workbookToXlsx(docToWorkbook(doc)), `${base}.xlsx`)
}

export async function exportDocx(doc: ReportDoc, base: string) {
  const { htmlToDocx, downloadBlob } = await import('../general/office')
  downloadBlob(await htmlToDocx(docToHtml(doc), doc.header.title), `${base}.docx`)
}

export function exportCsv(file: { name: string; csv: string }) {
  downloadCsv(file.name, file.csv)
}
```

If `Workbook['sheets'][number]` does not accept `freeze` (it should, because `Sheet` is `{ name, rows } & SheetFormat`), remove the cast and type the object as `Sheet` imported from `src/lib/general/sheet.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reports/export.test.ts`, then `npx eslint src/lib/reports`.
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/export.ts src/lib/reports/export.test.ts
git commit -m "Export a report document to Excel, Word and CSV"
```

---

### Task 3: Drawing a document

**Files:**
- Create: `src/components/charts/Bars.tsx`
- Create: `src/components/reports/ReportDocView.tsx`

**Interfaces:**
- Consumes: Task 1's types, `cellText`, `cellValue`; `Sheet` (`src/components/reports/Sheet.tsx`, which has the `footerNote` prop); `TONE_CELL`; `formatPoints`.
- Produces:
  - `Bars({ rows, max, unit, title })`
  - `ReportDocView({ doc })`

- [ ] **Step 1: Write `src/components/charts/Bars.tsx`**

```tsx
import { formatPoints } from '../../lib/scoreMath'

/** Labelled horizontal bars: one category per line, scaled to `max`. */
export function Bars({
  rows,
  max,
  unit = '',
  title,
}: {
  rows: { label: string; value: number }[]
  max: number
  unit?: string
  title: string
}) {
  const summary = rows.map((r) => `${r.label} ${formatPoints(r.value)}${unit}`).join(', ')
  return (
    <div role="img" aria-label={`${title}: ${summary}`} className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-[12px]"
        >
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full surface-sunken">
            <span
              className="block h-full rounded-full bg-progress"
              style={{ width: `${max > 0 ? Math.min(100, (r.value / max) * 100) : 0}%` }}
            />
          </span>
          <span className="text-right font-mono tabular-nums text-ink">
            {formatPoints(r.value)}
            {unit}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write `src/components/reports/ReportDocView.tsx`**

```tsx
import { Bars } from '../charts/Bars'
import { TONE_CELL } from '../charts/format'
import { cellText, cellValue } from '../../lib/reports/doc'
import type { Block, Cell, Column, ReportDoc } from '../../lib/reports/doc'
import { Sheet } from './Sheet'

const RIGHT: Column['type'][] = ['number', 'percent', 'score']

function CellView({ cell, col }: { cell: Cell; col: Column }) {
  const text = cellText(cell, col)
  const rich = cell !== null && typeof cell === 'object' ? cell : null
  if (col.type === 'status' && cellValue(cell) !== null) {
    return (
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[rich?.tone ?? 'pending']}`}>{text}</span>
    )
  }
  return (
    <>
      {text}
      {rich?.tag && (
        <span className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[rich.tone ?? 'pending']}`}>
          {rich.tag}
        </span>
      )}
    </>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'kpis':
      return (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
          {block.items.map((k) => (
            <div key={k.label} className="rounded-xl border border-line px-3 py-2 print:break-inside-avoid">
              <dt className="text-[12px] text-muted">{k.label}</dt>
              <dd className="font-mono text-[18px] tabular-nums text-ink">
                {k.value}
                {k.unit && <span className="ml-1 text-[12px] text-faint">{k.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )
    case 'heading':
      return block.level === 2 ? <h3 className="text-ink">{block.text}</h3> : <h4 className="text-ink">{block.text}</h4>
    case 'paragraph':
      return <p className="text-[13px] leading-relaxed text-muted">{block.text}</p>
    case 'note':
      return (
        <p
          className={`rounded-lg px-3 py-2 text-[13px] ${
            block.tone === 'warning' ? TONE_CELL.warning : 'surface-sunken text-muted'
          }`}
        >
          {block.text}
        </p>
      )
    case 'chart':
      return (
        <figure className="space-y-2 print:break-inside-avoid">
          <figcaption className="text-[13px] font-medium text-ink">{block.title}</figcaption>
          <Bars rows={block.chart.rows} max={block.chart.max} unit={block.chart.unit} title={block.title} />
          <p className="sr-only">{block.summary}</p>
        </figure>
      )
    case 'table': {
      const shown = block.cap ? block.rows.slice(0, block.cap) : block.rows
      return (
        <section className="space-y-2">
          <h4 className="text-ink">{block.title}</h4>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[520px] text-[12px] print:min-w-0">
              <thead>
                <tr className="border-b border-line-strong text-left text-faint">
                  {block.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`px-2 py-1.5 font-medium ${RIGHT.includes(c.type) ? 'text-right' : ''}`}
                    >
                      {c.label}
                      {c.type === 'score' && c.outOf ? <span className="font-mono"> /{c.outOf}</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, r) => (
                  <tr key={r} className="border-b border-line last:border-0 print:break-inside-avoid">
                    {block.columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-2 py-1.5 align-top ${
                          RIGHT.includes(c.type) ? 'text-right font-mono tabular-nums text-ink' : 'text-ink'
                        }`}
                      >
                        <CellView cell={row[i] ?? null} col={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.cap && block.rows.length > block.cap && (
            <p className="text-[12px] text-faint">
              Showing {block.cap} of {block.rows.length}. Excel and CSV include every row.
            </p>
          )}
          {block.note && <p className="text-[12px] text-faint">{block.note}</p>}
        </section>
      )
    }
  }
}

/** A report document on the A4 sheet: letterhead, blocks, footer and signatures. */
export function ReportDocView({ doc }: { doc: ReportDoc }) {
  const h = doc.header
  return (
    <Sheet
      title={h.title}
      subject={h.subtitle}
      meta={[h.classLine, h.rangeLabel ?? '']}
      footerNote={
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[62ch] space-y-1 text-[12px] leading-relaxed text-faint">
            {doc.footer.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-8">
            {doc.footer.signatures.map((s) => (
              <div key={s.role} className="min-w-[200px] text-center">
                <p className="h-6 text-[13px] text-ink">{s.name ?? ''}</p>
                <p className="border-t border-line-strong pt-1 text-[11px] text-faint">{s.role}</p>
              </div>
            ))}
          </div>
        </div>
      }
    >
      {h.confidential && (
        <p className={`rounded-lg px-3 py-2 text-[12px] font-medium ${TONE_CELL.warning}`}>{h.confidential}</p>
      )}
      {doc.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </Sheet>
  )
}
```

Before writing, check `Sheet`'s `meta` prop. It filters out empty strings (`meta.filter(Boolean)`), so the empty range string is dropped.

- [ ] **Step 3: Build and lint**

Run: `npm run build`, then `npx eslint src`.
Expected: clean. There is no unit test here. Task 6's browser check covers the renderer, and the pure parts it uses are tested in Tasks 1–2.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/Bars.tsx src/components/reports/ReportDocView.tsx
git commit -m "Draw a report document on the printable sheet"
```

---

### Task 4: The Individual grading sheet

**Files:**
- Create: `src/lib/reports/grading.ts`
- Create: `src/lib/reports/grading.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's types;
  - `ScoreSheetRow`, `BoardScore`, `ProjectCriterion` and `PeerResult` from `src/lib/types.ts`;
  - `StudentWork` from `src/lib/report.ts`;
  - `analyseTeam` and `peerFlagLabel` from `src/lib/peerMath.ts`;
  - `PEER_DIMENSIONS` from `src/lib/peerDimensions.ts`;
  - `formatPoints` from `src/lib/scoreMath.ts`.
- Produces:
  - `scoreBand(final: number, total: number): number` (0–9)
  - `type GradingProject = { id: string; title: string; total_points: number }`
  - `type ReportHead = { classLine: string; professor: string; madeAt: string }`
  - `gradingClassDoc(input: ReportHead & { project: GradingProject; sheet: ScoreSheetRow[]; criteria: ProjectCriterion[]; boardScores: BoardScore[]; boardNames: Map<string, string>; work: StudentWork[]; peer: PeerResult[] }): ReportDoc`
  - `gradingGridDoc(input: ReportHead & { students: { id: string; name: string }[]; projects: { project: GradingProject; sheet: ScoreSheetRow[] }[] }): ReportDoc`
  - `gradingStudentDoc(input: ReportHead & { student: { id: string; name: string }; projects: { project: GradingProject; row: ScoreSheetRow | null; criteria: ProjectCriterion[]; boardScores: BoardScore[]; peer: PeerResult[] }[] }): ReportDoc`

  `peer` is always the project's **closed final-round** rows. It is empty when there is no such round.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/grading.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gradingClassDoc, gradingGridDoc, gradingStudentDoc, scoreBand } from './grading'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { PeerResult, ScoreSheetRow } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 13, 2026' }
const project = { id: 'p1', title: 'Lab 6', total_points: 100 }

const row = (over: Partial<ScoreSheetRow>): ScoreSheetRow => ({
  board_id: 'b1', student_id: 's1', student_name: 'Ana Cruz', in_group: true,
  group_total: 80, scored: 2, criteria: 2, total_points: 100, factor: null, raters: 0,
  suggested_now: 80, suggested_saved: 80, final: 80, overridden: false, factor_saved: null,
  confirmed_at: '2026-10-13T00:00:00Z', suggestion_changed: false, released: false, ...over,
})

const criteria = [
  { id: 'c1', project_id: 'p1', position: 1, label: 'Function', description: 'It works', max_points: 60 },
  { id: 'c2', project_id: 'p1', position: 2, label: 'Docs', description: 'It is explained', max_points: 40 },
]
const boardScores = [
  { board_id: 'b1', criterion_id: 'c1', points: 50, scored_at: '' },
  { board_id: 'b1', criterion_id: 'c2', points: 30, scored_at: '' },
]
const peer = (sid: string, avg: number): PeerResult => ({
  round_id: 'r1', project_id: 'p1', class_id: 'c', kind: 'final', opens_at: '2026-10-01T00:00:00Z', is_open: false,
  board_id: 'b1', group_name: 'Group 1', student_id: sid, student_name: sid, received_avg: avg, raters: 2,
  received_spread: 0, self_avg: avg, given_avg: avg, contributes_avg: avg, interacts_avg: avg, on_track_avg: avg,
  quality_avg: avg, skills_avg: avg, team_size: 3, rated_all: true,
})

const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('scoreBand', () => {
  it('puts the total in the top band and zero in the bottom', () => {
    expect(scoreBand(100, 100)).toBe(9)
    expect(scoreBand(0, 100)).toBe(0)
    expect(scoreBand(89.5, 100)).toBe(8)
    expect(scoreBand(90, 100)).toBe(9)
  })
})

describe('gradingClassDoc', () => {
  const sheet = [
    row({ student_id: 's1', student_name: 'Ana Cruz', final: 84, suggested_now: 84, factor: 1.05, released: true }),
    row({ student_id: 's2', student_name: 'Ben Diaz', final: 70, suggested_now: 76, overridden: true }),
    row({ student_id: 's3', student_name: 'Cy Ramos', final: null, confirmed_at: null, overridden: null }),
  ]
  const doc = gradingClassDoc({
    ...head, project, sheet, criteria, boardScores,
    boardNames: new Map([['b1', 'Group 1']]),
    work: [{
      class_id: 'c', project_id: 'p1', project_title: 'Lab 6', board_id: 'b1', group_name: 'Group 1',
      board_student_name: null, submitted_at: null, result_verdict: null, project_due_at: null,
      student_id: 's1', student_name: 'Ana Cruz', avatar_url: null, tasks_held: 4, tasks_done: 3, tasks_late: 1,
      held_pct: 40, personal_pct: 75, first_activity: null, last_finish: null,
    }],
    peer: [peer('s1', 4), peer('s2', 2), peer('s3', 3)],
  })
  const grades = tableBlocks(doc).find((t) => t.id === 'grades')!

  it('has one row per student with criteria, statuses and contribution', () => {
    expect(grades.rows).toHaveLength(3)
    const ana = grades.rows.find((r) => r[0] === 'Ana Cruz')!
    const cols = grades.columns.map((c) => c.key)
    expect(ana[cols.indexOf('group')]).toBe('Group 1')
    expect(ana[cols.indexOf('crit-c1')]).toBe(50)
    expect(ana[cols.indexOf('final')]).toBe(84)
    expect(ana[cols.indexOf('status')]).toEqual({ value: 'Released', tone: 'success' })
    expect(ana[cols.indexOf('share')]).toBe(40)
    expect(ana[cols.indexOf('tasks')]).toBe('3 of 4')
  })
  it('tags overrides and says which scores students cannot see yet', () => {
    const ben = grades.rows.find((r) => r[0] === 'Ben Diaz')!
    const cols = grades.columns.map((c) => c.key)
    expect(ben[cols.indexOf('final')]).toEqual({ value: 70, tag: 'Overridden', tone: 'pending' })
    expect(ben[cols.indexOf('status')]).toEqual({ value: 'Not released', tone: 'warning' })
    const cy = grades.rows.find((r) => r[0] === 'Cy Ramos')!
    expect(cy[cols.indexOf('status')]).toEqual({ value: 'Not confirmed', tone: 'pending' })
  })
  it('counts and averages only confirmed finals', () => {
    expect(kpi(doc, 'Students')).toBe(3)
    expect(kpi(doc, 'Confirmed')).toBe(2)
    expect(kpi(doc, 'Released')).toBe(1)
    expect(kpi(doc, 'Average final')).toBe('77')
    expect(kpi(doc, 'Median final')).toBe('77')
    expect(kpi(doc, 'Overridden')).toBe(1)
  })
  it('includes the rubric key and the footer line', () => {
    expect(tableBlocks(doc).find((t) => t.id === 'rubric')!.rows).toHaveLength(2)
    expect(doc.footer.lines).toContain('Scores tagged Not released are not yet visible to students.')
    expect(doc.footer.signatures[0]).toEqual({ role: 'Prepared by', name: 'Prof. Reyes' })
  })
  it('says so, with no chart, when nothing is confirmed', () => {
    const empty = gradingClassDoc({
      ...head, project, criteria, boardScores, boardNames: new Map(), work: [], peer: [],
      sheet: [row({ final: null, confirmed_at: null })],
    })
    expect(kpi(empty, 'Average final')).toBe('—')
    expect(kpi(empty, 'Median final')).toBe('—')
    expect(empty.blocks.some((b) => b.kind === 'chart')).toBe(false)
    expect(empty.blocks.some((b) => b.kind === 'note' && b.text.includes('No score is confirmed yet'))).toBe(true)
  })
})

describe('gradingGridDoc', () => {
  const doc = gradingGridDoc({
    ...head,
    students: [{ id: 's2', name: 'Ben Diaz' }, { id: 's1', name: 'Ana Cruz' }],
    projects: [
      { project, sheet: [row({ student_id: 's1', final: 84, released: true }), row({ student_id: 's2', final: 70, released: true })] },
      { project: { id: 'p2', title: 'Lab 7', total_points: 50 }, sheet: [row({ student_id: 's1', final: 40, total_points: 50 })] },
    ],
  })
  const grid = tableBlocks(doc)[0]

  it('marks a project that is not released on its column', () => {
    expect(grid.columns.map((c) => c.label)).toEqual(['Student', 'Lab 6', 'Lab 7 (not released)', 'Overall'])
  })
  it('gives each student their finals and an overall percent over the projects they have', () => {
    expect(grid.rows[0]).toEqual(['Ana Cruz', 84, 40, (124 / 150) * 100])
    expect(grid.rows[1]).toEqual(['Ben Diaz', 70, null, 70])
  })
})

describe('gradingStudentDoc', () => {
  it('lists each project with the adjustment, then its breakdown and peer view', () => {
    const doc = gradingStudentDoc({
      ...head,
      student: { id: 's1', name: 'Ana Cruz' },
      projects: [{ project, row: row({ final: 84, factor_saved: 1.05 }), criteria, boardScores, peer: [peer('s1', 4), peer('s2', 3)] }],
    })
    const projects = tableBlocks(doc).find((t) => t.id === 'projects')!
    const cols = projects.columns.map((c) => c.key)
    expect(projects.rows[0][cols.indexOf('adjust')]).toBe(4)
    expect(tableBlocks(doc).some((t) => t.id === 'rubric-p1')).toBe(true)
    const seen = tableBlocks(doc).find((t) => t.id === 'peer-p1')!
    expect(seen.rows[0]).toEqual([expect.any(String), 4, 3.5])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/grading.test.ts`
Expected: FAIL (`Failed to resolve import "./grading"`).

- [ ] **Step 3: Write `src/lib/reports/grading.ts`**

```ts
import { analyseTeam, peerFlagLabel } from '../peerMath'
import { PEER_DIMENSIONS } from '../peerDimensions'
import type { StudentWork } from '../report'
import { formatPoints } from '../scoreMath'
import type { BoardScore, PeerResult, ProjectCriterion, ScoreSheetRow } from '../types'
import type { Block, Cell, Column, ReportDoc } from './doc'

export type GradingProject = { id: string; title: string; total_points: number }
export type ReportHead = { classLine: string; professor: string; madeAt: string }

const NOT_RELEASED_LINE = 'Scores tagged Not released are not yet visible to students.'

/** Which tenth of the total a score falls in, 0–9. The total itself is in the top band. */
export function scoreBand(final: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(9, Math.floor((final / total) * 10)))
}

function status(r: ScoreSheetRow): Cell {
  if (!r.confirmed_at || r.final === null) return { value: 'Not confirmed', tone: 'pending' }
  return r.released ? { value: 'Released', tone: 'success' } : { value: 'Not released', tone: 'warning' }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const shown = (v: number | null) => (v === null ? '—' : formatPoints(Math.round(v * 10) / 10))

const footer = (professor: string, withLine: boolean) => ({
  lines: withLine ? [NOT_RELEASED_LINE] : [],
  signatures: [{ role: 'Prepared by', name: professor }],
})

/** One project, every student on it. */
export function gradingClassDoc(input: ReportHead & {
  project: GradingProject
  sheet: ScoreSheetRow[]
  criteria: ProjectCriterion[]
  boardScores: BoardScore[]
  boardNames: Map<string, string>
  work: StudentWork[]
  peer: PeerResult[]
}): ReportDoc {
  const { project, sheet, criteria, boardScores, boardNames, work, peer } = input
  const total = project.total_points
  const points = new Map(boardScores.map((s) => [`${s.board_id}:${s.criterion_id}`, Number(s.points)]))
  const flagsOf = new Map<string, string>()
  for (const board of new Set(peer.map((p) => p.board_id))) {
    for (const m of analyseTeam(peer.filter((p) => p.board_id === board))) {
      flagsOf.set(`${board}:${m.student_id}`, m.flags.map((f) => peerFlagLabel(f, m.is_open).label).join('; '))
    }
  }
  const workOf = new Map(work.map((w) => [`${w.board_id}:${w.student_id}`, w]))

  const columns: Column[] = [
    { key: 'student', label: 'Student', type: 'text' },
    { key: 'group', label: 'Group', type: 'text' },
    ...criteria.map<Column>((c) => ({ key: `crit-${c.id}`, label: c.label, type: 'score', outOf: c.max_points })),
    { key: 'groupTotal', label: 'Group total', type: 'score', outOf: total },
    { key: 'factor', label: 'Peer factor', type: 'number' },
    { key: 'flags', label: 'Peer flags', type: 'text' },
    { key: 'suggested', label: 'Suggested', type: 'score', outOf: total },
    { key: 'final', label: 'Final', type: 'score', outOf: total },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'share', label: 'Share of group work', type: 'percent' },
    { key: 'tasks', label: 'Tasks finished', type: 'text' },
    { key: 'late', label: 'Late tasks', type: 'number' },
  ]

  const sorted = [...sheet].sort(
    (a, b) =>
      (boardNames.get(a.board_id) ?? '').localeCompare(boardNames.get(b.board_id) ?? '') ||
      a.student_name.localeCompare(b.student_name),
  )
  const rows: Cell[][] = sorted.map((r) => {
    const w = workOf.get(`${r.board_id}:${r.student_id}`)
    const final: Cell =
      r.final === null || !r.confirmed_at
        ? null
        : r.overridden
          ? { value: Number(r.final), tag: 'Overridden', tone: 'pending' }
          : Number(r.final)
    return [
      r.student_name,
      boardNames.get(r.board_id) ?? (r.in_group ? 'Group' : 'Individual'),
      ...criteria.map((c) => points.get(`${r.board_id}:${c.id}`) ?? null),
      r.group_total === null ? null : Number(r.group_total),
      r.factor === null ? null : Number(r.factor),
      flagsOf.get(`${r.board_id}:${r.student_id}`) || null,
      r.suggested_now === null ? null : Number(r.suggested_now),
      final,
      status(r),
      w ? Number(w.held_pct) : null,
      w ? `${w.tasks_done} of ${w.tasks_held}` : null,
      w ? w.tasks_late : null,
    ]
  })

  const confirmed = sheet.filter((r) => r.confirmed_at && r.final !== null)
  const finals = confirmed.map((r) => Number(r.final))
  const average = finals.length ? finals.reduce((s, x) => s + x, 0) / finals.length : null
  const scored = sheet.filter((r) => r.criteria > 0 && r.scored >= r.criteria).length

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Students', value: sheet.length },
        { label: 'Scored', value: scored },
        { label: 'Confirmed', value: confirmed.length },
        { label: 'Released', value: confirmed.filter((r) => r.released).length },
        { label: 'Average final', value: shown(average) },
        { label: 'Median final', value: shown(median(finals)) },
        { label: 'Overridden', value: confirmed.filter((r) => r.overridden).length },
      ],
    },
  ]
  if (sheet.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nobody is on this project yet, so there is nothing to grade.' })
  } else {
    blocks.push({ kind: 'table', id: 'grades', title: 'Grades', columns, rows })
    if (finals.length === 0) {
      blocks.push({
        kind: 'note',
        tone: 'info',
        text: 'No score is confirmed yet. Confirm scores on the project’s Work tab to see the spread.',
      })
    } else {
      const counts = Array.from({ length: 10 }, () => 0)
      for (const f of finals) counts[scoreBand(f, total)] += 1
      const bands = counts.map((n, i) => ({ label: i === 9 ? '90–100%' : `${i * 10}–${i * 10 + 9}%`, value: n }))
      const top = bands.reduce((a, b) => (b.value > a.value ? b : a))
      blocks.push({
        kind: 'chart',
        id: 'spread',
        title: 'Spread of final scores',
        chart: { kind: 'bars', rows: bands, max: Math.max(...counts), unit: '' },
        summary: `${finals.length} confirmed ${finals.length === 1 ? 'score' : 'scores'}; most fall in ${top.label} (${top.value}).`,
      })
    }
  }
  blocks.push({
    kind: 'table',
    id: 'rubric',
    title: 'Rubric',
    columns: [
      { key: 'criterion', label: 'Criterion', type: 'text' },
      { key: 'description', label: 'What earns full marks', type: 'text' },
      { key: 'points', label: 'Points', type: 'number' },
    ],
    rows: criteria.map((c) => [c.label, c.description || null, c.max_points]),
  })

  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: project.title,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: footer(input.professor, true),
  }
}

/** Every student against every project: the grade-book grid. */
export function gradingGridDoc(input: ReportHead & {
  students: { id: string; name: string }[]
  projects: { project: GradingProject; sheet: ScoreSheetRow[] }[]
}): ReportDoc {
  const columns: Column[] = [
    { key: 'student', label: 'Student', type: 'text' },
    ...input.projects.map<Column>(({ project, sheet }) => ({
      key: `p-${project.id}`,
      label: sheet.some((r) => r.released) ? project.title : `${project.title} (not released)`,
      type: 'score',
      outOf: project.total_points,
    })),
    { key: 'overall', label: 'Overall', type: 'percent' },
  ]
  const finalOf = (sheet: ScoreSheetRow[], sid: string) => {
    const r = sheet.find((x) => x.student_id === sid && x.confirmed_at && x.final !== null)
    return r ? Number(r.final) : null
  }
  const rows: Cell[][] = [...input.students]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const cells = input.projects.map(({ sheet }) => finalOf(sheet, s.id))
      let got = 0
      let of = 0
      input.projects.forEach(({ project }, i) => {
        if (cells[i] !== null) {
          got += cells[i] as number
          of += project.total_points
        }
      })
      return [s.name, ...cells, of > 0 ? (got / of) * 100 : null]
    })
  const released = input.projects.filter(({ sheet }) => sheet.some((r) => r.released)).length
  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: 'All projects',
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks: [
      {
        kind: 'kpis',
        items: [
          { label: 'Students', value: input.students.length },
          { label: 'Projects', value: input.projects.length },
          { label: 'Released', value: released },
        ],
      },
      {
        kind: 'table',
        id: 'gradebook',
        title: 'Grade book',
        columns,
        rows,
        note: 'A blank cell has no confirmed score. Overall is the student’s finals over the totals of the projects they have a score on.',
      },
    ],
    footer: footer(input.professor, released < input.projects.length),
  }
}

/** One student across every project of the class. */
export function gradingStudentDoc(input: ReportHead & {
  student: { id: string; name: string }
  projects: {
    project: GradingProject
    row: ScoreSheetRow | null
    criteria: ProjectCriterion[]
    boardScores: BoardScore[]
    peer: PeerResult[]
  }[]
}): ReportDoc {
  const blocks: Block[] = [
    {
      kind: 'table',
      id: 'projects',
      title: 'Projects',
      columns: [
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'final', label: 'Final', type: 'number' },
        { key: 'groupTotal', label: 'Group total', type: 'number' },
        { key: 'adjust', label: 'Adjustment', type: 'number' },
        { key: 'factor', label: 'Peer factor', type: 'number' },
        { key: 'status', label: 'Status', type: 'status' },
      ],
      rows: input.projects.map(({ project, row }) => {
        const final = row && row.confirmed_at && row.final !== null ? Number(row.final) : null
        const group = row?.group_total === null || row?.group_total === undefined ? null : Number(row.group_total)
        return [
          `${project.title} (of ${project.total_points})`,
          final,
          group,
          final !== null && group !== null && row?.in_group ? Math.round((final - Math.min(group, project.total_points)) * 2) / 2 : null,
          row?.factor_saved === null || row?.factor_saved === undefined ? null : Number(row.factor_saved),
          row ? status(row) : { value: 'Not on this project', tone: 'pending' },
        ]
      }),
    },
  ]

  for (const { project, row, criteria, boardScores, peer } of input.projects) {
    if (!row) continue
    blocks.push({ kind: 'heading', text: project.title, level: 3 })
    const points = new Map(boardScores.filter((s) => s.board_id === row.board_id).map((s) => [s.criterion_id, Number(s.points)]))
    blocks.push({
      kind: 'table',
      id: `rubric-${project.id}`,
      title: `${project.title}: rubric`,
      columns: [
        { key: 'criterion', label: 'Criterion', type: 'text' },
        { key: 'points', label: 'Points', type: 'number' },
        { key: 'max', label: 'Out of', type: 'number' },
      ],
      rows: criteria.map((c) => [c.label, points.get(c.id) ?? null, c.max_points]),
    })
    const mine = peer.find((p) => p.student_id === input.student.id && p.board_id === row.board_id)
    if (mine && mine.raters >= 2) {
      const team = peer.filter((p) => p.board_id === row.board_id)
      const avg = (key: string) => {
        const xs = team.map((p) => (p as unknown as Record<string, number | null>)[key]).filter((v): v is number => v !== null)
        return xs.length ? Math.round((xs.reduce((s, x) => s + Number(x), 0) / xs.length) * 100) / 100 : null
      }
      blocks.push({
        kind: 'table',
        id: `peer-${project.id}`,
        title: `${project.title}: how teammates saw ${input.student.name}`,
        columns: [
          { key: 'dimension', label: 'Behaviour', type: 'text' },
          { key: 'mine', label: input.student.name, type: 'number' },
          { key: 'team', label: 'Team', type: 'number' },
        ],
        rows: PEER_DIMENSIONS.map((d) => {
          const v = (mine as unknown as Record<string, number | null>)[`${d.key}_avg`]
          return [d.label, v === null ? null : Number(v), avg(`${d.key}_avg`)]
        }),
      })
    }
  }

  return {
    header: {
      title: 'Individual grading sheet',
      subtitle: input.student.name,
      classLine: input.classLine,
      rangeLabel: null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: footer(input.professor, input.projects.some(({ row }) => row && !row.released)),
  }
}
```

Two checks against the tests:
- **Rows** follow the column order. Each class-sheet row has exactly `columns.length` cells (2 + criteria + 10).
- **The student-doc peer table** sets `team` to the mean of the team's `*_avg` for that dimension. In the test that is `(4 + 3) / 2 = 3.5`, and `mine` is 4.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reports/grading.test.ts`, then `npx eslint src/lib/reports`.
Expected: PASS and clean. If a hand value fails, work out by hand which side is wrong. Do not change an expected value to match the output; report it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/grading.ts src/lib/reports/grading.test.ts
git commit -m "Build the grading sheet for a project, the grade book and one student"
```

---

### Task 5: The Peer evaluation summary

**Files:**
- Create: `src/lib/reports/peerSummary.ts`
- Create: `src/lib/reports/peerSummary.test.ts`

**Interfaces:**
- Consumes: Task 1's types; `PeerResult`, `PeerRoundStatus` and `PeerComment` (`src/lib/types.ts`); `analyseTeam`, `PEER_FLAG_META` and `PeerFlag` (`src/lib/peerMath.ts`); `PEER_DIMENSIONS`; `ReportHead` from `./grading`.
- Produces:
  - `defaultRound(rounds: PeerRoundStatus[]): PeerRoundStatus | null`. It returns the closed final round if there is one, otherwise the latest by `opens_at`.
  - `peerSummaryDoc(input: ReportHead & { projectTitle: string; round: PeerRoundStatus; results: PeerResult[]; comments: PeerComment[] | null }): ReportDoc`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/reports/peerSummary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultRound, peerSummaryDoc } from './peerSummary'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { PeerResult, PeerRoundStatus } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 13, 2026' }
const round = (over: Partial<PeerRoundStatus>): PeerRoundStatus => ({
  id: 'r1', project_id: 'p1', class_id: 'c', kind: 'check_in', opens_at: '2026-10-01T00:00:00Z',
  closes_at: '2026-10-05T00:00:00Z', closed_at: '2026-10-05T00:00:00Z', is_open: false, expected: 3, answered: 2, ...over,
})
const res = (sid: string, avg: number, board = 'b1'): PeerResult => ({
  round_id: 'r1', project_id: 'p1', class_id: 'c', kind: 'final', opens_at: '2026-10-01T00:00:00Z', is_open: false,
  board_id: board, group_name: board === 'b1' ? 'Group 1' : 'Group 2', student_id: sid, student_name: sid.toUpperCase(),
  received_avg: avg, raters: 2, received_spread: 0, self_avg: avg, given_avg: avg, contributes_avg: avg,
  interacts_avg: avg, on_track_avg: avg, quality_avg: avg, skills_avg: avg, team_size: 3, rated_all: true,
})
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('defaultRound', () => {
  it('prefers the closed final round, else the latest', () => {
    const early = round({ id: 'a', opens_at: '2026-09-01T00:00:00Z' })
    const late = round({ id: 'b', opens_at: '2026-10-01T00:00:00Z' })
    const fin = round({ id: 'f', kind: 'final', opens_at: '2026-09-15T00:00:00Z' })
    const openFinal = round({ id: 'o', kind: 'final', is_open: true, closed_at: null, opens_at: '2026-10-10T00:00:00Z' })
    expect(defaultRound([early, late, fin])?.id).toBe('f')
    expect(defaultRound([early, late, openFinal])?.id).toBe('o')
    expect(defaultRound([early, late])?.id).toBe('b')
    expect(defaultRound([])).toBeNull()
  })
})

describe('peerSummaryDoc', () => {
  const results = [res('a', 4), res('b', 3.5), res('c', 2), res('d', 3, 'b2'), res('e', 3, 'b2')]
  const doc = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ kind: 'final' }), results, comments: null })

  it('shows the response rate and flag counts', () => {
    expect(kpi(doc, 'Answered')).toBe('2 of 3')
    expect(kpi(doc, 'Response rate')).toBe('66.7%')
    expect(kpi(doc, 'Rated low by teammates')).toBe(1)
  })
  it('has one table per group with the five dimensions', () => {
    const groups = tableBlocks(doc).filter((t) => t.id.startsWith('group-'))
    expect(groups.map((t) => t.title)).toEqual(['Group 1', 'Group 2'])
    expect(groups[0].columns).toHaveLength(11)
  })
  it('charts the class dimension averages out of 5', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.max).toBe(5)
  })
  it('leaves comments out and the header plain by default', () => {
    expect(tableBlocks(doc).some((t) => t.id === 'comments')).toBe(false)
    expect(doc.header.confidential).toBeUndefined()
  })
  it('adds comments without rater names and marks the report confidential', () => {
    const withComments = peerSummaryDoc({
      ...head, projectTitle: 'Lab 6', round: round({ kind: 'final' }), results,
      comments: [{ round_id: 'r1', board_id: 'b1', project_id: 'p1', ratee_id: 'a', ratee_name: 'A', rater_id: 'b', rater_name: 'B', comment: 'Quiet', updated_at: '' }],
    })
    const t = tableBlocks(withComments).find((x) => x.id === 'comments')!
    expect(t.columns.map((c) => c.label)).toEqual(['About', 'Group', 'Comment'])
    expect(JSON.stringify(t.rows)).not.toContain('"B"')
    expect(withComments.header.confidential).toBe('Contains confidential peer comments')
  })
  it('never divides by zero', () => {
    const none = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ expected: 0, answered: 0 }), results: [], comments: null })
    expect(kpi(none, 'Response rate')).toBe('—')
    const zero = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ expected: 4, answered: 0 }), results: [], comments: null })
    expect(kpi(zero, 'Response rate')).toBe('0.0%')
    expect(none.blocks.some((b) => b.kind === 'note')).toBe(true)
  })
})
```

The low-flag count is 1. In group 1 (a 4, b 3.5, c 2) the mean is 3.167, so c's factor is 0.632, below 0.85. Group 2 has equal averages and no low flag.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reports/peerSummary.test.ts`
Expected: FAIL (`Failed to resolve import "./peerSummary"`).

- [ ] **Step 3: Write `src/lib/reports/peerSummary.ts`**

```ts
import { PEER_FLAG_META, analyseTeam } from '../peerMath'
import type { PeerFlag } from '../peerMath'
import { PEER_DIMENSIONS } from '../peerDimensions'
import type { PeerComment, PeerResult, PeerRoundStatus } from '../types'
import type { Block, Cell, Column, ReportDoc } from './doc'
import type { ReportHead } from './grading'

const KIND = { check_in: 'Check-in', final: 'Final' } as const
const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })

/** The closed final round if there is one, otherwise the latest. */
export function defaultRound(rounds: PeerRoundStatus[]): PeerRoundStatus | null {
  if (rounds.length === 0) return null
  const latest = [...rounds].sort((a, b) => b.opens_at.localeCompare(a.opens_at))
  return latest.find((r) => r.kind === 'final') ?? latest[0]
}

const num = (v: number | null) => (v === null ? null : Number(v))

export function peerSummaryDoc(input: ReportHead & {
  projectTitle: string
  round: PeerRoundStatus
  results: PeerResult[]
  comments: PeerComment[] | null
}): ReportDoc {
  const { round, results } = input
  const boards = [...new Set(results.map((r) => r.board_id))]
  const analysed = boards.flatMap((b) => analyseTeam(results.filter((r) => r.board_id === b)))
  const flagCount = new Map<PeerFlag, number>()
  for (const m of analysed) for (const f of m.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1)

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Answered', value: `${round.answered} of ${round.expected}` },
        {
          label: 'Response rate',
          value: round.expected > 0 ? `${((round.answered / round.expected) * 100).toFixed(1)}%` : '—',
        },
        ...[...flagCount].map(([f, n]) => ({ label: PEER_FLAG_META[f].label, value: n })),
      ],
    },
  ]

  if (results.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nobody has rated anyone in this round yet.' })
  } else {
    const dims = PEER_DIMENSIONS.map((d) => {
      const xs = results.map((r) => num((r as unknown as Record<string, number | null>)[`${d.key}_avg`])).filter((v): v is number => v !== null)
      return { label: d.label, value: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : 0 }
    })
    blocks.push({
      kind: 'chart',
      id: 'dimensions',
      title: 'Class averages on the five behaviours (out of 5)',
      chart: { kind: 'bars', rows: dims, max: 5 },
      summary: `Across the class: ${dims.map((d) => `${d.label} ${d.value}`).join('; ')}.`,
    })

    const columns: Column[] = [
      { key: 'member', label: 'Member', type: 'text' },
      { key: 'received', label: 'From teammates', type: 'number' },
      { key: 'self', label: 'Self', type: 'number' },
      { key: 'factor', label: 'Factor', type: 'number' },
      { key: 'raters', label: 'Raters', type: 'number' },
      { key: 'flags', label: 'Flags', type: 'text' },
      ...PEER_DIMENSIONS.map<Column>((d) => ({ key: d.key, label: d.label, type: 'number' })),
    ]
    const groups = boards
      .map((b) => ({ b, name: results.find((r) => r.board_id === b)?.group_name ?? 'Group' }))
      .sort((x, y) => x.name.localeCompare(y.name))
    for (const { b, name } of groups) {
      const team = analysed.filter((m) => m.board_id === b).sort((x, y) => x.student_name.localeCompare(y.student_name))
      blocks.push({
        kind: 'table',
        id: `group-${b}`,
        title: name,
        columns,
        rows: team.map<Cell[]>((m) => [
          m.student_name,
          num(m.received_avg),
          num(m.self_avg),
          m.factor,
          m.raters,
          m.flags.map((f) => PEER_FLAG_META[f].label).join('; ') || null,
          ...PEER_DIMENSIONS.map((d) => num((m as unknown as Record<string, number | null>)[`${d.key}_avg`])),
        ]),
      })
    }
  }

  if (input.comments) {
    const groupOf = new Map(results.map((r) => [r.board_id, r.group_name ?? 'Group']))
    blocks.push({
      kind: 'table',
      id: 'comments',
      title: 'Comments',
      columns: [
        { key: 'about', label: 'About', type: 'text' },
        { key: 'group', label: 'Group', type: 'text' },
        { key: 'comment', label: 'Comment', type: 'text' },
      ],
      rows: input.comments.map((c) => [c.ratee_name, groupOf.get(c.board_id) ?? null, c.comment]),
      note: 'Who wrote each comment is left out on purpose.',
    })
  }

  return {
    header: {
      title: 'Peer evaluation summary',
      subtitle: `${input.projectTitle} · ${KIND[round.kind]} round`,
      classLine: input.classLine,
      rangeLabel: `${DAY.format(new Date(round.opens_at))} to ${DAY.format(new Date(round.closed_at ?? round.closes_at))}`,
      madeAt: input.madeAt,
      ...(input.comments ? { confidential: 'Contains confidential peer comments' } : {}),
    },
    blocks,
    footer: {
      lines: ['Teammates never see who gave which rating. A flag is a prompt for a conversation, not a grade.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
```

`defaultRound` sorts newest first and then takes the first `final`, so a final round, open or closed, wins over a newer check-in. The test expects that: an open final beats the check-ins. If the spec's "closed final" wording is needed exactly, change this so a closed final wins, then the latest. The test as written pins this simpler rule; **it is a deliberate ruling: "the final round, else the latest".**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/reports/peerSummary.test.ts`, then `npx eslint src/lib/reports`.
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/peerSummary.ts src/lib/reports/peerSummary.test.ts
git commit -m "Build the peer evaluation summary"
```

---

### Task 6: The Reports page: new reports, URL choices and exports

**Files:**
- Modify: `src/pages/app/reports/useReports.ts`
- Create: `src/pages/app/reports/useReportDoc.ts`
- Modify: `src/components/reports/ReportPicker.tsx`
- Modify: `src/pages/app/reports/Reports.tsx`
- Modify: `supabase/tests/reports.test.sql` (the "no unreleased marks in here" block)

**Interfaces:**
- Consumes:
  - Tasks 1–5;
  - `scoreSheet`, `projectBoardScores` (`src/lib/api/scores.ts`);
  - `listCriteria` (`src/lib/api/projects.ts`);
  - `projectPeerResults`, `listPeerRounds`, `peerComments` (`src/lib/api/peer.ts`);
  - `generatedOn` (`src/lib/report.ts`);
  - `ActionMenu` (`src/components/ui/ActionMenu.tsx`);
  - `Toggle` (`src/components/ui/Field.tsx`).
- Produces:
  - `ReportKind` gains `'grading' | 'peer'`. `useReports` returns `roundId`, `setRoundId`, `comments` and `setComments`, and keeps every choice in the URL.
  - `useReportDoc(r, professor): { doc: ReportDoc | null; loading: boolean; error: string | null; retry: () => void; rounds: PeerRoundStatus[] }`

- [ ] **Step 1: Move the choices into the URL in `useReports.ts`**

- Add `'grading' | 'peer'` to `ReportKind`.
- Add `grading: ['class', 'project']` and `peer: ['class', 'project']` to `NEEDS`.
- Add `export const OPTIONAL_STUDENT: ReportKind[] = ['grading']`.
- Replace the five `useState` choices (`kind`, `classId`, `projectId`, `boardId`, `studentId`) with values read from `useSearchParams()`, under the keys `report`, `rclass`, `rproject`, `rgroup` and `rstudent`. Add `rround` (`roundId`) and `rcomments` (`comments: boolean`, stored as `'1'`).

```ts
const [params, setParams] = useSearchParams()
const patch = useCallback(
  (next: Record<string, string>) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        for (const [k, v] of Object.entries(next)) (v ? n.set(k, v) : n.delete(k))
        return n
      },
      { replace: true },
    ),
  [setParams],
)
const kind = ((params.get('report') as ReportKind | null) ?? 'grading') as ReportKind
```

- `classId`: `params.get('rclass') || lockedClassId || classes?.[0]?.class_id || ''`.
- `setClassId(v)`: `patch({ rclass: v, rproject: '', rgroup: '', rstudent: '', rround: '' })`. This replaces the "clear the pickers when the class changes" effect; delete that effect.
- The other setters each `patch` their own key. `setProjectId` also clears `rround`.
- `choose(next)`: `patch({ report: next, …clear keys this report does not use })`, keeping the existing logic. Never clear `rstudent` for `grading`.
- `ready`: treat a student as optional for kinds in `OPTIONAL_STUDENT`. For `grading`, `rproject = 'all'` counts as chosen.
- Return `roundId`, `setRoundId`, `comments`, `setComments` (`(on: boolean) => patch({ rcomments: on ? '1' : '' })`) and `params`.
- Keep `loadClass` keyed on `classId`, as today.

Guard `kind`: when `params.get('report')` is not a known kind (`!(k in NEEDS)`), use `'grading'`.

- [ ] **Step 2: Write `src/pages/app/reports/useReportDoc.ts`**

```ts
import { useCallback, useEffect, useState } from 'react'
import { listPeerRounds, peerComments, projectPeerResults } from '../../../lib/api/peer'
import { listCriteria } from '../../../lib/api/projects'
import { projectBoardScores, scoreSheet } from '../../../lib/api/scores'
import { authErrorMessage } from '../../../lib/authError'
import { generatedOn } from '../../../lib/report'
import type { ReportDoc } from '../../../lib/reports/doc'
import { gradingClassDoc, gradingGridDoc, gradingStudentDoc } from '../../../lib/reports/grading'
import { defaultRound, peerSummaryDoc } from '../../../lib/reports/peerSummary'
import type { PeerResult, PeerRoundStatus } from '../../../lib/types'
import type { useReports } from './useReports'

type R = ReturnType<typeof useReports>

const finalRows = (rows: PeerResult[]) => rows.filter((p) => p.kind === 'final' && !p.is_open)

/** Loads the data a new-style report needs and builds its document. Old sheets return null. */
export function useReportDoc(r: R, professor: string) {
  const [doc, setDoc] = useState<ReportDoc | null>(null)
  const [rounds, setRounds] = useState<PeerRoundStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  const { kind, cls, projectId, studentId, roundId, comments, projects, boards, work, students, ready } = r

  useEffect(() => {
    let live = true
    if ((kind !== 'grading' && kind !== 'peer') || !ready || !cls) {
      setDoc(null)
      return
    }
    const head = {
      classLine: `${cls.class_initial} · ${cls.class_name} · ${cls.section}`,
      professor,
      madeAt: generatedOn(),
    }
    const asProject = (p: { id: string; title: string; total_points: number }) => ({
      id: p.id, title: p.title, total_points: p.total_points,
    })
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        let next: ReportDoc | null = null
        if (kind === 'grading' && studentId) {
          const student = students.find((s) => s.value === studentId)
          const parts = await Promise.all(
            projects.map(async (p) => {
              const [sheet, criteria, peer] = await Promise.all([scoreSheet(p.id), listCriteria(p.id), projectPeerResults(p.id)])
              const row = sheet.find((x) => x.student_id === studentId) ?? null
              const boardScores = row ? await projectBoardScores([row.board_id]) : []
              return { project: asProject(p), row, criteria, boardScores, peer: finalRows(peer) }
            }),
          )
          next = gradingStudentDoc({ ...head, student: { id: studentId, name: student?.label ?? 'Student' }, projects: parts })
        } else if (kind === 'grading' && projectId === 'all') {
          const sheets = await Promise.all(projects.map(async (p) => ({ project: asProject(p), sheet: await scoreSheet(p.id) })))
          next = gradingGridDoc({ ...head, students: students.map((s) => ({ id: s.value, name: s.label })), projects: sheets })
        } else if (kind === 'grading') {
          const p = projects.find((x) => x.id === projectId)
          if (p) {
            const [sheet, criteria, peer] = await Promise.all([scoreSheet(p.id), listCriteria(p.id), projectPeerResults(p.id)])
            const boardScores = await projectBoardScores([...new Set(sheet.map((x) => x.board_id))])
            next = gradingClassDoc({
              ...head, project: asProject(p), sheet, criteria, boardScores,
              boardNames: new Map(boards.map((b) => [b.id, b.group_name ?? b.student_name ?? 'A board'])),
              work: work.filter((w) => w.project_id === p.id),
              peer: finalRows(peer),
            })
          }
        } else if (kind === 'peer') {
          const p = projects.find((x) => x.id === projectId)
          if (p) {
            const rs = await listPeerRounds(p.id)
            if (live) setRounds(rs)
            const round = rs.find((x) => x.id === roundId) ?? defaultRound(rs)
            if (round) {
              const [all, cs] = await Promise.all([projectPeerResults(p.id), comments ? peerComments(round.id) : Promise.resolve(null)])
              next = peerSummaryDoc({
                ...head, projectTitle: p.title, round,
                results: all.filter((x) => x.round_id === round.id), comments: cs,
              })
            }
          }
        }
        if (live) setDoc(next)
      } catch (err) {
        if (live) setError(authErrorMessage(err, 'Could not build that report. Try again.'))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [kind, cls, projectId, studentId, roundId, comments, projects, boards, work, students, ready, professor, nonce])

  return { doc, loading, error, retry, rounds }
}
```

Two checks:
- **The `students` labels.** `useReports` labels students "Last, First". That is fine on a sheet.
- **Archived boards.** `boards` in `useReports` is already narrowed by `projectId`. When `projectId === 'all'` that narrowing is a no-op, which is what we want. If the existing `shownBoards` memo filters on `projectId` and `'all'` matches nothing, make `shownBoards` treat `'all'` like `''`.

- [ ] **Step 3: Extend `ReportPicker.tsx`**

- **`PickerState` gains:**
  - `projectOptions?: { value: string; label: string }[]`
  - `studentOptional?: boolean`
  - `extras?: ReactNode`
- **In `About`:**
  - The project `Select` uses `r.projectOptions ?? r.projects.map(…)`.
  - When `r.studentOptional` is set, the student `Select` gets options `[{ value: '', label: 'Whole class' }, ...r.students]` and no placeholder. Under it, add a one-line hint: `Picking a student shows them across every project.`
  - After the selects, render `{r.extras}`.
- **In `Actions`:** add an optional `exports?: ActionMenuItem[]` prop. When it is provided, render this after Print, instead of the CSV button:

```tsx
<ActionMenu label="Export" icon="download" items={exports} disabled={!r.ready} size="sm" />
```

  Check `ActionMenu`'s `triggerClassName` prop. If its default trigger is an icon-only button, pass a `triggerClassName` that shows the word: read `ActionMenu.tsx` and match how other toolbars render a labelled trigger, or render a labelled `Button` that opens it.
- **Thread through:** `ReportBar` and `ReportSidebar` pass an `exports?: ActionMenuItem[]` prop through to `Actions`.

- [ ] **Step 4: Wire the new reports into `Reports.tsx`**

- **Catalogue:**

```ts
const CATALOGUE: ReportGroup[] = [
  {
    group: 'For grading',
    items: [
      { kind: 'grading', label: 'Individual grading sheet', body: 'Rubric scores, the teamwork adjustment and contribution for every student, a grade book across projects, or one student in full.' },
      { kind: 'peer', label: 'Peer evaluation summary', body: 'How each group rated its members on the five behaviours, the response rate and the flags worth a conversation.' },
    ],
  },
  { group: 'Older reports', items: [ /* the seven existing items, unchanged */ ] },
]
```

- **Loading:** call `const d = useReportDoc(r, professor)`.
- **Project choices:**
  - For `grading`, `projectOptions = [{ value: 'all', label: 'All projects (grade book)' }, ...r.projects.map(…)]`.
  - For `peer`, only group projects: `r.projects.filter((p) => p.audience === 'group')`.
- **Extras for `peer`:**
  - A round `Select`, from `d.rounds`, labelled `{Check-in | Final} · {opens date}`. Its value is `r.roundId`, or the default round's id when that is empty.
  - A `Toggle` labelled "Include written comments", bound to `r.comments` / `r.setComments`.
- **Exports for `grading` and `peer`**, when `d.doc` exists:

```ts
const base = reportBase(kind === 'grading' ? 'grading-sheet' : 'peer-summary', d.doc.header.subtitle)
const exports: ActionMenuItem[] = [
  { label: 'Excel (.xlsx)', icon: 'download', onSelect: () => void exportXlsx(d.doc!, base).catch(() => show('Could not make the Excel file. Try again.', 'error')) },
  { label: 'Word (.docx)', icon: 'download', onSelect: () => void exportDocx(d.doc!, base).catch(() => show('Could not make the Word file. Try again.', 'error')) },
  ...docCsvFiles(d.doc, base).map((f) => ({ label: `CSV: ${f.label}`, icon: 'download' as const, onSelect: () => exportCsv(f) })),
]
```

  `show` is from `useToast()`. Pass `exports` to `ReportBar` and `ReportSidebar` for the new kinds; the old kinds keep their CSV button.
- **`Preview`, for `grading` and `peer`:**
  - `d.loading`: a spinner and "Building the report…".
  - `d.error`: `<Alert tone="error" onRetry={d.retry}>`.
  - `d.doc`: `<ReportDocView doc={d.doc} />`.
  - A `peer` project with no rounds: `<EmptyState title="No peer evaluation on this project yet" body="Open a round from the project's Work tab, and its results appear here." />`.
- **The empty-state copy** for `!r.ready` stays.

- [ ] **Step 5: The report test's score rule**

In `supabase/tests/reports.test.sql`, replace the "no unreleased marks in here" block (its comment and its `do $$ … end $$;`) with:

```sql
-- --------------------------------------------- scores only in staff-only reads

/**
 * Reports may now carry scores, released or not (Phase B), because they are
 * the professor's own record. What must never happen is a report view handing
 * a score to a student. So every report view that reads a score table is read
 * here as a student, and must return nothing.
 */
do $$
declare
  v record;
  n int;
  v_student uuid := (select student_id from public.class_members where status = 'active' limit 1);
begin
  for v in
    select distinct u.view_name
      from information_schema.view_table_usage u
     where u.view_schema = 'public'
       and u.view_name like 'report\_%'
       and u.table_name in ('board_scores', 'member_scores')
  loop
    perform pg_temp.act_as(v_student);
    execute format('select count(*) from public.%I', v.view_name) into n;
    perform pg_temp.act_as_service();
    perform pg_temp.must_be(format('a student reads no score from %s', v.view_name), n = 0);
  end loop;
  raise notice 'PASS  score views checked (none yet is fine)';
end $$;
```

Check that the file defines `pg_temp.act_as` and `pg_temp.act_as_service` with these names. If it uses other names (for example `pg_temp.svc`), use those. Then run `node scripts/db.mjs supabase/tests/reports.test.sql`. Expected: no `FAIL`.

- [ ] **Step 6: Build, lint, test**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/pages/app/reports/useReports.ts src/pages/app/reports/useReportDoc.ts src/components/reports/ReportPicker.tsx src/pages/app/reports/Reports.tsx supabase/tests/reports.test.sql
git commit -m "Add the grading sheet and peer summary to Reports, with exports and linkable choices"
```

---

## After the tasks (controller)

1. **Browser check, as faculty.** It is read-only, so it needs no approval.
   - **Pages:** Reports, both on its own and inside a class.
   - **Grading sheet:** Lab 6 (the scores were cleared after C2, so expect "Not confirmed" and the no-spread note), then All projects, then one student.
   - **Peer summary:** Lab 6's check-in round, with comments on and off.
   - **Each export opened:** Excel (sheets, numbers), Word (tables), CSV.
   - **Print preview.**
   - **Address:** a reload keeps the choices.
   - **Display:** light and dark, at widths of 375, 768 and 1440.
2. **Ship:**
   - fast-forward to `main` and push;
   - add a "Phase B1" section to `handoff.md`;
   - update the `collabify-current-state` memory with "B1 live, next B2".

---

## Self-review

- **Spec coverage:**
  - **Engine.** Every part is covered:

    | Spec item | Task |
    |---|---|
    | Document model | 1 |
    | Exporters | 2 |
    | Renderer | 3 |
    | Page: URL, export menu, loading/error/empty | 6 |
    | Score rule test | 6 |
  - **Grading sheet** (Task 4):
    - class version: KPIs, columns, chart bands, rubric, footer;
    - all-projects grid, with the not-released header (ruling 2);
    - one-student version.
  - **Peer summary** (Task 5): KPIs, per-group tables, dimensions chart, comments toggle and confidential header.
  - **Not in B1:** B2–B4 reports and retiring the old sheets.
- **Placeholders:** none. Task 6 says what to change in existing components. The exact edits depend on lines the implementer must read, so each instruction names the prop, the value and the copy.
- **Type consistency:**
  - **`ReportHead`:** defined in `grading.ts` and imported by `peerSummary.ts`.
  - **`useReportDoc`:** reads `r.kind`, `cls`, `projectId`, `studentId`, `roundId`, `comments`, `projects`, `boards`, `work`, `students` and `ready`, all returned by `useReports` after Step 1.
  - **Exporters:** take the `ReportDoc` from Task 1.
- **Review Focus:**
  - item 1: Task 4's "says so" test;
  - item 2: the `scoreBand` test;
  - items 3 and 4: the `sheetName` and formula tests in Task 2;
  - item 5: the "never divides by zero" test in Task 5.
