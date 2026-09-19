import { describe, expect, it } from 'vitest'
import {
  cellRef,
  columnName,
  describeCellChanges,
  diffWorkbooks,
  emptyWorkbook,
  parseWorkbook,
  serializeWorkbook,
  trimTrailing,
  workbookToText,
} from './sheet'
import type { Workbook } from './sheet'

const wb = (rows: string[][], name = 'Sheet 1'): Workbook => ({ sheets: [{ name, rows }] })

describe('parseWorkbook', () => {
  it('reads back what was written', () => {
    const before = wb([
      ['Item', 'Cost'],
      ['Tarpaulin', '1500'],
    ])
    expect(parseWorkbook(serializeWorkbook(before))).toEqual(before)
  })

  it('gives an empty workbook rather than throwing on rubbish', () => {
    expect(parseWorkbook('')).toEqual(emptyWorkbook())
    expect(parseWorkbook('not json')).toEqual(emptyWorkbook())
    expect(parseWorkbook('{"sheets":"nope"}')).toEqual(emptyWorkbook())
    expect(parseWorkbook('null')).toEqual(emptyWorkbook())
  })

  it('makes every cell a string, whatever was stored', () => {
    const parsed = parseWorkbook('{"sheets":[{"name":"S","rows":[[1,true,null]]}]}')
    expect(parsed.sheets[0].rows[0]).toEqual(['1', 'true', ''])
  })

  it('names a sheet that arrived without one', () => {
    expect(parseWorkbook('{"sheets":[{"rows":[[]]}]}').sheets[0].name).toBe('Sheet 1')
  })

  it('holds the size it says it holds', () => {
    const huge = { sheets: [{ name: 'S', rows: Array.from({ length: 2500 }, () => ['x']) }] }
    expect(parseWorkbook(JSON.stringify(huge)).sheets[0].rows.length).toBe(2000)
  })
})

describe('trimTrailing', () => {
  it('drops the blank rows and columns typing leaves behind', () => {
    expect(
      trimTrailing([
        ['a', 'b', '', ''],
        ['c', '', '', ''],
        ['', '', '', ''],
      ]),
    ).toEqual([
      ['a', 'b'],
      ['c', ''],
    ])
  })

  it('leaves a blank row that has something after it', () => {
    expect(trimTrailing([['a'], [''], ['b']])).toEqual([['a'], [''], ['b']])
  })

  it('reduces an empty sheet to nothing', () => {
    expect(trimTrailing([['', ''], ['']])).toEqual([])
  })
})

describe('column names', () => {
  it('counts the way a spreadsheet counts', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(27)).toBe('AB')
    expect(columnName(51)).toBe('AZ')
    expect(columnName(52)).toBe('BA')
  })

  it('names a cell the way a person would', () => {
    expect(cellRef(0, 0)).toBe('A1')
    expect(cellRef(9, 2)).toBe('C10')
  })
})

describe('diffWorkbooks', () => {
  it('finds the one cell that changed', () => {
    const changes = diffWorkbooks(wb([['Item', '1500']]), wb([['Item', '1800']]))
    expect(changes).toEqual([{ sheet: 'Sheet 1', ref: 'B1', before: '1500', after: '1800' }])
  })

  it('says nothing when nothing changed', () => {
    const same = wb([['a', 'b']])
    expect(diffWorkbooks(same, same)).toEqual([])
    expect(describeCellChanges([])).toBe('No changes')
  })

  it('reads a filled cell, an edit and a clearing apart', () => {
    const changes = diffWorkbooks(wb([['a', 'b', '']]), wb([['a', 'B', 'c']]))
    expect(describeCellChanges(changes)).toBe('2 cells: 1 filled in, 1 changed')
    expect(describeCellChanges(diffWorkbooks(wb([['a']]), wb([['']])))).toBe('1 cell: 1 cleared')
  })

  it('does not lose a sheet that only one side has', () => {
    const changes = diffWorkbooks(wb([['a']], 'Old'), wb([['b']], 'New'))
    expect(changes.map((c) => `${c.sheet} ${c.before}->${c.after}`)).toEqual([
      'Old a->',
      'New ->b',
    ])
  })

  it('finds a row added at the end', () => {
    const changes = diffWorkbooks(wb([['a']]), wb([['a'], ['b']]))
    expect(changes).toEqual([{ sheet: 'Sheet 1', ref: 'A2', before: '', after: 'b' }])
  })
})

describe('workbookToText', () => {
  it('lays a workbook out so the line diff can read it', () => {
    expect(
      workbookToText({
        sheets: [
          { name: 'Budget', rows: [['Item', 'Cost'], ['Tarpaulin', '1500']] },
          { name: 'Notes', rows: [['Ask the office']] },
        ],
      }),
    ).toBe('# Budget\nItem\tCost\nTarpaulin\t1500\n\n# Notes\nAsk the office')
  })
})
