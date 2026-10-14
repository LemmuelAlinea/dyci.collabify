import { describe, expect, it } from 'vitest'
import { parseDueChoice, parseRangeChoice, previousRange, rangeText, resolveDueWindow, resolveRange } from './range'

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

describe('due windows', () => {
  const term = { start: '2026-08-03', end: '2026-12-12' }
  it('reads the choice from the address', () => {
    expect(parseDueChoice('term')).toBe('term')
    expect(parseDueChoice('custom')).toBe('custom')
    expect(parseDueChoice(null)).toBe('all')
    expect(parseDueChoice('toString')).toBe('all')
  })
  it('resolves every date, the term and chosen dates', () => {
    expect(resolveDueWindow('all', term, {})).toBeNull()
    expect(resolveDueWindow('term', term, {})).toEqual({ from: '2026-08-03', to: '2026-12-12' })
    expect(resolveDueWindow('term', { start: null, end: '2026-12-12' }, {})).toBeNull()
    expect(resolveDueWindow('custom', term, { from: '2026-10-31', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolveDueWindow('custom', term, { from: '2026-10-01' })).toBeNull()
  })
})
