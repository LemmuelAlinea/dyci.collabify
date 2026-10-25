import type { AssignPickOut } from '../api/workAi'
import type { GeneralMember, GeneralTask } from '../general/types'

/** One drafted holder pick under review in Assign by position. */
export type AssignRow = {
  taskId: string
  keep: boolean
  title: string
  originalTitle: string
  people: string[]
  kind: 'position' | 'tag' | 'none'
  label: string
  reason: string
}

export function rowsFromPicks(picks: AssignPickOut[]): AssignRow[] {
  return picks.map((p) => ({
    taskId: p.key,
    keep: true,
    title: p.title,
    originalTitle: p.title,
    people: p.userId ? [p.userId] : [],
    kind: p.kind,
    label: p.label,
    reason: p.reason,
  }))
}

/** "Frontend developer · why", "tag: Figma · why", or "No position fits". */
export function reasonText(r: { kind: 'position' | 'tag' | 'none'; label: string; reason: string }): string {
  if (r.kind === 'none') return 'No position fits'
  const head = r.kind === 'tag' ? `tag: ${r.label}` : r.label
  const why = r.reason.trim()
  return why ? `${head} · ${why}` : head
}

/** Mirrors the candidate rule in general_assign_context: pm, coordinator or member, and active (an unreadable profile counts as live). */
export function isAssignCandidate(m: GeneralMember): boolean {
  return (m.role === 'pm' || m.role === 'coordinator' || m.role === 'member') && (!m.profile || m.profile.status === 'active')
}

/**
 * What Save writes. A kept row is skipped when its task changed during review
 * (gone, archived, done, or someone is on it now); a row that changes nothing
 * is neither written nor counted.
 */
export function planAssignSave(
  rows: AssignRow[],
  tasksNow: GeneralTask[],
): { apply: { taskId: string; title: string | null; people: string[] }[]; skipped: number } {
  const apply: { taskId: string; title: string | null; people: string[] }[] = []
  let skipped = 0
  for (const r of rows) {
    if (!r.keep) continue
    const trimmed = r.title.trim()
    const title = trimmed && trimmed !== r.originalTitle ? trimmed : null
    if (!title && r.people.length === 0) continue
    const t = tasksNow.find((x) => x.id === r.taskId)
    if (!t || t.archived_at || t.status === 'done' || t.assignee_ids.length > 0) {
      skipped++
      continue
    }
    apply.push({ taskId: r.taskId, title, people: r.people })
  }
  return { apply, skipped }
}

export function skippedMessage(n: number): string {
  if (n <= 0) return ''
  return n === 1
    ? '1 task changed while you were reviewing and was left as it is.'
    : `${n} tasks changed while you were reviewing and were left as they are.`
}

export function notesWhy(
  named: { name: string; blocked: 'qa' | 'stakeholder' | 'inactive' | null } | null,
  pick: { kind: 'position' | 'tag' | 'none'; label: string; reason: string } | null,
): string {
  if (!named) return pick ? reasonText(pick) : ''
  if (!named.blocked) return 'Named in the notes'
  const blocked = {
    qa: "QA can't hold tasks",
    stakeholder: "stakeholders can't hold tasks",
    inactive: 'not active on the project',
  }[named.blocked]
  return `Named ${named.name} (${blocked})${pick?.kind && pick.kind !== 'none' ? `, suggested by position · ${reasonText(pick)}` : ' · No position fits'}`
}
