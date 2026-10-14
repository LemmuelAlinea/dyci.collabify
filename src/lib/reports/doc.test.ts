import { describe, expect, it } from 'vitest'
import { cellExport, cellText, columnHeader, dayText, deltaText, tableBlocks } from './doc'
import type { Column, ReportDoc } from './doc'

const col = (type: Column['type'], outOf?: number): Column => ({ key: 'k', label: 'Final', type, outOf })

describe('cellText', () => {
  it('shows an empty cell as a dash', () => {
    expect(cellText(null, col('text'))).toBe('—')
    expect(cellText('', col('number'))).toBe('—')
  })
  it('formats numbers, percents and scores', () => {
    expect(cellText(84, col('number'))).toBe('84')
    expect(cellText(84.5, col('number'))).toBe('84.5')
    expect(cellText(66.666, col('percent'))).toBe('66.7%')
    expect(cellText(84.5, col('score', 100))).toBe('84.5 / 100')
    expect(cellText(84, col('score'))).toBe('84')
  })
  it('shows days and moments in Manila', () => {
    expect(cellText('2026-10-13', col('date'))).toBe('Oct 13, 2026')
    // 16:30 UTC is 00:30 the next day in Manila.
    expect(cellText('2026-10-13T16:30:00Z', col('date'))).toBe('Oct 14, 2026')
  })
  it('reads the value out of a rich cell', () => {
    expect(cellText({ value: 'Released', tone: 'success' }, col('status'))).toBe('Released')
  })
  it('shows a number to fixed places when the column asks for them', () => {
    expect(cellText(0.857, { key: 'k', label: 'Factor', type: 'number', decimals: 2 })).toBe('0.86')
    expect(cellText(1, { key: 'k', label: 'Factor', type: 'number', decimals: 2 })).toBe('1.00')
  })
  it('shows an unreadable date as it came rather than crashing', () => {
    expect(cellText('not a date', col('date'))).toBe('not a date')
    expect(cellText('not a date', col('datetime'))).toBe('not a date')
  })
})

describe('cellExport', () => {
  it('keeps numbers as numbers', () => {
    expect(cellExport(84.5, col('score', 100))).toBe(84.5)
    expect(cellExport('12', col('number'))).toBe(12)
    expect(cellExport(66.666, col('percent'))).toBe(66.7)
  })
  it('writes days as YYYY-MM-DD in Manila and moments to the minute', () => {
    expect(cellExport('2026-10-13T16:30:00Z', col('date'))).toBe('2026-10-14')
    expect(cellExport('2026-10-13T16:30:00Z', col('datetime'))).toBe('2026-10-14 00:30')
  })
  it('leaves an empty cell empty', () => {
    expect(cellExport(null, col('number'))).toBeNull()
  })
  it('keeps full precision whatever the screen shows', () => {
    expect(cellExport(0.857, { key: 'k', label: 'Factor', type: 'number', decimals: 2 })).toBe(0.857)
  })
  it('writes an unreadable date as it came rather than crashing', () => {
    expect(cellExport('not a date', col('date'))).toBe('not a date')
    expect(cellExport('not a date', col('datetime'))).toBe('not a date')
  })
})

describe('columnHeader', () => {
  it('says what a score is out of and marks percents', () => {
    expect(columnHeader(col('score', 100))).toBe('Final (of 100)')
    expect(columnHeader({ key: 'p', label: 'Share', type: 'percent' })).toBe('Share (%)')
    expect(columnHeader(col('text'))).toBe('Final')
  })
})

describe('tableBlocks', () => {
  it('lists only the tables, in order', () => {
    const doc: ReportDoc = {
      header: { title: 't', subtitle: 's', classLine: 'c', rangeLabel: null, madeAt: 'now' },
      blocks: [
        { kind: 'paragraph', text: 'p' },
        { kind: 'table', id: 'a', title: 'A', columns: [], rows: [] },
        { kind: 'note', tone: 'info', text: 'n' },
        { kind: 'table', id: 'b', title: 'B', columns: [], rows: [] },
      ],
      footer: { lines: [], signatures: [] },
    }
    expect(tableBlocks(doc).map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('deltaText', () => {
  it('signs a change and never divides', () => {
    expect(deltaText(5)).toBe('+5')
    expect(deltaText(-2)).toBe('−2')
    expect(deltaText(0)).toBe('±0')
    expect(deltaText(1.5)).toBe('+1.5')
  })
})

describe('export values and days', () => {
  const status = { key: 's', label: 'State', type: 'status' as const }
  it('exports a cell by its export value when it has one', () => {
    expect(cellExport({ value: 'Late (3 days)', tone: 'warning', exportValue: 3 }, status)).toBe(3)
    expect(cellExport({ value: 'On time', tone: 'success', exportValue: 0 }, status)).toBe(0)
    expect(cellExport({ value: 'Missing', tone: 'danger', exportValue: null }, status)).toBeNull()
    expect(cellExport({ value: 'Accepted', tone: 'success' }, status)).toBe('Accepted')
  })
  it('writes a day or a moment as a Manila day', () => {
    expect(dayText('2026-10-07')).toBe('Oct 7, 2026')
    expect(dayText('2026-10-06T17:30:00Z')).toBe('Oct 7, 2026')
    expect(dayText('not a day')).toBe('not a day')
  })
})
