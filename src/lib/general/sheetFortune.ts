/**
 * The stored workbook to Fortune-sheet's model and back.
 *
 * Fortune-sheet (the Excel-like grid in the Files tab) keeps a cell as
 * `{ v, m, f, ct, bl, it, ff, fs, fc, bg, ht, vt, tb, mc }` and a sheet's
 * widths, merges and borders in `config`. The stored workbook stays our own
 * plain JSON (`sheet.ts`, `sheetFormat.ts`), so the file can be compared and
 * reviewed and never depends on this library's shape. Only what the stored
 * format keeps is carried across; the editor's toolbar offers nothing else.
 */
import type { Cell, CellWithRowAndCol, Sheet as FortuneSheet } from '@fortune-sheet/core'
import { hexOf } from './wordPage'
import { SHEET_LIMIT } from './sheet'
import type { Sheet, Workbook } from './sheet'
import { styleKey } from './sheetFormat'
import type { BorderLine, CellBorder, CellStyle, Merge } from './sheetFormat'

/** Excel's default font size, which the grid is set to as well. */
export const EXCEL_SIZE = 11

const H_ALIGN: Record<string, number> = { center: 0, left: 1, right: 2 }
const V_ALIGN: Record<string, number> = { middle: 0, top: 1, bottom: 2 }
const LINE_TO_FORTUNE: Record<BorderLine['style'], number> = { thin: 1, dotted: 3, dashed: 4, double: 7, medium: 8, thick: 13 }

function lineFromFortune(style: unknown, color: unknown): BorderLine | undefined {
  const n = Number(style)
  if (!n) return undefined
  const kind: BorderLine['style'] =
    n === 13 ? 'thick' : n === 8 ? 'medium' : n === 7 ? 'double' : n === 3 ? 'dotted' : n === 1 || n === 2 ? 'thin' : 'dashed'
  return { style: kind, color: `#${hexOf(String(color ?? '#000000')) ?? '000000'}` }
}

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** One stored cell as Fortune-sheet draws it. */
function toCell(raw: string, st: CellStyle | undefined): Cell | null {
  if (!raw && !st) return null
  const cell: Cell = {}
  if (raw.startsWith('=') && raw.length > 1) cell.f = raw
  else if (raw && NUMBER.test(raw.trim())) {
    cell.v = Number(raw)
    cell.m = raw.trim()
    cell.ct = { fa: st?.format ?? 'General', t: 'n' }
  } else if (raw) {
    cell.v = raw
    cell.m = raw
    cell.ct = { fa: st?.format ?? 'General', t: 'g' }
  }
  if (st) {
    if (st.bold) cell.bl = 1
    if (st.italic) cell.it = 1
    if (st.underline) cell.un = 1
    if (st.strike) cell.cl = 1
    if (st.font) cell.ff = st.font
    if (st.size) cell.fs = st.size
    if (st.color) cell.fc = st.color
    if (st.fill) cell.bg = st.fill
    if (st.align) cell.ht = H_ALIGN[st.align]
    if (st.valign) cell.vt = V_ALIGN[st.valign]
    if (st.wrap) cell.tb = '2'
    if (st.format && !cell.ct) cell.ct = { fa: st.format, t: 'n' }
  }
  return cell
}

export function toFortune(workbook: Workbook): FortuneSheet[] {
  return workbook.sheets.map((s, index) => {
    const width = Math.max(0, ...s.rows.map((r) => r.length))
    const celldata: CellWithRowAndCol[] = []
    const keys = new Set<string>()
    s.rows.forEach((row, r) => row.forEach((_, c) => keys.add(styleKey(r, c))))
    Object.keys(s.styles ?? {}).forEach((k) => keys.add(k))
    for (const k of keys) {
      const [r, c] = k.split(':').map(Number)
      const cell = toCell(s.rows[r]?.[c] ?? '', s.styles?.[k])
      if (cell) celldata.push({ r, c, v: cell })
    }
    const merge: Record<string, Merge> = {}
    for (const m of s.merges ?? []) {
      merge[`${m.r}_${m.c}`] = m
      for (let r = m.r; r < m.r + m.rs; r++) {
        for (let c = m.c; c < m.c + m.cs; c++) {
          let at = celldata.find((x) => x.r === r && x.c === c)
          if (!at) {
            at = { r, c, v: {} }
            celldata.push(at)
          }
          const v = (at.v ?? {}) as Cell
          v.mc = r === m.r && c === m.c ? { ...m } : { r: m.r, c: m.c }
          at.v = v
        }
      }
    }
    const borderInfo = (s.borders ?? []).map((b) => ({
      rangeType: 'cell',
      value: {
        row_index: b.r,
        col_index: b.c,
        ...(b.left ? { l: { style: LINE_TO_FORTUNE[b.left.style], color: b.left.color } } : {}),
        ...(b.right ? { r: { style: LINE_TO_FORTUNE[b.right.style], color: b.right.color } } : {}),
        ...(b.top ? { t: { style: LINE_TO_FORTUNE[b.top.style], color: b.top.color } } : {}),
        ...(b.bottom ? { b: { style: LINE_TO_FORTUNE[b.bottom.style], color: b.bottom.color } } : {}),
      },
    }))
    const flag = (o: Record<string, number> | undefined) =>
      Object.fromEntries(Object.keys(o ?? {}).map((k) => [k, 1]))
    const f = s.freeze
    return {
      name: s.name,
      id: `sheet-${index}`,
      order: index,
      status: index === 0 ? 1 : 0,
      // Start on A1, as Excel does; without it the name box reads "A1:NaN".
      luckysheet_select_save: [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }],
      row: Math.min(SHEET_LIMIT.rows, Math.max(100, s.rows.length + 50)),
      column: Math.min(SHEET_LIMIT.columns, Math.max(26, width + 10)),
      celldata,
      config: {
        merge,
        columnlen: { ...(s.cols ?? {}) },
        rowlen: { ...(s.heights ?? {}) },
        customWidth: flag(s.cols),
        customHeight: flag(s.heights),
        borderInfo,
      },
      frozen:
        f && f.rows && f.cols
          ? { type: 'rangeBoth', range: { row_focus: f.rows - 1, column_focus: f.cols - 1 } }
          : f?.rows
            ? { type: 'rangeRow', range: { row_focus: f.rows - 1, column_focus: 0 } }
            : f?.cols
              ? { type: 'rangeColumn', range: { row_focus: 0, column_focus: f.cols - 1 } }
              : undefined,
    } satisfies FortuneSheet
  })
}

