import { describe, expect, it } from 'vitest'
import { sheetCellChanges } from './sheetCellChanges'
import type { Workbook } from './sheet'

const wb = (rows: string[][], name = 'Sheet 1'): Workbook => ({ sheets: [{ name, rows }] })

describe('sheetCellChanges', () => {
  it('reports a changed value', () => {
    expect(sheetCellChanges(wb([['a', 'b']]), wb([['a', 'c']]))).toEqual([{ sheet: 'Sheet 1', cell: 'B1', before: 'b', after: 'c' }])
  })
  it('reports a changed formula as written', () => {
    expect(sheetCellChanges(wb([['', '', '=SUM(A1:A3)']]), wb([['', '', '=SUM(A1:A4)']]))).toEqual([
      { sheet: 'Sheet 1', cell: 'C1', before: '=SUM(A1:A3)', after: '=SUM(A1:A4)' },
    ])
  })
  it('reports an added cell', () => {
    expect(sheetCellChanges(wb([['a']]), wb([['a'], ['x']]))).toEqual([{ sheet: 'Sheet 1', cell: 'A2', before: '', after: 'x' }])
  })
  it('reports a removed cell', () => {
    expect(sheetCellChanges(wb([['a', 'b']]), wb([['a']]))).toEqual([{ sheet: 'Sheet 1', cell: 'B1', before: 'b', after: '' }])
  })
  it('reports an added sheet as one entry', () => {
    const after: Workbook = { sheets: [...wb([['a']]).sheets, ...wb([['x', 'y']], 'New').sheets] }
    expect(sheetCellChanges(wb([['a']]), after)).toEqual([{ sheet: 'New', cell: '', before: '', after: 'Sheet' }])
  })
  it('reports a removed sheet, and names columns past Z', () => {
    expect(sheetCellChanges(wb([['a']]), { sheets: [] })).toEqual([{ sheet: 'Sheet 1', cell: '', before: 'Sheet', after: '' }])
    const wide = Array.from({ length: 28 }, () => '')
    const w2 = [...wide]
    w2[27] = 'z'
    expect(sheetCellChanges(wb([wide]), wb([w2]))[0].cell).toBe('AB1')
  })
  it('returns nothing when nothing changed', () => {
    expect(sheetCellChanges(wb([['a']]), wb([['a']]))).toEqual([])
  })
  it('returns every change, with no cap', () => {
    const before = wb(Array.from({ length: 1000 }, () => ['1']))
    const after = wb(Array.from({ length: 1000 }, () => ['2']))
    expect(sheetCellChanges(before, after)).toHaveLength(1000)
  })
})
