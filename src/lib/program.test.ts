import { describe, expect, it } from 'vitest'
import { cohortRollup, currentSchoolYear, loadRollup, paceOf, readiness } from './program'
import type { ProgramClass } from './program'
import type { YearLevel } from './types'

/**
 * These add up what the program chair reads. A wrong total here is worse than
 * a crash: nobody sees an error, they just act on a number that is not true.
 */
function aClass(over: Partial<ProgramClass> = {}): ProgramClass {
  return {
    class_id: 'c1',
    class_initial: 'ABC',
    class_name: 'A class',
    code: 'IT-101',
    section: 'BSIT 3A',
    year_level: '3rd' as YearLevel,
    semester: '1st',
    school_year: '2026-2027',
    professor_id: 'p1',
    professor_name: 'A Professor',
    term_start: '2026-08-03',
    term_end: '2026-12-19',
    archived_at: null,
    has_syllabus: true,
    weeks_total: 18,
    weeks_covered: 9,
    weeks_elapsed: 9,
    weeks_in_term: 18,
    students: 20,
    projects: 3,
    projects_released: 3,
    boards: 6,
    tasks: 40,
    tasks_done: 25,
    tasks_late: 2,
    last_activity: '2026-08-20T02:00:00+00:00',
    ...over,
  }
}

describe('readiness', () => {
  it('finds nothing missing in a class that is ready', () => {
    expect(readiness(aClass())).toEqual([])
  })

  it('names each gap separately, because each has a different fix', () => {
    const gaps = readiness(
      aClass({ term_start: null, has_syllabus: false, students: 0, projects_released: 0 }),
    )
    expect(gaps).toEqual([
      'no term dates',
      'no syllabus',
      'nobody enrolled',
      'nothing released',
    ])
  })

  it('treats a half-set term as no term', () => {
    expect(readiness(aClass({ term_end: null }))).toContain('no term dates')
  })

  it('does not call a class unready for having unreleased projects, only zero released', () => {
    expect(readiness(aClass({ projects: 5, projects_released: 1 }))).toEqual([])
  })
})

describe('paceOf', () => {
  it('speaks for a class that is dated and has weeks in its syllabus', () => {
    expect(paceOf(aClass())).not.toBeNull()
  })

  it('refuses a class with no term dates rather than guessing', () => {
    expect(paceOf(aClass({ term_start: null }))).toBeNull()
    expect(paceOf(aClass({ term_end: null }))).toBeNull()
  })

  it('refuses a class whose syllabus has no weeks', () => {
    expect(paceOf(aClass({ weeks_total: 0 }))).toBeNull()
  })

  it('refuses a term that has not started, where elapsed weeks are unknown', () => {
    expect(paceOf(aClass({ weeks_elapsed: null }))).toBeNull()
    expect(paceOf(aClass({ weeks_in_term: null }))).toBeNull()
  })
})

describe('cohortRollup', () => {
  it('adds a year level up and counts its classes', () => {
    const [third] = cohortRollup([
      aClass({ class_id: 'a', students: 20, tasks: 40, tasks_done: 25, tasks_late: 2 }),
      aClass({ class_id: 'b', students: 15, tasks: 10, tasks_done: 4, tasks_late: 1 }),
    ])
    expect(third.classes).toBe(2)
    expect(third.students).toBe(35)
    expect(third.tasks).toBe(50)
    expect(third.tasks_done).toBe(29)
    expect(third.tasks_late).toBe(3)
  })

  it('keeps year levels apart', () => {
    const out = cohortRollup([
      aClass({ class_id: 'a', year_level: '1st' as YearLevel, students: 30 }),
      aClass({ class_id: 'b', year_level: '3rd' as YearLevel, students: 20 }),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((c) => c.year_level)).toEqual(['1st', '3rd'])
  })

  it('counts a class with any gap as not ready, once', () => {
    const [c] = cohortRollup([
      aClass({ class_id: 'a', has_syllabus: false, students: 0 }),
      aClass({ class_id: 'b' }),
    ])
    expect(c.not_ready).toBe(1)
  })

  it('is empty for no rows rather than throwing', () => {
    expect(cohortRollup([])).toEqual([])
  })
})

describe('loadRollup', () => {
  it('gathers a professor’s classes and totals their students', () => {
    const by = loadRollup([
      aClass({ class_id: 'a', professor_id: 'p1', students: 20 }),
      aClass({ class_id: 'b', professor_id: 'p1', students: 15 }),
      aClass({ class_id: 'c', professor_id: 'p2', students: 10 }),
    ])
    expect(by.size).toBe(2)
    expect(by.get('p1')?.classes).toHaveLength(2)
    expect(by.get('p1')?.students).toBe(35)
    expect(by.get('p2')?.students).toBe(10)
  })

  it('counts only that professor’s unready classes against them', () => {
    const by = loadRollup([
      aClass({ class_id: 'a', professor_id: 'p1', has_syllabus: false }),
      aClass({ class_id: 'b', professor_id: 'p1' }),
      aClass({ class_id: 'c', professor_id: 'p2', students: 0 }),
    ])
    expect(by.get('p1')?.not_ready).toBe(1)
    expect(by.get('p2')?.not_ready).toBe(1)
  })
})

describe('currentSchoolYear', () => {
  it('picks the year with the most classes in it', () => {
    expect(
      currentSchoolYear([
        aClass({ class_id: 'a', school_year: '2025-2026' }),
        aClass({ class_id: 'b', school_year: '2026-2027' }),
        aClass({ class_id: 'c', school_year: '2026-2027' }),
      ]),
    ).toBe('2026-2027')
  })

  it('breaks a tie towards the later year', () => {
    expect(
      currentSchoolYear([
        aClass({ class_id: 'a', school_year: '2025-2026' }),
        aClass({ class_id: 'b', school_year: '2026-2027' }),
      ]),
    ).toBe('2026-2027')
  })

  it('returns an empty string for no rows, so the console has something to render', () => {
    expect(currentSchoolYear([])).toBe('')
  })
})