/** What a person typed into a Fortune cell: its formula, or its value as text. */
function rawOf(cell: Cell): string {
  if (cell.f) return cell.f.startsWith('=') ? cell.f : `=${cell.f}`
  if (cell.ct?.t === 'inlineStr' && Array.isArray(cell.ct.s)) {
    return (cell.ct.s as { v?: unknown }[]).map((p) => String(p.v ?? '')).join('')
  }
  if (cell.v === undefined || cell.v === null) return ''
  return String(cell.v)
}

function styleOf(cell: Cell): CellStyle {
  const st: CellStyle = {}
  if (Number(cell.bl) === 1) st.bold = true
  if (Number(cell.it) === 1) st.italic = true
  if (Number(cell.un) >= 1) st.underline = true
  if (Number(cell.cl) === 1) st.strike = true
  // Calibri is the grid's default, as it is Excel's.
  if (typeof cell.ff === 'string' && cell.ff && cell.ff !== 'Calibri') st.font = cell.ff
  // 11 is Excel's size and the grid's default (`defaultFontSize` in ExcelEditor).
  if (typeof cell.fs === 'number' && cell.fs !== EXCEL_SIZE && cell.fs > 0) st.size = cell.fs
  const color = hexOf(cell.fc)
  if (color && color !== '000000') st.color = `#${color}`
  const fill = hexOf(cell.bg)
  if (fill) st.fill = `#${fill}`
  if (cell.ht !== undefined && cell.ht !== null) {
    const ht = Number(cell.ht)
    st.align = ht === 0 ? 'center' : ht === 2 ? 'right' : 'left'
  }
  if (cell.vt !== undefined && cell.vt !== null) {
    const vt = Number(cell.vt)
    st.valign = vt === 0 ? 'middle' : vt === 1 ? 'top' : 'bottom'
  }
  if (String(cell.tb) === '2') st.wrap = true
  const fa = cell.ct?.fa
  if (typeof fa === 'string' && fa && fa !== 'General' && fa !== '@') st.format = fa
  return st
}

type BorderRange = { row: number[]; column: number[] }
type BorderEntry = {
  rangeType?: string
  borderType?: string
  style?: unknown
  color?: unknown
  range?: BorderRange[]
  value?: { row_index: number; col_index: number; l?: { style: unknown; color: unknown }; r?: { style: unknown; color: unknown }; t?: { style: unknown; color: unknown }; b?: { style: unknown; color: unknown } }
}

