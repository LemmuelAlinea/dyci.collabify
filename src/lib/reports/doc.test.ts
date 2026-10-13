import { describe, expect, it } from 'vitest'
import { cellExport, cellText, columnHeader, tableBlocks } from './doc'
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
