import { describe, expect, it } from 'vitest'
import { legacySheet, parseWorkbook, serializeWorkbook } from './sheet'
import type { Workbook } from './sheet'
import { sheetCellChanges } from './sheetCellChanges'

const after: Workbook = { sheets: [{ name: 'Sheet 1', rows: [['a', 'new']] }] }

describe('a converted sheet replaced by an exact upload', () => {
  it('compares cell by cell, not as every sheet added', () => {
    const before = parseWorkbook(serializeWorkbook({ sheets: [{ name: 'Sheet 1', rows: [['a', 'old']] }] }))
    expect(sheetCellChanges(before, after)).toEqual([{ sheet: 'Sheet 1', cell: 'B1', before: 'old', after: 'new' }])
  })
  it('reads stored content, and nothing from an empty file', () => {
    expect(legacySheet(JSON.stringify({ sheets: [{ name: 'S', rows: [['x']] }] }))?.sheets[0].rows).toEqual([['x']])
    expect(legacySheet('')).toBeNull()
  })
})