/** Fortune's border records — per cell, or a toolbar stroke over a range — as one border per cell. */
function bordersOf(info: unknown[] | undefined): CellBorder[] {
  const at = new Map<string, CellBorder>()
  const cell = (r: number, c: number) => {
    const k = styleKey(r, c)
    let b = at.get(k)
    if (!b) {
      b = { r, c }
      at.set(k, b)
    }
    return b
  }
  const set = (r: number, c: number, side: 'top' | 'bottom' | 'left' | 'right', line: BorderLine | undefined) => {
    const b = cell(r, c)
    if (line) b[side] = line
    else delete b[side]
  }
  for (const entry of (info ?? []) as BorderEntry[]) {
    if (entry.rangeType === 'cell' && entry.value) {
      const v = entry.value
      if (v.l) set(v.row_index, v.col_index, 'left', lineFromFortune(v.l.style, v.l.color))
      if (v.r) set(v.row_index, v.col_index, 'right', lineFromFortune(v.r.style, v.r.color))
      if (v.t) set(v.row_index, v.col_index, 'top', lineFromFortune(v.t.style, v.t.color))
      if (v.b) set(v.row_index, v.col_index, 'bottom', lineFromFortune(v.b.style, v.b.color))
      continue
    }
    const line = entry.borderType === 'border-none' ? undefined : lineFromFortune(entry.style, entry.color)
    for (const range of entry.range ?? []) {
      const [r1, r2] = range.row
      const [c1, c2] = range.column
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const top = r === r1
          const bottom = r === r2
          const left = c === c1
          const right = c === c2
          switch (entry.borderType) {
            case 'border-all':
            case 'border-none':
              ;(['top', 'bottom', 'left', 'right'] as const).forEach((side) => set(r, c, side, line))
              break
            case 'border-outside':
              if (top) set(r, c, 'top', line)
              if (bottom) set(r, c, 'bottom', line)
              if (left) set(r, c, 'left', line)
              if (right) set(r, c, 'right', line)
              break
            case 'border-inside':
              if (!bottom) set(r, c, 'bottom', line)
              if (!right) set(r, c, 'right', line)
              break
            case 'border-horizontal':
              if (!bottom) set(r, c, 'bottom', line)
              break
            case 'border-vertical':
              if (!right) set(r, c, 'right', line)
              break
            case 'border-top':
              if (top) set(r, c, 'top', line)
              break
            case 'border-bottom':
              if (bottom) set(r, c, 'bottom', line)
              break
            case 'border-left':
              if (left) set(r, c, 'left', line)
              break
            case 'border-right':
              if (right) set(r, c, 'right', line)
              break
            default:
              break
          }
        }
      }
    }
  }
  return [...at.values()].filter((b) => b.top || b.bottom || b.left || b.right)
}

export function fromFortune(sheets: FortuneSheet[]): Workbook {
  const ordered = [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, SHEET_LIMIT.sheets)
  return {
    sheets: ordered.map((fs): Sheet => {
      const rows: string[][] = []
      const styles: Record<string, CellStyle> = {}
      const visit = (r: number, c: number, cell: Cell | null | undefined) => {
        if (!cell || r >= SHEET_LIMIT.rows || c >= SHEET_LIMIT.columns) return
        const raw = rawOf(cell).slice(0, SHEET_LIMIT.cell)
        if (raw) {
          while (rows.length <= r) rows.push([])
          while (rows[r].length <= c) rows[r].push('')
          rows[r][c] = raw
        }
        const st = styleOf(cell)
        if (Object.keys(st).length) styles[styleKey(r, c)] = st
      }
      if (fs.data) fs.data.forEach((row, r) => row?.forEach((cell, c) => visit(r, c, cell)))
      else (fs.celldata ?? []).forEach((x) => visit(x.r, x.c, x.v))
      const width = Math.max(0, ...rows.map((r) => r.length))
      const grid = rows.map((r) => [...r, ...new Array(width - r.length).fill('')])

      const config = fs.config ?? {}
      const pick = (sizes: Record<string, number> | undefined, custom: Record<string, number> | undefined, max: number) =>
        Object.fromEntries(
          Object.entries(sizes ?? {}).filter(([k, v]) => custom?.[k] && Number(k) < max && v > 0).map(([k, v]) => [k, Math.round(v)]),
        )
      const merges = Object.values(config.merge ?? {}).filter((m) => m.rs * m.cs > 1)
      const frozen = fs.frozen
      const focus = frozen?.range
      const freeze =
        frozen?.type === 'row'
          ? { rows: 1, cols: 0 }
          : frozen?.type === 'column'
            ? { rows: 0, cols: 1 }
            : frozen?.type === 'both'
              ? { rows: 1, cols: 1 }
              : frozen?.type === 'rangeRow' && focus
                ? { rows: focus.row_focus + 1, cols: 0 }
                : frozen?.type === 'rangeColumn' && focus
                  ? { rows: 0, cols: focus.column_focus + 1 }
                  : frozen?.type === 'rangeBoth' && focus
                    ? { rows: focus.row_focus + 1, cols: focus.column_focus + 1 }
                    : undefined
      const sheet: Sheet = { name: fs.name, rows: grid }
      if (Object.keys(styles).length) sheet.styles = styles
      const cols = pick(config.columnlen, config.customWidth, SHEET_LIMIT.columns)
      if (Object.keys(cols).length) sheet.cols = cols
      const heights = pick(config.rowlen, config.customHeight, SHEET_LIMIT.rows)
      if (Object.keys(heights).length) sheet.heights = heights
      if (merges.length) sheet.merges = merges.map((m) => ({ r: m.r, c: m.c, rs: m.rs, cs: m.cs }))
      if (freeze) sheet.freeze = freeze
      const borders = bordersOf(config.borderInfo)
      if (borders.length) sheet.borders = borders
      return sheet
    }),
  }
}
