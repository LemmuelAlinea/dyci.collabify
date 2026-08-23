import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  boardOwnerName,
  calendarDaysUntil,
  canPlanBoard,
  dueSoonLabel,
  fullName,
  initials,
  isBoardSubmitted,
  projectBurn,
} from './types'

/**
 * The gates and projections the interface asks before it offers somebody a
 * button. When one of these disagrees with the database, a student is refused
 * by an error message instead of by a disabled control — which is the exact
 * shape of the worst defect this codebase has had.
 */

afterEach(() => {
  vi.useRealTimers()
})

/** Freeze the clock at local noon, so a day boundary cannot drift the result. */
function atNoonOn(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0))
}

describe('canPlanBoard', () => {
  it('lets a group plan a board that is open', () => {
    expect(canPlanBoard({ submitted_at: null })).toBe(true)
  })

  it('closes the board once it has been handed in', () => {
    expect(canPlanBoard({ submitted_at: '2026-08-01T00:00:00+00:00' })).toBe(false)
  })

  it('closes the board when the professor has locked the project', () => {
    expect(canPlanBoard({ submitted_at: null }, true)).toBe(false)
  })

  it('has nothing to plan when there is no board at all', () => {
    expect(canPlanBoard(null)).toBe(false)
    expect(canPlanBoard(undefined)).toBe(false)
  })

  it('gives the board back when a return clears the submission', () => {
    // Returning un-submits, which is how "fix this and hand it in again" works.
    expect(canPlanBoard({ submitted_at: null })).toBe(true)
  })
})

describe('isBoardSubmitted', () => {
  it('is false for a board that has not been handed in, or is missing', () => {
    expect(isBoardSubmitted({ submitted_at: null })).toBe(false)
    expect(isBoardSubmitted(null)).toBe(false)
    expect(isBoardSubmitted(undefined)).toBe(false)
  })

  it('is true once there is a submission time', () => {
    expect(isBoardSubmitted({ submitted_at: '2026-08-01T00:00:00+00:00' })).toBe(true)
  })
})

describe('calendarDaysUntil', () => {
  it('counts whole calendar days, not elapsed hours', () => {
    atNoonOn('2026-08-23')
    // 9pm tomorrow is one day away, even though it is 33 hours off.
    expect(calendarDaysUntil(new Date(2026, 7, 24, 21, 0, 0).toISOString())).toBe(1)
    // 1am today is still today, even though it has passed.
    expect(calendarDaysUntil(new Date(2026, 7, 23, 1, 0, 0).toISOString())).toBe(0)
  })

  it('goes negative for a day already gone', () => {
    atNoonOn('2026-08-23')
    expect(calendarDaysUntil(new Date(2026, 7, 22, 23, 0, 0).toISOString())).toBe(-1)
  })
})

describe('dueSoonLabel', () => {
  it('has nothing to say without a date', () => {
    expect(dueSoonLabel(null)).toBeNull()
  })

  it('names today, tomorrow and the week ahead', () => {
    atNoonOn('2026-08-23')
    expect(dueSoonLabel(new Date(2026, 7, 23, 23, 0, 0).toISOString())).toBe('Due today')
    expect(dueSoonLabel(new Date(2026, 7, 24, 17, 0, 0).toISOString())).toBe('Due tomorrow')
    expect(dueSoonLabel(new Date(2026, 7, 27, 17, 0, 0).toISOString())).toBe('Due in 4 days')
  })

  it('calls anything already past overdue, including earlier today', () => {
    atNoonOn('2026-08-23')
    expect(dueSoonLabel(new Date(2026, 7, 23, 9, 0, 0).toISOString())).toBe('Overdue')
    expect(dueSoonLabel(new Date(2026, 7, 20, 9, 0, 0).toISOString())).toBe('Overdue')
  })

  it('falls back to a plain date once it is more than a week out', () => {
    atNoonOn('2026-08-23')
    const far = dueSoonLabel(new Date(2026, 8, 30, 17, 0, 0).toISOString())
    expect(far).not.toMatch(/days|today|tomorrow/i)
  })
})

describe('projectBurn', () => {
  it('is done when every task is finished', () => {
    expect(projectBurn({ task_count: 8, done_count: 8, days_active: 5, days_left: 3 })).toEqual({
      state: 'done',
    })
  })

  it('reports no rate rather than a rate of zero before anything is finished', () => {
    // Zero would read as "moving very slowly" instead of "not moving yet".
    const b = projectBurn({ task_count: 8, done_count: 0, days_active: 4, days_left: 6 })
    expect(b.state).toBe('not_started')
  })

  it('also reports no rate when no days have passed', () => {
    expect(projectBurn({ task_count: 8, done_count: 2, days_active: 0, days_left: 6 }).state).toBe(
      'not_started',
    )
  })

  it('projects a finish and says whether it fits the deadline', () => {
    // 4 done in 4 days = 1/day, 4 left, 6 days available: it fits.
    const b = projectBurn({ task_count: 8, done_count: 4, days_active: 4, days_left: 6 })
    expect(b).toMatchObject({ state: 'projected', rate: 1, remaining: 4, daysNeeded: 4, fits: true })
  })

  it('says it does not fit when the rate is too slow', () => {
    // 2 done in 8 days = 0.25/day, 6 left needs 24 days, only 5 available.
    const b = projectBurn({ task_count: 8, done_count: 2, days_active: 8, days_left: 5 })
    expect(b).toMatchObject({ state: 'projected', daysNeeded: 24, fits: false })
  })

  it('rounds days needed up, because a part day is another day', () => {
    // 3 done in 4 days = 0.75/day, 2 remaining needs 2.67 days.
    expect(
      projectBurn({ task_count: 5, done_count: 3, days_active: 4, days_left: 10 }),
    ).toMatchObject({ daysNeeded: 3 })
  })

  it('projects without a verdict when the project has no deadline', () => {
    const b = projectBurn({ task_count: 8, done_count: 4, days_active: 4, days_left: null })
    expect(b.state).toBe('no_deadline')
    expect(b).not.toHaveProperty('fits')
  })

  it('never reports negative work remaining', () => {
    const b = projectBurn({ task_count: 3, done_count: 5, days_active: 4, days_left: 2 })
    expect(b).toEqual({ state: 'done' })
  })
})

describe('boardOwnerName', () => {
  it('names the group, then the student, then falls back', () => {
    expect(boardOwnerName({ group_name: 'Group 1', student_name: 'Ana' })).toBe('Group 1')
    expect(boardOwnerName({ group_name: null, student_name: 'Ana' })).toBe('Ana')
    expect(boardOwnerName({ group_name: null, student_name: null })).toBe('One student')
  })
})

describe('fullName and initials', () => {
  it('leaves out a missing middle name without doubling the space', () => {
    expect(fullName({ first_name: 'Ana', middle_name: null, last_name: 'Cruz' })).toBe('Ana Cruz')
    expect(fullName({ first_name: 'Ana', middle_name: 'Rosa', last_name: 'Cruz' })).toBe(
      'Ana Rosa Cruz',
    )
  })

  it('gives a placeholder rather than an empty badge', () => {
    expect(initials({ first_name: 'Ana', last_name: 'Cruz' })).toBe('AC')
    expect(initials({ first_name: '', last_name: '' })).toBe('?')
  })
})
