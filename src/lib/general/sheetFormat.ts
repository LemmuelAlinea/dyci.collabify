/**
 * A sheet's formatting, as stored beside its cells.
 *
 * Every part is optional, so a sheet without formatting stores exactly what
 * it always did: `styles` by "row:column", column widths and row heights in
 * pixels, merged ranges, frozen rows and columns, and cell borders. Reading
 * checks every value, so a bad one is dropped rather than drawn.
 */

/** One cell's look. Absent means Excel's default. */
export type CellStyle = {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  font?: string
  /** Points. */
  size?: number
  /** "#rrggbb". */
  color?: string
  fill?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  wrap?: true
  /** An Excel number format, such as "0.00" or "₱#,##0.00". */
  format?: string
}

export type Merge = { r: number; c: number; rs: number; cs: number }
export type BorderLine = { style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'; color: string }
export type CellBorder = { r: number; c: number; top?: BorderLine; bottom?: BorderLine; left?: BorderLine; right?: BorderLine }

export type SheetFormat = {
  styles?: Record<string, CellStyle>
  /** Pixels, by column index. */
  cols?: Record<string, number>
  /** Pixels, by row index. */
  heights?: Record<string, number>
  merges?: Merge[]
  /** How many rows and columns stay put while scrolling. */
  freeze?: { rows: number; cols: number }
  borders?: CellBorder[]
}

const HEX = /^#[0-9a-f]{6}$/i
const ALIGN = ['left', 'center', 'right']
const VALIGN = ['top', 'middle', 'bottom']
const LINES = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']
const SIDES = ['top', 'bottom', 'left', 'right'] as const

const num = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined

export const styleKey = (r: number, c: number) => `${r}:${c}`

function readStyle(raw: unknown): CellStyle {
  const st = (raw ?? {}) as Record<string, unknown>
  const out: CellStyle = {}
  if (st.bold === true) out.bold = true
  if (st.italic === true) out.italic = true
  if (st.underline === true) out.underline = true
  if (st.strike === true) out.strike = true
  if (typeof st.font === 'string' && st.font.length > 0 && st.font.length <= 64) out.font = st.font
  const size = num(st.size, 4, 144)
  if (size) out.size = size
  if (typeof st.color === 'string' && HEX.test(st.color)) out.color = st.color.toLowerCase()
  if (typeof st.fill === 'string' && HEX.test(st.fill)) out.fill = st.fill.toLowerCase()
  if (typeof st.align === 'string' && ALIGN.includes(st.align)) out.align = st.align as CellStyle['align']
  if (typeof st.valign === 'string' && VALIGN.includes(st.valign)) out.valign = st.valign as CellStyle['valign']
  if (st.wrap === true) out.wrap = true
  if (typeof st.format === 'string' && st.format.length > 0 && st.format.length <= 64) out.format = st.format
  return out
}

function readLine(raw: unknown): BorderLine | undefined {
  const l = raw as BorderLine | undefined
  return l && LINES.includes(l.style) && typeof l.color === 'string' && HEX.test(l.color)
    ? { style: l.style, color: l.color.toLowerCase() }
    : undefined
}

function readSizes(raw: unknown, max: number) {
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const px = num(v, 2, 2000)
      if (/^\d+$/.test(k) && Number(k) < max && px) out[k] = Math.round(px)
    }
  }
  return out
}

/** The formatting parts of a stored sheet. */
export function readFormat(s: Record<string, unknown>, limits: { rows: number; columns: number }): SheetFormat {
  const out: SheetFormat = {}
  if (s.styles && typeof s.styles === 'object') {
    const styles: Record<string, CellStyle> = {}
    for (const [k, v] of Object.entries(s.styles)) {
      const m = k.match(/^(\d+):(\d+)$/)
      if (!m || Number(m[1]) >= limits.rows || Number(m[2]) >= limits.columns) continue
      const st = readStyle(v)
      if (Object.keys(st).length) styles[k] = st
    }
    if (Object.keys(styles).length) out.styles = styles
  }
  const cols = readSizes(s.cols, limits.columns)
  if (Object.keys(cols).length) out.cols = cols
  const heights = readSizes(s.heights, limits.rows)
  if (Object.keys(heights).length) out.heights = heights
  if (Array.isArray(s.merges)) {
    const merges = (s.merges as Merge[]).filter(
      (m) =>
        m &&
        [m.r, m.c].every((n) => Number.isInteger(n) && n >= 0) &&
        [m.rs, m.cs].every((n) => Number.isInteger(n) && n >= 1) &&
        m.rs * m.cs > 1,
    )
    if (merges.length) out.merges = merges.map((m) => ({ r: m.r, c: m.c, rs: m.rs, cs: m.cs }))
  }
  const f = s.freeze as { rows?: unknown; cols?: unknown } | undefined
  const rows = num(f?.rows, 0, 50) ?? 0
  const columns = num(f?.cols, 0, 26) ?? 0
  if (rows || columns) out.freeze = { rows: Math.round(rows), cols: Math.round(columns) }
  if (Array.isArray(s.borders)) {
    const borders: CellBorder[] = []
    for (const b of s.borders as CellBorder[]) {
      if (!b || !Number.isInteger(b.r) || !Number.isInteger(b.c) || b.r < 0 || b.c < 0) continue
      const cell: CellBorder = { r: b.r, c: b.c }
      for (const side of SIDES) {
        const line = readLine(b[side])
        if (line) cell[side] = line
      }
      if (SIDES.some((side) => cell[side])) borders.push(cell)
    }
    if (borders.length) out.borders = borders
  }
  return out
}

const byCell = (a: { r: number; c: number }, b: { r: number; c: number }) => a.r - b.r || a.c - b.c

function sortKeys<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) as T
}

function sortedNumeric<T>(o: Record<string, T> | undefined): [string, T][] {
  return Object.entries(o ?? {}).sort(([a], [b]) => Number(a) - Number(b))
}

/** Formatting in a fixed order, so an unchanged sheet serialises to an identical string. */
export function writeFormat(f: SheetFormat): SheetFormat {
  const out: SheetFormat = {}
  const styles = Object.entries(f.styles ?? {})
    .filter(([, st]) => Object.keys(st).length > 0)
    .map(([k, st]) => {
      const [r, c] = k.split(':').map(Number)
      return { r, c, k, st }
    })
    .sort(byCell)
  if (styles.length) out.styles = Object.fromEntries(styles.map((x) => [x.k, sortKeys(x.st)]))
  const cols = sortedNumeric(f.cols)
  if (cols.length) out.cols = Object.fromEntries(cols)
  const heights = sortedNumeric(f.heights)
  if (heights.length) out.heights = Object.fromEntries(heights)
  if (f.merges?.length) out.merges = [...f.merges].sort(byCell).map((m) => ({ r: m.r, c: m.c, rs: m.rs, cs: m.cs }))
  if (f.freeze && (f.freeze.rows > 0 || f.freeze.cols > 0)) out.freeze = { rows: f.freeze.rows, cols: f.freeze.cols }
  if (f.borders?.length) {
    out.borders = [...f.borders].sort(byCell).map((b) => {
      const cell: CellBorder = { r: b.r, c: b.c }
      for (const side of SIDES) if (b[side]) cell[side] = { style: b[side].style, color: b[side].color }
      return cell
    })
  }
  return out
}
