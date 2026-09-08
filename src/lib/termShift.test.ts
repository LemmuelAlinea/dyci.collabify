import { describe, expect, it } from 'vitest'

import { addDays, describeRecordedShift, describeShift, isoDay, localDay, shiftDays } from './termShift'

describe('localDay', () => {
  // `new Date('2026-07-20')` is UTC midnight, which is 19 July west of
  // Greenwich. This is the whole reason the function exists.
  it('reads a date string as the day it says, not as UTC midnight', () => {
    const d = localDay('2026-07-20')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(20)
  })

  it('ignores a timestamp tail', () => {
    expect(isoDay(localDay('2026-07-20T15:00:00Z'))).toBe('2026-07-20')
  })

  it('round-trips through isoDay', () => {
    for (const day of ['2026-01-01', '2026-12-31', '2026-02-28', '2026-07-20']) {
      expect(isoDay(localDay(day))).toBe(day)
    }
  })
})

describe('shiftDays', () => {
  it('counts a week forward', () => {
    expect(shiftDays('2026-08-10', '2026-08-17')).toBe(7)
  })

  it('is negative when the new date is earlier', () => {
    expect(shiftDays('2026-08-17', '2026-08-10')).toBe(-7)
  })

  it('is zero for the same day', () => {
    expect(shiftDays('2026-08-10', '2026-08-10')).toBe(0)
  })

  it('crosses a month boundary', () => {
    expect(shiftDays('2026-08-31', '2026-09-01')).toBe(1)
  })

  // The typhoon case that started this: three weeks, over a month boundary.
  it('counts three weeks over a month end', () => {
    expect(shiftDays('2026-10-19', '2026-11-09')).toBe(21)
  })

  // Rounding, not truncation: a DST transition inside the span makes the raw
  // division 20.958…, and truncating it would move the term a day short.
  it('survives a span containing a daylight-saving change', () => {
    expect(shiftDays('2026-03-01', '2026-04-01')).toBe(31)
    expect(shiftDays('2026-10-01', '2026-11-01')).toBe(31)
  })
})

describe('addDays', () => {
  it('adds across a month end', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('subtracts', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('is the inverse of shiftDays', () => {
    const from = '2026-07-20'
    const to = '2026-08-10'
    expect(addDays(from, shiftDays(from, to))).toBe(to)
  })
})

describe('describeShift', () => {
  it('says weeks when the shift is whole weeks', () => {
    expect(describeShift(7, 13)).toBe('Moves this and 12 later weeks 1 week later.')
    expect(describeShift(21, 13)).toBe('Moves this and 12 later weeks 3 weeks later.')
  })

  it('says days when it is not', () => {
    expect(describeShift(3, 13)).toBe('Moves this and 12 later weeks 3 days later.')
    expect(describeShift(1, 2)).toBe('Moves this and 1 later week 1 day later.')
  })

  it('says earlier for a negative shift', () => {
    expect(describeShift(-7, 5)).toBe('Moves this and 4 later weeks 1 week earlier.')
  })

  it('drops the plural when only the last week moves', () => {
    expect(describeShift(7, 1)).toBe('Moves this week 1 week later.')
  })

  // The submit button reads this, so it has to be the sentence and not a throw.
  it('names the no-op rather than pretending it is a move', () => {
    expect(describeShift(0, 13)).toBe('That is the date it already starts on.')
  })
})

describe('describeRecordedShift', () => {
  it('reads as what happened, for a student', () => {
    expect(describeRecordedShift(4, 7)).toBe('Week 4 onwards moved 1 week later')
    expect(describeRecordedShift(8, -3)).toBe('Week 8 onwards moved 3 days earlier')
  })
})
