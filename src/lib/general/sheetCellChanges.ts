import type { Workbook } from './sheet'

export type CellChange = { sheet: string; cell: string; before: string; after: string }

/** 0 as "A", 25 as "Z", 26 as "AA". */
function columnName(index: number) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * The cells that differ between two workbooks, by what was typed (a formula stays a formula).
 * A sheet that exists on one side only is one entry with an empty cell name.
 */
export function sheetCellChanges(before: Workbook | null, after: Workbook | null): CellChange[] {
  const b = new Map((before?.sheets ?? []).map((s) => [s.name, s]))
  const a = new Map((after?.sheets ?? []).map((s) => [s.name, s]))
  const changes: CellChange[] = []

  for (const name of new Set([...b.keys(), ...a.keys()])) {
    const was = b.get(name)
    const now = a.get(name)
    if (!was || !now) {
      changes.push({ sheet: name, cell: '', before: was ? 'Sheet' : '', after: now ? 'Sheet' : '' })
      continue
    }
    const rows = Math.max(was.rows.length, now.rows.length)
    for (let r = 0; r < rows; r++) {
      const cols = Math.max(was.rows[r]?.length ?? 0, now.rows[r]?.length ?? 0)
      for (let c = 0; c < cols; c++) {
        const x = was.rows[r]?.[c] ?? ''
        const y = now.rows[r]?.[c] ?? ''
        if (x !== y) changes.push({ sheet: name, cell: `${columnName(c)}${r + 1}`, before: x, after: y })
      }
    }
  }
  return changes
}
