import { describe, expect, it } from 'vitest'
import { calculateWorkbook } from './sheetCalc'
import { fromFortune, toFortune } from './sheetFortune'
import { parseWorkbook, serializeWorkbook } from './sheet'
import type { Workbook } from './sheet'

const book: Workbook = {
  sheets: [
    { name: 'Budget', rows: [['Item', 'Cost'], ['Paper', '120'], ['Ink', '80'], ['Total', '=SUM(B2:B3)'], ['Half', '=B4/2']] },
    { name: 'Other', rows: [['=Budget!B4*2', '=A1+A2'], ['=A1']] },
  ],
}

describe('calculateWorkbook', () => {
  it('works out sums, formulas of formulas and other sheets', () => {
    const r = calculateWorkbook(book)
    expect(r.get('0:3:1')).toBe(200)
    expect(r.get('0:4:1')).toBe(100)
    expect(r.get('1:0:0')).toBe(400)
  })

  it('answers a circular formula with an error instead of hanging', () => {
    expect(calculateWorkbook(book).get('1:0:1')).toBe(800)
    const r = calculateWorkbook({ sheets: [{ name: 'S', rows: [['=B1', '=A1']] }] })
    expect(r.get('0:0:0')).toBe('#REF!')
    expect(r.get('0:0:1')).toBe('#REF!')
  })

  it('reports errors as Excel names them', () => {
    const r = calculateWorkbook({ sheets: [{ name: 'S', rows: [['=NOSUCH(1)', '=Gone!A1']] }] })
    expect(r.get('0:0:0')).toBe('#NAME?')
    expect(String(r.get('0:0:1'))).toMatch(/^#/)
  })
})

describe('the grid and back', () => {
  it('keeps cells, formulas, formatting, merges, freeze and borders', () => {
    const styled: Workbook = {
      sheets: [
        {
          name: 'Grades',
          rows: [['Name', 'Score'], ['Ana', '91.5'], ['Total', '=SUM(B2:B2)']],
          styles: {
            '0:0': { bold: true, fill: '#ffff00', align: 'center' },
            '1:1': { format: '0.00', color: '#c00000', font: 'Arial', size: 14 },
          },
          cols: { '0': 140 },
          heights: { '0': 30 },
          merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
          freeze: { rows: 1, cols: 0 },
          borders: [{ r: 2, c: 1, top: { style: 'double', color: '#000000' } }],
        },
      ],
    }
    const back = fromFortune(toFortune(styled))
    expect(serializeWorkbook(back)).toBe(serializeWorkbook(styled))
  })

  it('leaves a plain sheet exactly as it was stored', () => {
    const plain = parseWorkbook('{"sheets":[{"name":"S","rows":[["a","1"],["","=A1"]]}]}')
    expect(serializeWorkbook(fromFortune(toFortune(plain)))).toBe(serializeWorkbook(plain))
  })

  it('turns toolbar border strokes into borders per cell', () => {
    const fs = toFortune({ sheets: [{ name: 'S', rows: [['a', 'b'], ['c', 'd']] }] })
    fs[0].config = {
      ...fs[0].config,
      borderInfo: [{ rangeType: 'range', borderType: 'border-outside', style: 1, color: '#000000', range: [{ row: [0, 1], column: [0, 1] }] }],
    }
    const borders = fromFortune(fs).sheets[0].borders ?? []
    expect(borders.find((b) => b.r === 0 && b.c === 0)).toMatchObject({ top: { style: 'thin' }, left: { style: 'thin' } })
    expect(borders.find((b) => b.r === 1 && b.c === 1)).toMatchObject({ bottom: { style: 'thin' }, right: { style: 'thin' } })
    expect(borders.find((b) => b.r === 0 && b.c === 0)?.bottom).toBeUndefined()
  })
})
