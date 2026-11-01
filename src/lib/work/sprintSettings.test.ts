import { describe, expect, it } from 'vitest'
import { DEFAULT_SPRINT_SETTINGS, reopenFinishNotice, startWeekdayOf } from './sprintSettings'
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

describe('reopenFinishNotice', () => {
  const on = { ...DEFAULT_SPRINT_SETTINGS, autoFinish: true }
  // 2026-11-11 is a Wednesday in Manila. +08:00 is Manila time, whatever the machine's zone.
  const at = (time: string) => new Date(`2026-11-11T${time}:00+08:00`).getTime()
  const within = 'will finish again within 15 minutes unless you move its end date.'

  it('says nothing when automatic finishing is off', () => {
    expect(reopenFinishNotice('2026-11-01', DEFAULT_SPRINT_SETTINGS, at('12:00'))).toBeNull()
  })
  it('says nothing while the end date has not passed', () => {
    expect(reopenFinishNotice('2026-11-11', on, at('23:30'))).toBeNull()
    expect(reopenFinishNotice('2026-11-20', on, at('12:00'))).toBeNull()
  })
  it('promises a finish within 15 minutes when the end date is two or more days back', () => {
    expect(reopenFinishNotice('2026-11-09', on, at('08:00'))).toContain(within)
    expect(reopenFinishNotice('2026-10-01', on, at('08:00'))).toContain(within)
  })
  it('names the set time when the end date was yesterday and it has not come', () => {
    expect(reopenFinishNotice('2026-11-10', on, at('08:59'))).toBe(
      "Automatic finishing is on and this sprint's end date has passed, so it will finish again at 9:00 AM.",
    )
  })
  it('promises a finish within 15 minutes when the end date was yesterday and the set time has come', () => {
    expect(reopenFinishNotice('2026-11-10', on, at('09:00'))).toContain(within)
    expect(reopenFinishNotice('2026-11-10', on, at('17:20'))).toContain(within)
  })
  it('reads the day and time in Manila, not the viewer zone', () => {
    // 2026-11-10 17:30 UTC is 2026-11-11 01:30 in Manila: a sprint ending the 10th ended yesterday.
    const now = new Date('2026-11-10T17:30:00Z').getTime()
    expect(reopenFinishNotice('2026-11-10', on, now)).toContain('at 9:00 AM.')
    expect(reopenFinishNotice('2026-11-11', on, now)).toBeNull()
  })
})
