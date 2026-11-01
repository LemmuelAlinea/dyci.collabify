import { describe, expect, it } from 'vitest'
import { DEFAULT_SPRINT_SETTINGS, startWeekdayOf } from './sprintSettings'
import type { Sprint } from './types'

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: 's1',
  name: 'Sprint 1',
  goal: '',
  starts_on: '2026-10-29',
  ends_on: '2026-11-11',
  milestone_id: null,
  state: 'planned',
  archived: false,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

describe('DEFAULT_SPRINT_SETTINGS', () => {
  it('matches the table defaults', () => {
    expect(DEFAULT_SPRINT_SETTINGS).toEqual({
      autoFinish: false,
      autoStart: false,
      carry: 'ask',
      lengthDays: 14,
      startWeekday: null,
      runAt: '09:00',
    })
  })
})

describe('startWeekdayOf', () => {
  it('returns the saved day', () => {
    expect(startWeekdayOf({ ...DEFAULT_SPRINT_SETTINGS, startWeekday: 2 }, [sprint()])).toBe(2)
    expect(startWeekdayOf({ ...DEFAULT_SPRINT_SETTINGS, startWeekday: 0 }, [sprint()])).toBe(0)
  })
  it('falls back to the weekday the first sprint started on', () => {
    // 2026-10-29 is a Thursday.
    const later = sprint({ id: 's2', starts_on: '2026-11-12', ends_on: '2026-11-25' })
    expect(startWeekdayOf(DEFAULT_SPRINT_SETTINGS, [later, sprint()])).toBe(4)
  })
  it('is Monday when there are no sprints', () => {
    expect(startWeekdayOf(DEFAULT_SPRINT_SETTINGS, [])).toBe(1)
  })
})
