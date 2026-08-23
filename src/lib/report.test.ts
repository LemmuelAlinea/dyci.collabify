import { describe, expect, it } from 'vitest'
import {
  csvMoment,
  dayLabel,
  localDay,
  pct,
  ownerName,
  reportFilename,
  termLabel,
  termWeeks,
  toCsv,
} from './report'

/**
 * These are the functions that decide what a professor hands to the program
 * office. Two of them have already been wrong in ways nobody noticed for
 * weeks, which is why the awkward cases are pinned here rather than the
 * obvious ones.
 */

describe('localDay', () => {
  it('reads a date column as a local day, not UTC midnight', () => {
    // `new Date('2026-07-20')` is UTC midnight, which is 19 July anywhere west
    // of Greenwich and 20 July here. Assert the parts, not the timestamp.
    const d = localDay('2026-07-20')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6)
    expect(d.getDate()).toBe(20)
  })

  it('ignores a time part when a timestamp is passed instead', () => {
    const d = localDay('2026-07-20T23:30:00+08:00')
    expect(d.getDate()).toBe(20)
  })
})

describe('csvMoment', () => {
  it('writes a spreadsheet-readable local time, not the raw database value', () => {
    // The defect this replaced: the raw timestamptz went into the file, Excel
    // stored it as text, and it read UTC rather than the time it happened.
    const out = csvMoment('2026-08-23T04:12:33.123456+00:00')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(out).not.toContain('T')
    expect(out).not.toContain('Z')
  })

  it('is empty for nothing, rather than "null" or "Invalid Date"', () => {
    expect(csvMoment(null)).toBe('')
    expect(csvMoment(undefined)).toBe('')
    expect(csvMoment('')).toBe('')
    expect(csvMoment('not a date')).toBe('')
  })
})

describe('toCsv', () => {
  it('starts with a byte-order mark so Excel keeps ñ', () => {
    expect(toCsv(['a'], [['Peña']]).charCodeAt(0)).toBe(0xfeff)
  })

  it('separates rows with CRLF, as RFC 4180 says', () => {
    expect(toCsv(['a'], [['1'], ['2']])).toContain('\r\n')
  })

  it('quotes a field holding a comma, and doubles a quote inside one', () => {
    const csv = toCsv(['x'], [['Cruz, Ana'], ['Group "A"']])
    expect(csv).toContain('"Cruz, Ana"')
    expect(csv).toContain('"Group ""A"""')
  })

  it('quotes a field holding a newline instead of breaking the row', () => {
    const csv = toCsv(['note'], [['line one\nline two']])
    expect(csv).toContain('"line one\nline two"')
    // Header, one data row: exactly one row separator.
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('writes an empty cell for null, never the word null', () => {
    const csv = toCsv(['a', 'b'], [['x', null]])
    expect(csv.endsWith('x,')).toBe(true)
    expect(csv).not.toContain('null')
  })

  it('keeps a value that needs no quoting unquoted', () => {
    expect(toCsv(['a'], [['plain']])).toContain('\r\nplain')
  })
})

describe('termWeeks', () => {
  it('counts the first day, so a Monday-to-Sunday term is one week', () => {
    expect(termWeeks('2026-08-03', '2026-08-09')).toBe(1)
  })

  it('rounds a part-week up, because a part week is still taught', () => {
    expect(termWeeks('2026-08-03', '2026-08-10')).toBe(2)
  })

  it('never returns zero for a single day', () => {
    expect(termWeeks('2026-08-03', '2026-08-03')).toBe(1)
  })

  it('is zero only when there are no dates at all', () => {
    expect(termWeeks(null, '2026-08-09')).toBe(0)
    expect(termWeeks('2026-08-03', null)).toBe(0)
  })
})

describe('termLabel', () => {
  it('says so plainly when the term has not been set', () => {
    expect(termLabel(null, null)).toBe('No term dates set')
    expect(termLabel('2026-08-03', null)).toBe('No term dates set')
  })

  it('joins both dates when they exist', () => {
    expect(termLabel('2026-08-03', '2026-12-19')).toContain('–')
  })
})

describe('dayLabel', () => {
  it('is empty rather than "Invalid Date" when there is no date', () => {
    expect(dayLabel(null)).toBe('')
  })

  it('prints the day it was given, not the day before', () => {
    expect(dayLabel('2026-07-20')).toContain('20')
  })
})

describe('pct', () => {
  it('is empty for null, so a blank column stays blank', () => {
    expect(pct(null)).toBe('')
  })

  it('rounds to whole per cent and accepts the string Postgres returns', () => {
    expect(pct(66.6)).toBe('67%')
    expect(pct('66.6')).toBe('67%')
    expect(pct(0)).toBe('0%')
  })
})

describe('ownerName', () => {
  it('prefers the group, falls back to the student, then to a placeholder', () => {
    expect(ownerName({ group_name: 'Group 1', board_student_name: 'Ana' })).toBe('Group 1')
    expect(ownerName({ group_name: null, board_student_name: 'Ana' })).toBe('Ana')
    expect(ownerName({ group_name: null, board_student_name: null })).toBe('A board')
  })
})

describe('reportFilename', () => {
  it('produces a name a file system accepts and a person can find again', () => {
    const name = reportFilename('class record', 'BSIT 3A — Capstone & Research')
    expect(name).toMatch(/^class-record-bsit-3a-capstone-research-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('leaves no leading or trailing dash when the subject starts with punctuation', () => {
    expect(reportFilename('term', '— Section B —')).not.toContain('--')
    expect(reportFilename('term', '— Section B —')).toContain('-section-b-')
  })
})
