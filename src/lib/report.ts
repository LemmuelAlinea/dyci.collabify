import type { Semester, TaskStatus, WeekPhase, YearLevel } from './types'

/**
 * What a report is made of, apart from React.
 *
 * Reports are the half of the product that leaves it. Analytics is read on
 * screen by the person who owns the class; a report is printed, filed, or
 * opened in Excel by somebody else — so everything here is about being legible
 * off the screen: a letterhead, real dates, and a CSV a spreadsheet will not
 * mangle.
 *
 * No figure is computed here that the database did not already count, and
 * nothing in a report is a mark. The sheets say so in their footer.
 */

/* ---------------------------------------------------------------- identity */

/**
 * The letterhead. One place, because a school that renames itself, or a second
 * school using this, should be a one-line change and not a hunt.
 */
export const SCHOOL = "Dr. Yanga's Colleges, Inc."
export const DEPARTMENT = 'College of Computer Studies — Bachelor of Science in Information Technology'

/** Printed under every sheet, so a completion figure is never read as a mark. */
export const NO_MARKS_NOTE =
  'This report records effort and completion only. It carries no grade, and is not a grade record.'

/* -------------------------------------------------------------------- dates */

/**
 * A `date` column arrives as "2026-07-20". `new Date` reads that as UTC
 * midnight, which is the day before anywhere west of Greenwich, so the parts
 * are assembled by hand. Reports print dates in nearly every row, which is why
 * this lives here rather than in one page.
 */
export function localDay(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

const LONG: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
const SHORT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

/** A plain date column, printed. Empty string when there is nothing to print. */
export function dayLabel(value: string | null, long = false) {
  if (!value) return ''
  return localDay(value).toLocaleDateString(undefined, long ? LONG : SHORT)
}

/** A timestamp, printed with the time — when a hand-in happened, for instance. */
export function momentLabel(value: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function termLabel(from: string | null, to: string | null) {
  if (!from || !to) return 'No term dates set'
  return `${dayLabel(from, true)} – ${dayLabel(to, true)}`
}

export function termWeeks(from: string | null, to: string | null) {
  if (!from || !to) return 0
  const days = (localDay(to).getTime() - localDay(from).getTime()) / 86_400_000
  return Math.max(1, Math.ceil((days + 1) / 7))
}

/** The stamp on the sheet. A report without one is undatable evidence. */
export function generatedOn() {
  return new Date().toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* ---------------------------------------------------------------------- csv */

/**
 * RFC 4180: quote anything holding a comma, a quote or a newline, and double
 * the quotes inside. CRLF because that is what the format says and what Excel
 * on Windows expects.
 */
function cell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: (string | number | null)[][]) {
  // The BOM is what keeps Excel from turning ñ into Ã±. Sheets ignores it.
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** Hand the file to the browser. Nothing is uploaded; the CSV never leaves. */
export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** A filename somebody can find again: what it is, who it is about, when. */
export function reportFilename(kind: string, subject: string) {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  const today = new Date()
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  return `${slug(kind)}-${slug(subject)}-${stamp}.csv`
}

/** Whole per cent, for a share that is printed rather than computed against. */
export const pct = (value: number | string | null) =>
  value === null ? '' : `${Math.round(Number(value))}%`

/* -------------------------------------------------------------------- types */

/** report_class_summary: one class, archived or not, and everything in it. */
export type ClassReport = {
  class_id: string
  class_initial: string
  class_name: string
  code: string
  section: string
  school_year: string
  semester: Semester
  year_level: YearLevel
  term_start: string | null
  term_end: string | null
  /** Set when the term is over. Reports keep these; analytics drops them. */
  archived_at: string | null
  students: number
  students_removed: number
  projects: number
  projects_archived: number
  boards: number
  boards_submitted: number
  boards_accepted: number
  boards_returned: number
  tasks: number
  tasks_done: number
  tasks_late: number
  tasks_unclaimed: number
  weeks_total: number
  weeks_covered: number
}

/** report_week_coverage: what the syllabus asked, and what was set against it. */
export type WeekCoverage = {
  class_id: string
  week_no: number
  title: string
  topics: string
  outcomes: string
  assessments: string
  week_start: string | null
  week_end: string | null
  phase: WeekPhase
  project_titles: string
  project_count: number
}

/** report_student_work: one student on one board, group or individual. */
export type StudentWork = {
  class_id: string
  project_id: string
  project_title: string
  board_id: string
  group_name: string | null
  board_student_name: string | null
  submitted_at: string | null
  result_verdict: 'accepted' | 'returned' | null
  project_due_at: string | null
  student_id: string
  student_name: string
  avatar_url: string | null
  tasks_held: number
  tasks_done: number
  tasks_late: number
  held_pct: number
  personal_pct: number | null
  first_activity: string | null
  last_finish: string | null
}

/** report_board_tasks: every task on one board, with who held it. */
export type BoardTask = {
  task_id: string
  board_id: string
  class_id: string
  project_id: string
  project_title: string
  board_owner: string | null
  title: string
  details: string
  weight: number
  status: TaskStatus
  author_role: 'professor' | 'student'
  due_at: string | null
  started_at: string | null
  done_at: string | null
  late: boolean
  position: number
  holders: string
  file_count: number
}

/** What a board is called on a sheet: its group, or the student who owns it. */
export const ownerName = (row: { group_name: string | null; board_student_name: string | null }) =>
  row.group_name ?? row.board_student_name ?? 'A board'
