import { describe, expect, it } from 'vitest'
import { dateRange, formatDay, fromLocalInput, isOverdue, toLocalInput } from './dates'

describe('formatDay', () => {
  it('shows a calendar day without shifting it across a timezone', () => {
    expect(formatDay('2026-10-01')).toBe('Oct 1, 2026')
  })
})

describe('dateRange', () => {
  it('says whichever ends are set', () => {
    expect(dateRange('2026-10-01', '2026-10-05')).toBe('Oct 1, 2026 – Oct 5, 2026')
    expect(dateRange('2026-10-01', null)).toBe('Starts Oct 1, 2026')
    expect(dateRange(null, '2026-10-05')).toBe('Ends Oct 5, 2026')
    expect(dateRange(null, null)).toBe('No dates set')
  })
})

describe('isOverdue', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()

  it('is overdue only past its date and not done', () => {
    expect(isOverdue(new Date(2026, 9, 9).toISOString(), 'todo', now)).toBe(true)
    expect(isOverdue(new Date(2026, 9, 9).toISOString(), 'done', now)).toBe(false)
    expect(isOverdue(new Date(2026, 9, 11).toISOString(), 'todo', now)).toBe(false)
    expect(isOverdue(null, 'todo', now)).toBe(false)
  })
})

describe('local datetime inputs', () => {
  it('round-trips through the input format', () => {
    const iso = new Date(2026, 9, 10, 14, 30).toISOString()
    expect(toLocalInput(iso)).toBe('2026-10-10T14:30')
    expect(fromLocalInput('2026-10-10T14:30')).toBe(iso)
  })

  it('reads an empty input as no date', () => {
    expect(toLocalInput(null)).toBe('')
    expect(fromLocalInput('')).toBeNull()
  })

  it('reads a half-written value as no date rather than throwing', () => {
    expect(fromLocalInput('2026-10-10')).toBeNull()
    expect(fromLocalInput('T14:30')).toBeNull()
    expect(fromLocalInput('not a date')).toBeNull()
    expect(fromLocalInput('2026-10-10Tnope')).toBeNull()
  })
})
