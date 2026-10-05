/**
 * Works out every formula in a stored workbook.
 *
 * The workbook stores formulas, not their results, and the grid does not
 * calculate when it opens. This runs the grid's own engine
 * (`@fortune-sheet/formula-parser`) over the stored cells first, so a file
 * opens showing the same answers somebody would get by typing each formula —
 * including a formula that reads another formula, or another sheet.
 */
import { Parser } from '@fortune-sheet/formula-parser'
import type { Workbook } from './sheet'

export type CellValue = string | number | boolean | null

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** Results by "sheet:row:column", for formula cells only. */
export function calculateWorkbook(wb: Workbook): Map<string, CellValue> {
  const results = new Map<string, CellValue>()
  const working = new Set<string>()
  const sheetIndex = (name: string | null | undefined, here: number) => {
    if (!name) return here
    const i = wb.sheets.findIndex((s) => s.name.toLowerCase() === name.replace(/^'|'$/g, '').toLowerCase())
    return i
  }

  const valueAt = (s: number, r: number, c: number): CellValue => {
    const raw = wb.sheets[s]?.rows[r]?.[c] ?? ''
    if (raw.startsWith('=') && raw.length > 1) return formula(s, r, c, raw)
    if (raw === '') return null
    if (NUMBER.test(raw.trim())) return Number(raw)
    if (/^(true|false)$/i.test(raw)) return raw.toUpperCase() === 'TRUE'
    return raw
  }

  // One parser per sheet, so a bare A1 means that sheet's A1.
  const parsers = new Map<number, Parser>()
  const parserFor = (s: number) => {
    let p = parsers.get(s)
    if (p) return p
    p = new Parser()
    p.on('callCellValue', (cell, _options, done) => {
      const at = sheetIndex(cell.sheetName, s)
      if (at < 0) throw Error('#REF!')
      done(valueAt(at, cell.row.index, cell.column.index))
    })
    p.on('callRangeValue', (start, end, _options, done) => {
      const at = sheetIndex(start.sheetName, s)
      if (at < 0) throw Error('#REF!')
      const out: CellValue[][] = []
      for (let r = start.row.index; r <= end.row.index; r++) {
        const row: CellValue[] = []
        for (let c = start.column.index; c <= end.column.index; c++) row.push(valueAt(at, r, c))
        out.push(row)
      }
      done(out)
    })
    parsers.set(s, p)
    return p
  }

  function formula(s: number, r: number, c: number, raw: string): CellValue {
    const key = `${s}:${r}:${c}`
    if (results.has(key)) return results.get(key) as CellValue
    // A formula that reads itself, however indirectly, has no answer.
    if (working.has(key)) return '#REF!'
    working.add(key)
    let value: CellValue
    try {
      const { error, result } = parserFor(s).parse(raw.slice(1))
      value = error ?? plain(result)
    } catch (err) {
      value = err instanceof Error && err.message.startsWith('#') ? err.message : '#ERROR!'
    }
    working.delete(key)
    results.set(key, value)
    return value
  }

  wb.sheets.forEach((sheet, s) =>
    sheet.rows.forEach((row, r) =>
      row.forEach((raw, c) => {
        if (raw.startsWith('=') && raw.length > 1) formula(s, r, c, raw)
      }),
    ),
  )
  return results
}

function plain(result: unknown): CellValue {
  if (result === null || result === undefined) return 0
  if (result instanceof Date) return result.toISOString().slice(0, 10)
  if (Array.isArray(result)) return plain(Array.isArray(result[0]) ? result[0][0] : result[0])
  if (typeof result === 'number') return Number.isFinite(result) ? result : '#NUM!'
  if (typeof result === 'string' || typeof result === 'boolean') return result
  return String(result)
}
