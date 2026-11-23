// Shared by the work-ai `leave` action and its Vitest suite: who the model may
// suggest for a leave's tasks, and what of its answer can be trusted.

export type LeaveAction = 'keep' | 'move_due' | 'cover' | 'reassign'

/** One suggestion for one task of a leave, with ids the app knows. */
export type LeaveSuggestion = {
  task_id: string
  action: LeaveAction
  person_id: string | null
  due_on: string | null
  reason: string
}

/** A person as the suggestion context returns them. */
export type LeavePerson = { user_id: string; skills: string[]; free_minutes: number | null; away: boolean }

/** A person as the model sees them: an opaque key, skills and free time, never a name. */
export type LeaveCandidate = { key: string; userId: string; skills: string[]; freeMinutes: number | null }

const ACTIONS: readonly LeaveAction[] = ['keep', 'move_due', 'cover', 'reassign']
const DAY = 86_400_000

/** The people who may be suggested, keyed c1, c2… in order. Someone away too is left out. */
export function leaveCandidates(people: LeavePerson[]): LeaveCandidate[] {
  return people
    .filter((p) => !p.away)
    .map((p, i) => ({ key: `c${i + 1}`, userId: p.user_id, skills: p.skills ?? [], freeMinutes: p.free_minutes }))
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/**
 * The model's answer as suggestions the app can apply. A row is dropped when
 * its task is unknown or already has a suggestion, when a cover or reassign
 * names nobody it was given, or when a new due date is not after the leave or
 * is more than 90 days from today.
 */
export function validateLeaveSuggestions(
  raw: unknown,
  ctx: { tasks: { key: string; taskId: string }[]; people: { key: string; userId: string }[]; leaveLast: string; today: string },
): LeaveSuggestion[] {
  const rows = raw && typeof raw === 'object' ? (raw as { suggestions?: unknown }).suggestions : null
  if (!Array.isArray(rows)) return []
  const taskOf = new Map(ctx.tasks.map((t) => [t.key, t.taskId]))
  const personOf = new Map(ctx.people.map((p) => [p.key, p.userId]))
  const latest = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 90 * DAY).toISOString().slice(0, 10)
  const seen = new Set<string>()
  const out: LeaveSuggestion[] = []

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const taskId = taskOf.get(String(r.task ?? '').trim().toLowerCase())
    const action = String(r.action ?? '') as LeaveAction
    if (!taskId || seen.has(taskId) || !ACTIONS.includes(action)) continue

    let personId: string | null = null
    let dueOn: string | null = null
    if (action === 'cover' || action === 'reassign') {
      personId = personOf.get(String(r.person ?? '').trim().toLowerCase()) ?? null
      if (!personId) continue
    }
    if (action === 'move_due') {
      if (!isDay(r.due_on) || r.due_on <= ctx.leaveLast || r.due_on > latest) continue
      dueOn = r.due_on
    }
    seen.add(taskId)
    out.push({ task_id: taskId, action, person_id: personId, due_on: dueOn, reason: String(r.reason ?? '').trim().slice(0, 200) })
  }
  return out
}
