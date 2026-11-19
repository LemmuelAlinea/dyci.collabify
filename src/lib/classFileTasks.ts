/**
 * Tasks a professor drafts from a file: which already reach the chosen groups,
 * which start ticked, and the label each row shows. The fit verdict comes from
 * generate-tasks (`supabase/functions/_shared/classBrief.ts`); a task the
 * check says does not fit starts unticked but is never dropped.
 */
import type { ProjectTask } from './types'

export type FileTask = { title: string; details: string; weight: number; due: string; fit: 'fits' | 'off'; fit_reason: string }
export type FileRow = FileTask & { keep: boolean; already: boolean }

const key = (title: string) => title.trim().toLowerCase()

/**
 * Titles of set tasks that already reach the target: for every group (''), a
 * task on every board; for one group, a task on that board. A task set for
 * only some groups does not count for every group, so none silently misses it.
 */
export function alreadySetTitles(rows: ProjectTask[], boardCount: number, target: string): Set<string> {
  const boardsOf = new Map<string, { title: string; boards: Set<string> }>()
  for (const r of rows) {
    if (!r.origin_id) continue
    const entry = boardsOf.get(r.origin_id) ?? { title: r.title, boards: new Set<string>() }
    entry.boards.add(r.board_id)
    boardsOf.set(r.origin_id, entry)
  }
  const out = new Set<string>()
  for (const { title, boards } of boardsOf.values()) {
    if (target ? boards.has(target) : boardCount > 0 && boards.size >= boardCount) out.add(key(title))
  }
  return out
}

export function fileRows(tasks: FileTask[], already: Set<string>): FileRow[] {
  return tasks.map((t) => {
    const isAlready = already.has(key(t.title))
    return { ...t, already: isAlready, keep: t.fit !== 'off' && !isAlready }
  })
}

/** After a target change: a row that newly becomes already set unticks; every other tick stays as the person left it. */
export function retarget(rows: FileRow[], already: Set<string>): FileRow[] {
  return rows.map((r) => {
    const isAlready = already.has(key(r.title))
    return { ...r, already: isAlready, keep: isAlready && !r.already ? false : r.keep }
  })
}

export function fitLabel(row: { fit?: string; already?: boolean }): 'Already set' | "Doesn't fit" | 'Fits' {
  if (row.already) return 'Already set'
  return row.fit === 'off' ? "Doesn't fit" : 'Fits'
}
