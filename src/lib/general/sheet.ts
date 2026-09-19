/**
 * The spreadsheet a `sheet` file holds.
 *
 * Stored as JSON rather than as a copy of the .xlsx, because a spreadsheet that
 * cannot be compared is a spreadsheet nobody can review — and reviewing is the
 * whole point of putting it here. Cells are text: what somebody typed, formula
 * and all. Nothing is evaluated, which keeps this honest about what it is.
 */

export type Sheet = { name: string; rows: string[][] }
export type Workbook = { sheets: Sheet[] }

export const SHEET_LIMIT = { sheets: 20, rows: 2000, columns: 100, cell: 5000 } as const

export function emptyWorkbook(): Workbook {
  return { sheets: [{ name: 'Sheet 1', rows: [['', '', '']] }] }
}

/**
 * Reads what was stored. Anything unrecognisable comes back as an empty
 * workbook rather than throwing — a corrupt cell must not take the page down.
 */
export function parseWorkbook(json: string): Workbook {
  if (!json.trim()) return emptyWorkbook()
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return emptyWorkbook()
  }
  const sheets = (raw as { sheets?: unknown })?.sheets
  if (!Array.isArray(sheets)) return emptyWorkbook()

  const out: Sheet[] = []
  for (const s of sheets.slice(0, SHEET_LIMIT.sheets)) {
    const name = typeof (s as Sheet)?.name === 'string' ? (s as Sheet).name : `Sheet ${out.length + 1}`
    const rows = Array.isArray((s as Sheet)?.rows) ? (s as Sheet).rows : []
    out.push({
      name,
      rows: rows.slice(0, SHEET_LIMIT.rows).map((r) =>
        (Array.isArray(r) ? r : []).slice(0, SHEET_LIMIT.columns).map((c) => String(c ?? '')),
      ),
    })
  }
  return out.length ? { sheets: out } : emptyWorkbook()
}

/** Stable key order, so an unchanged sheet produces an identical string. */
export function serializeWorkbook(wb: Workbook) {
  return JSON.stringify({
    sheets: wb.sheets.map((s) => ({ name: s.name, rows: trimTrailing(s.rows) })),
  })
}

/** Drops the blank rows and columns at the end that typing leaves behind. */
export function trimTrailing(rows: string[][]) {
  const out = rows.map((r) => [...r])
  while (out.length && out[out.length - 1].every((c) => c === '')) out.pop()
  const width = out.reduce((w, r) => {
    let last = 0
    r.forEach((c, i) => {
      if (c !== '') last = i + 1
    })
    return Math.max(w, last)
  }, 0)
  return out.map((r) => r.slice(0, width))
}

export function columnName(index: number) {
  let n = index
  let name = ''
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

export function cellRef(row: number, column: number) {
  return `${columnName(column)}${row + 1}`
}

/* ------------------------------------------------------------------- diff */

export type CellChange = {
  sheet: string
  ref: string
  before: string
  after: string
}

/**
 * Cell by cell, because "the spreadsheet changed" tells a reviewer nothing.
 *
 * A sheet that only one side has is reported as every one of its cells arriving
 * or leaving, so nothing is hidden by a rename.
 */
export function diffWorkbooks(before: Workbook, after: Workbook): CellChange[] {
  const out: CellChange[] = []
  const names = [...new Set([...before.sheets.map((s) => s.name), ...after.sheets.map((s) => s.name)])]

  for (const name of names) {
    const a = before.sheets.find((s) => s.name === name)
    const b = after.sheets.find((s) => s.name === name)
    const rows = Math.max(a?.rows.length ?? 0, b?.rows.length ?? 0)
    for (let r = 0; r < rows; r++) {
      const ar = a?.rows[r] ?? []
      const br = b?.rows[r] ?? []
      const cols = Math.max(ar.length, br.length)
      for (let c = 0; c < cols; c++) {
        const was = ar[c] ?? ''
        const now = br[c] ?? ''
        if (was !== now) out.push({ sheet: name, ref: cellRef(r, c), before: was, after: now })
      }
    }
  }
  return out
}

export function describeCellChanges(changes: CellChange[]) {
  if (changes.length === 0) return 'No changes'
  const filled = changes.filter((c) => c.before === '').length
  const cleared = changes.filter((c) => c.after === '').length
  const edited = changes.length - filled - cleared
  const parts: string[] = []
  if (filled) parts.push(`${filled} filled in`)
  if (edited) parts.push(`${edited} changed`)
  if (cleared) parts.push(`${cleared} cleared`)
  const word = changes.length === 1 ? 'cell' : 'cells'
  return `${changes.length} ${word}: ${parts.join(', ')}`
}

/** A workbook as text, so the line diff can read a spreadsheet too. */
export function workbookToText(wb: Workbook) {
  return wb.sheets
    .map((s) => [`# ${s.name}`, ...trimTrailing(s.rows).map((r) => r.join('\t'))].join('\n'))
    .join('\n\n')
}
