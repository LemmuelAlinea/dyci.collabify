import type { ClassPace, Semester, YearLevel } from './types'

/**
 * What the program chair reads, and the few things worth computing from it.
 *
 * Everything here is counts. The chair's console never carries a task title, a
 * comment, a file or one student's work — that line is drawn in
 * `supabase/admin-program.sql` and asserted by its suite; this file only has to
 * avoid inventing a figure the view did not count.
 *
 * The one projection on the page, "is this class keeping up with its syllabus",
 * is `projectFinish`'s. `admin_class_overview` deliberately carries the same
 * four week columns `class_pace` does so the row can be handed to it unchanged.
 */

/** admin_class_overview: one class, as figures. */
export type ProgramClass = {
  class_id: string
  class_initial: string
  class_name: string
  code: string
  section: string
  year_level: YearLevel
  semester: Semester
  school_year: string
  professor_id: string
  professor_name: string
  term_start: string | null
  term_end: string | null
  /** Set when the term is over. The chair still reviews it. */
  archived_at: string | null
  has_syllabus: boolean
  weeks_total: number
  weeks_covered: number
  /** Null until the class has term dates, which is a readiness gap in itself. */
  weeks_elapsed: number | null
  weeks_in_term: number | null
  students: number
  projects: number
  projects_released: number
  boards: number
  tasks: number
  tasks_done: number
  tasks_late: number
  last_activity: string | null
}

/* ------------------------------------------------------------- readiness */

export type Gap = 'no term dates' | 'no syllabus' | 'nobody enrolled' | 'nothing released'

/**
 * What is missing before a class can actually run.
 *
 * Named gaps rather than a score: "not ready" tells a chair nothing they can
 * act on, and each of these has a different person to ask and a different fix.
 */
export function readiness(c: ProgramClass): Gap[] {
  const gaps: Gap[] = []
  if (!c.term_start || !c.term_end) gaps.push('no term dates')
  if (!c.has_syllabus) gaps.push('no syllabus')
  if (c.students === 0) gaps.push('nobody enrolled')
  if (c.projects_released === 0) gaps.push('nothing released')
  return gaps
}

/** A class the syllabus projection can speak for: dated, and with weeks in it. */
export function paceOf(c: ProgramClass): ClassPace | null {
  if (!c.term_start || !c.term_end || !c.weeks_elapsed || !c.weeks_in_term) return null
  if (c.weeks_total === 0) return null
  return {
    class_id: c.class_id,
    class_initial: c.class_initial,
    class_name: c.class_name,
    term_start: c.term_start,
    term_end: c.term_end,
    weeks_total: c.weeks_total,
    weeks_covered: c.weeks_covered,
    weeks_elapsed: c.weeks_elapsed,
    weeks_in_term: c.weeks_in_term,
  }
}

/* --------------------------------------------------------------- rollups */

export type Cohort = {
  year_level: YearLevel
  classes: number
  students: number
  projects: number
  tasks: number
  tasks_done: number
  tasks_late: number
  /** Classes in this year level that still have a readiness gap. */
  not_ready: number
}

/** A whole year level, added up. The batch, rather than one class in it. */
export function cohortRollup(rows: ProgramClass[]): Cohort[] {
  const by = new Map<YearLevel, Cohort>()
  for (const c of rows) {
    const at = by.get(c.year_level) ?? {
      year_level: c.year_level,
      classes: 0,
      students: 0,
      projects: 0,
      tasks: 0,
      tasks_done: 0,
      tasks_late: 0,
      not_ready: 0,
    }
    at.classes += 1
    at.students += c.students
    at.projects += c.projects
    at.tasks += c.tasks
    at.tasks_done += c.tasks_done
    at.tasks_late += c.tasks_late
    if (readiness(c).length > 0) at.not_ready += 1
    by.set(c.year_level, at)
  }
  return [...by.values()].sort((a, b) => a.year_level.localeCompare(b.year_level))
}

export type Load = {
  professor_id: string
  professor_name: string
  classes: ProgramClass[]
  students: number
  /** Classes of theirs that are missing something before they can run. */
  not_ready: number
}

/**
 * Teaching load, professor by professor.
 *
 * Built from the class rows, so a professor holding nothing this term is not in
 * here — the Faculty page adds them from `account_overview`, which is where a
 * chair notices somebody with no load at all.
 */
export function loadRollup(rows: ProgramClass[]): Map<string, Load> {
  const by = new Map<string, Load>()
  for (const c of rows) {
    const at = by.get(c.professor_id) ?? {
      professor_id: c.professor_id,
      professor_name: c.professor_name,
      classes: [],
      students: 0,
      not_ready: 0,
    }
    at.classes.push(c)
    at.students += c.students
    if (readiness(c).length > 0) at.not_ready += 1
    by.set(c.professor_id, at)
  }
  return by
}

/** The school year with the most classes in it — what the console opens on. */
export function currentSchoolYear(rows: ProgramClass[]) {
  const tally = new Map<string, number>()
  for (const c of rows) tally.set(c.school_year, (tally.get(c.school_year) ?? 0) + 1)
  return [...tally].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? ''
}

/* ------------------------------------------------------- what the office owns */

/**
 * How long a program notice stays on a dashboard.
 *
 * The database is what enforces it — `program_notices` carries the same
 * interval. This constant exists so the pages can *say* the rule, not apply it.
 */
export const NOTICE_HOURS = 24

/** program_notices: one notice to the whole program, with who sent it. */
export type ProgramNotice = {
  id: string
  title: string
  body: string
  pinned: boolean
  created_at: string
  edited_at: string | null
  author_id: string
  author_name: string
  author_avatar: string | null
}

/**
 * program_notices_all: the office's own record, including notices whose day has
 * passed. `expired` comes from the view rather than being recomputed here, so
 * the console and the dashboard cannot disagree about where the line is.
 */
export type ProgramNoticeRecord = ProgramNotice & { expired: boolean }

/** program_sections: the cohort names the program actually runs. */
export type ProgramSection = {
  id: string
  name: string
  year_level: YearLevel
  school_year: string
  adviser_id: string | null
  archived_at: string | null
  created_at: string
}

/** program_section_overview: the same, with what is running in it. */
export type SectionOverview = Omit<ProgramSection, 'created_at'> & {
  section_id: string
  adviser_name: string | null
  classes: number
  professors: number
  students: number
}

/**
 * Folded the way `public.section_key` folds it, so the page groups a cohort the
 * same way the database does. Spacing and dashes are the whole problem: BSIT 3A
 * and BSIT-3A were two cohorts before the registry existed.
 */
export const sectionKey = (name: string) =>
  name.toLowerCase().replace(/[\s\-_]/g, '')
