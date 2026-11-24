// Suggest stages: the checks Collabify runs on the model's placement before a
// planner sees it, and the totals the review shows as tasks move. Plain
// TypeScript, shared by the work-ai Edge Function and the app.
// Spec: docs/superpowers/specs/2026-11-24-stage-suggestions-design.md

export type StageSlot = {
  key: string
  id: string | null
  starts_on: string
  ends_on: string
  capacity_minutes: number
  milestone_id: string | null
  buffer: boolean
}

export type StageTask = {
  id: string
  key: string
  title: string
  minutes: number | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  rank: number
  due_on: string | null
  milestone_id: string | null
  depends_on: string[]
}

export type StageMilestone = { id: string; key: string; name: string; due_on: string }

/** late: can't meet its milestone or due date; overdue: already due; over_hours: kept in a full stage by a date. */
export type StageFlag = 'wont_fit' | 'late' | 'overdue' | 'over_hours'

/** `stage` is a slot index; null keeps the task in the backlog. */
export type StagePlacement = { task_id: string; stage: number | null; flag: StageFlag | null }

/** general_stage_plan_context's answer (supabase/stage-plan.sql). */
export type StageContext = {
  blocked: string | null
  project: {
    id: string
    name: string
    description: string
    starts_on: string | null
    ends_on: string | null
    organization: 'sequential' | 'streams' | 'parallel'
    term_singular: string
    term_plural: string
  }
  length_days: number
  suggested_length_days: number
  window: { from: string; to: string | null }
  running: { id: string; name: string; ends_on: string; task_count: number }[]
  stages: (StageSlot & { milestone_lost: string | null })[]
  tasks: (StageTask & { description: string; sprint_id: string | null; dated: boolean; subtasks: number })[]
  milestones: StageMilestone[]
  total_minutes: number
  unestimated: number
  planning_count: number
  left_out: number
  shown: string
}

/** What the `stages` action returns: the context, a name and goal per slot, and the checked placement. */
export type StageDraft = {
  context: StageContext
  names: { name: string; goal: string }[]
  placement: StagePlacement[]
  note: string | null
}

const PRIORITY: Record<StageTask['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/**
 * Places every task once, in the order its dependencies allow:
 * - the model's stage (s1…) is the wish; an unknown one is the first stage, and
 *   the buffer (the last stage) is never wished for;
 * - never before a task it waits on; a task waiting on one that won't fit stays out;
 * - by its milestone (the task's, or the wished stage's) and by its due date;
 * - each stage up to its hours, higher priority first; past the last stage, out.
 */
export function checkStagePlan(
  slots: StageSlot[],
  tasks: StageTask[],
  milestones: StageMilestone[],
  wanted: Record<string, string>,
): StagePlacement[] {
  if (slots.length === 0) return tasks.map((t) => ({ task_id: t.id, stage: null, flag: 'wont_fit' }))
  const last = slots.length - 1
  const lastWish = slots[last].buffer && slots.length > 1 ? last - 1 : last
  const slotIndex = new Map(slots.map((s, i) => [s.key, i]))
  const wish = (t: StageTask) => Math.min(slotIndex.get(wanted[t.key]) ?? 0, lastWish)
  const dueOf = new Map(milestones.map((m) => [m.id, m.due_on]))
  const ids = new Set(tasks.map((t) => t.id))
  const used = slots.map(() => 0)
  const placed = new Map<string, StagePlacement>()

  const before = (a: StageTask, b: StageTask) =>
    wish(a) - wish(b) || PRIORITY[a.priority] - PRIORITY[b.priority] || a.rank - b.rank || a.id.localeCompare(b.id)
  const deps = (t: StageTask) => t.depends_on.filter((d) => ids.has(d) && d !== t.id)

  let left = [...tasks]
  while (left.length) {
    const ready = left.filter((t) => deps(t).every((d) => placed.has(d)))
    // A loop: carry on with the earliest task, so every task is placed once.
    const next = (ready.length ? ready : left).slice().sort(before)[0]
    left = left.filter((t) => t !== next)
    placed.set(next.id, place(next))
  }
  return tasks.map((t) => placed.get(t.id)!)

  function place(t: StageTask): StagePlacement {
    let flag: StageFlag | null = null
    let lower = 0
    for (const d of deps(t)) {
      const p = placed.get(d)
      if (!p) continue
      if (p.stage === null) return { task_id: t.id, stage: null, flag: 'wont_fit' }
      lower = Math.max(lower, p.stage)
    }

    // The latest stage the task may sit in, from its milestone and its due date.
    let upper: number | null = null
    const msId = t.milestone_id ?? slots[wish(t)].milestone_id
    const msDue = msId ? dueOf.get(msId) : undefined
    if (msDue) {
      const byEnd = lastIndex(slots, (s) => s.ends_on <= msDue)
      upper = byEnd ?? 0
      if (msDue < slots[0].starts_on) flag = 'overdue'
    }
    if (t.due_on) {
      const byStart = lastIndex(slots, (s) => s.starts_on <= t.due_on!)
      upper = Math.min(upper ?? last, byStart ?? 0)
      if (t.due_on < slots[0].starts_on) flag = 'overdue'
    }
    if (upper !== null && upper < lower) {
      flag = 'late'
      upper = lower
    }

    const size = t.minutes ?? 0
    const start = Math.max(lower, Math.min(wish(t), upper ?? last))
    const end = upper ?? last
    for (let i = start; i <= end; i++) {
      if (used[i] + size <= slots[i].capacity_minutes) {
        used[i] += size
        return { task_id: t.id, stage: i, flag }
      }
    }
    if (upper !== null) {
      used[upper] += size
      return { task_id: t.id, stage: upper, flag: flag ?? 'over_hours' }
    }
    return { task_id: t.id, stage: null, flag: 'wont_fit' }
  }
}

function lastIndex<T>(list: T[], ok: (item: T) => boolean): number | null {
  for (let i = list.length - 1; i >= 0; i--) if (ok(list[i])) return i
  return null
}

/** Each stage's estimated minutes, its unestimated tasks, and whether it is past its hours. */
export function stageTotals(
  slots: StageSlot[],
  tasks: Pick<StageTask, 'id' | 'minutes'>[],
  placement: StagePlacement[],
): { minutes: number; unestimated: number; over: boolean }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const totals = slots.map(() => ({ minutes: 0, unestimated: 0, over: false }))
  for (const p of placement) {
    const t = byId.get(p.task_id)
    if (p.stage === null || !t || !totals[p.stage]) continue
    if (t.minutes === null) totals[p.stage].unestimated += 1
    else totals[p.stage].minutes += t.minutes
  }
  return totals.map((x, i) => ({ ...x, over: x.minutes > slots[i].capacity_minutes }))
}

// The labels the model sees, never shown to people.
function readable(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\bt\d+\b/gi, 'a task')
    .replace(/\bs\d+\b/gi, 'a stage')
    .replace(/\bm\d+\b/gi, 'a milestone')
    .replace(/\b(c|person)\d+\b/gi, 'someone')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A stage's name: at most 60 characters, else the project's stage word and its number. */
export function stageName(raw: unknown, index: number, termSingular: string, max = 60): string {
  return readable(raw).slice(0, max).trim() || `${termSingular} ${index + 1}`
}

/** A stage's goal: at most 200 characters, possibly empty. */
export function stageGoal(raw: unknown): string {
  return readable(raw).slice(0, 200).trim()
}

/** The model's one-sentence note, at most 300 characters, or null. */
export function stageNote(raw: unknown): string | null {
  const text = readable(raw).slice(0, 300).trim()
  return text || null
}
