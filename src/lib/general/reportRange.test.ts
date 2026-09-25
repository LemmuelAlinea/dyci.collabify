import { describe, expect, it } from 'vitest'
import { addDays, daysIn, previousPeriod, rangeLabel, resolveRange, startOfDayIn, toUtcBounds } from './reportRange'

// Thursday 25 September 2026, mid-afternoon local time.
const NOW = new Date(2026, 8, 25, 15, 0)

describe('resolveRange', () => {
  it('reads every preset from today', () => {
    expect(resolveRange('today', NOW)).toEqual({ from: '2026-09-25', to: '2026-09-25' })
    expect(resolveRange('yesterday', NOW)).toEqual({ from: '2026-09-24', to: '2026-09-24' })
    expect(resolveRange('thisWeek', NOW)).toEqual({ from: '2026-09-21', to: '2026-09-25' })
    expect(resolveRange('last7', NOW)).toEqual({ from: '2026-09-19', to: '2026-09-25' })
    expect(resolveRange('last30', NOW)).toEqual({ from: '2026-08-27', to: '2026-09-25' })
    expect(resolveRange('thisMonth', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-25' })
    expect(resolveRange('lastMonth', NOW)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveRange('all', NOW).to).toBe('2026-09-25')
  })

  it('starts the week on Monday, even on a Sunday', () => {
    expect(resolveRange('thisWeek', new Date(2026, 8, 27, 9))).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(resolveRange('thisWeek', new Date(2026, 8, 21, 9))).toEqual({ from: '2026-09-21', to: '2026-09-21' })
  })

  it('handles month and year edges', () => {
    expect(resolveRange('lastMonth', new Date(2026, 0, 10))).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolveRange('lastMonth', new Date(2024, 2, 5))).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(resolveRange('last7', new Date(2026, 0, 3))).toEqual({ from: '2025-12-28', to: '2026-01-03' })
  })

  it('uses the project dates for its duration', () => {
    expect(resolveRange('projectDuration', NOW, { starts_on: '2026-09-01', ends_on: '2026-10-15' })).toEqual({
      from: '2026-09-01',
      to: '2026-10-15',
    })
    expect(resolveRange('projectDuration', NOW, { starts_on: null, ends_on: null }).to).toBe('2026-09-25')
  })

  it('takes a custom range or a single day, and repairs a reversed one', () => {
    expect(resolveRange('custom', NOW, null, { from: '2026-09-10', to: '2026-09-12' })).toEqual({
      from: '2026-09-10',
      to: '2026-09-12',
    })
    expect(resolveRange('custom', NOW, null, { from: '2026-09-12', to: '2026-09-10' })).toEqual({
      from: '2026-09-10',
      to: '2026-09-12',
    })
    expect(resolveRange('day', NOW, null, { from: '2026-09-02' })).toEqual({ from: '2026-09-02', to: '2026-09-02' })
    expect(resolveRange('custom', NOW, null, { from: 'nonsense' }).to).toBe('2026-09-25')
  })
})

describe('previousPeriod', () => {
  it('is the same length and ends the day before', () => {
    expect(previousPeriod({ from: '2026-09-19', to: '2026-09-25' })).toEqual({ from: '2026-09-12', to: '2026-09-18' })
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-01-29', to: '2026-02-28' })
    expect(daysIn({ from: '2026-09-01', to: '2026-09-30' })).toBe(30)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('toUtcBounds', () => {
  it('turns Manila days into instants, to exclusive', () => {
    expect(toUtcBounds({ from: '2026-09-01', to: '2026-09-30' }, 'Asia/Manila')).toEqual({
      from: '2026-08-31T16:00:00.000Z',
      to: '2026-09-30T16:00:00.000Z',
    })
  })

  it('follows a clock change', () => {
    // New York moves from EST (-5) to EDT (-4) on 8 March 2026.
    expect(startOfDayIn('2026-03-07', 'America/New_York')).toBe('2026-03-07T05:00:00.000Z')
    expect(startOfDayIn('2026-03-09', 'America/New_York')).toBe('2026-03-09T04:00:00.000Z')
  })
})

describe('rangeLabel', () => {
  it('prints ranges the short way', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-30' })).toBe('1–30 Sep 2026')
    expect(rangeLabel({ from: '2026-08-30', to: '2026-09-05' })).toBe('30 Aug – 5 Sep 2026')
    expect(rangeLabel({ from: '2026-09-14', to: '2026-09-14' })).toBe('14 Sep 2026')
  })
})
