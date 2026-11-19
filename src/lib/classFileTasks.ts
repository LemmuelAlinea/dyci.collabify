/**
 * Tasks a professor drafts from a file: which already reach the chosen groups,
 * which start ticked, and the label each row shows. The fit verdict comes from
 * generate-tasks (`supabase/functions/_shared/classBrief.ts`); a task the
 * check says does not fit starts unticked but is never dropped.
 */
import type { ProjectTask } from './types'

export type FileTask = { title: string; details: string; weight: number; due: string; fit: 'fits' | 'off'; fit_reason: string }
/** `touched`: the person ticked or unticked it, so a target change leaves the tick alone. */
export type FileRow = FileTask & { keep: boolean; already: boolean; touched?: boolean }

const key = (title: string) => title.trim().toLowerCase()

/**
 * Titles of set tasks that already reach the target: for every group (''), a
 * task on every board; for one group, a task on that board. A task set for
 * only some groups does not count for every group, so none silently misses it.
 * Every copy's title counts, since a group may reword its copy.
 */
export function alreadySetTitles(rows: ProjectTask[], boardCount: number, target: string): Set<string> {
  const byOrigin = new Map<string, { titles: Set<string>; boards: Set<string> }>()
  for (const r of rows) {
    if (!r.origin_id) continue
    const entry = byOrigin.get(r.origin_id) ?? { titles: new Set<string>(), boards: new Set<string>() }
    entry.titles.add(key(r.title))
    entry.boards.add(r.board_id)
    byOrigin.set(r.origin_id, entry)
  }
  const out = new Set<string>()
  for (const { titles, boards } of byOrigin.values()) {
    if (target ? boards.has(target) : boardCount > 0 && boards.size >= boardCount) titles.forEach((t) => out.add(t))
  }
  return out
}

const startsTicked = (t: FileTask, already: boolean) => t.fit !== 'off' && !already

export function fileRows(tasks: FileTask[], already: Set<string>): FileRow[] {
  return tasks.map((t) => {
    const isAlready = already.has(key(t.title))
    return { ...t, due: t.due ?? '', already: isAlready, keep: startsTicked(t, isAlready), touched: false }
  })
}

/**
 * After a target change (or a refresh of what is set): a row nobody ticked takes
 * its default again; a row the person ticked keeps the tick, unless it newly
 * becomes already set.
 */
export function retarget(rows: FileRow[], already: Set<string>): FileRow[] {
  return rows.map((r) => {
    const isAlready = already.has(key(r.title))
    const keep = !r.touched ? startsTicked(r, isAlready) : isAlready && !r.already ? false : r.keep
    return { ...r, already: isAlready, keep }
  })
}

export function fitLabel(row: { fit?: string; already?: boolean }): 'Already set' | "Doesn't fit" | 'Fits' {
  if (row.already) return 'Already set'
  return row.fit === 'off' ? "Doesn't fit" : 'Fits'
}

/**
 * A students' From notes row on a class board: a task the check says does not
 * fit starts unticked with its reason. With no verdict (an older function, or a
 * project with nothing to check against) the row stays as before, unlabelled.
 */
export function noteFitDefaults(
  task: { fit?: string; fit_reason?: string },
  classBoard: boolean,
): { keep: boolean; why: string | undefined; label: ReturnType<typeof fitLabel> | null } {
  if (!classBoard || !task.fit) return { keep: true, why: undefined, label: null }
  const off = task.fit === 'off'
  return { keep: !off, why: off && task.fit_reason ? task.fit_reason : undefined, label: fitLabel(task) }
}
