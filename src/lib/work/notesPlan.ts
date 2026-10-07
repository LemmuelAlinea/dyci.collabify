import type { DraftedMilestone, DraftedSprint, DraftedWorkTask } from '../api/workAi'
import type { Milestone, MilestoneInput, Sprint, SprintInput } from './types'

/**
 * The plan a "Tasks from notes" draft lays out: sprints and milestones to
 * create, beside the ones the space already has. A task points at either kind
 * by key: an existing row's id, or `new:<n>` / `newm:<n>` for one this draft
 * would create. '' means none (the backlog, or untagged).
 */
export type PlanSprint = { key: string; name: string; goal: string; startsOn: string; endsOn: string; keep: boolean }
export type PlanMilestone = { key: string; name: string; description: string; dueOn: string; keep: boolean }

export type ShapedPlan = {
  sprints: PlanSprint[]
  milestones: PlanMilestone[]
  /** Each drafted task's sprint and milestone key, in task order. */
  links: { sprint: string; milestone: string }[]
  /** Sprints the draft named that the space already has open; their tasks join those. */
  reused: number
  /** Milestones the draft named that this viewer may not create, so left out. */
  skippedMilestones: number
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The earliest start and latest end among a sprint's tasks, for a sprint the text gave no dates. */
function spanOf(tasks: DraftedWorkTask[]) {
  const starts = tasks.map((t) => t.start || t.due).filter(Boolean).sort()
  const ends = tasks.map((t) => t.due || t.start).filter(Boolean).sort()
  return { startsOn: starts[0] ?? '', endsOn: ends[ends.length - 1] ?? '' }
}

export function shapePlan(
  draft: { tasks: DraftedWorkTask[]; sprints?: DraftedSprint[]; milestones?: DraftedMilestone[] },
  existing: { sprints: Sprint[]; milestones: Milestone[] },
  may: { sprints: boolean; createMilestones: boolean; tag: boolean },
): ShapedPlan {
  const sprintKey = new Map<string, string>()
  const sprints: PlanSprint[] = []
  let reused = 0
  if (may.sprints) {
    for (const s of draft.sprints ?? []) {
      // A finished sprint takes no new tasks, so only an open one is reused.
      const open = existing.sprints.find((x) => x.state !== 'completed' && same(x.name, s.name))
      if (open) {
        sprintKey.set(s.name.toLowerCase(), open.id)
        reused++
        continue
      }
      const key = `new:${sprints.length}`
      sprintKey.set(s.name.toLowerCase(), key)
      const span = spanOf(draft.tasks.filter((t) => same(t.sprint, s.name)))
      sprints.push({
        key,
        name: s.name,
        goal: s.goal,
        startsOn: s.starts_on || span.startsOn,
        endsOn: s.ends_on || span.endsOn,
        keep: true,
      })
    }
  }

  const milestoneKey = new Map<string, string>()
  const milestones: PlanMilestone[] = []
  let skippedMilestones = 0
  if (may.tag) {
    for (const m of draft.milestones ?? []) {
      const found = existing.milestones.find((x) => same(x.name, m.name))
      if (found) {
        milestoneKey.set(m.name.toLowerCase(), found.id)
      } else if (may.createMilestones) {
        const key = `newm:${milestones.length}`
        milestoneKey.set(m.name.toLowerCase(), key)
        milestones.push({ key, name: m.name, description: m.description, dueOn: m.due, keep: true })
      } else {
        skippedMilestones++
      }
    }
  }

  return {
    sprints,
    milestones,
    links: draft.tasks.map((t) => ({
      sprint: sprintKey.get(t.sprint.toLowerCase()) ?? '',
      milestone: milestoneKey.get(t.milestone.toLowerCase()) ?? '',
    })),
    reused,
    skippedMilestones,
  }
}

/** What stops the kept sprints and milestones from saving, or null. */
export function planProblem(sprints: PlanSprint[], milestones: PlanMilestone[]) {
  for (const s of sprints.filter((x) => x.keep)) {
    if (!s.name.trim()) return 'Give every sprint you keep a name.'
    if (!s.startsOn || !s.endsOn) return `Give ${s.name.trim()} a start and an end date, or leave it out.`
    if (s.endsOn < s.startsOn) return `${s.name.trim()} ends before it starts. Fix its dates.`
  }
  for (const m of milestones.filter((x) => x.keep)) {
    if (!m.name.trim()) return 'Give every milestone you keep a name.'
    if (!m.dueOn) return `Give ${m.name.trim()} a date, or leave it out.`
  }
  return null
}

/** Creates the kept sprints and milestones; returns each new key's id. */
export async function commitPlan(
  sprints: PlanSprint[],
  milestones: PlanMilestone[],
  create: {
    sprint: (input: SprintInput) => Promise<string>
    milestone: (input: MilestoneInput) => Promise<string>
  },
) {
  const ids = new Map<string, string>()
  for (const s of sprints.filter((x) => x.keep)) {
    ids.set(s.key, await create.sprint({ name: s.name, goal: s.goal, startsOn: s.startsOn, endsOn: s.endsOn }))
  }
  for (const m of milestones.filter((x) => x.keep)) {
    ids.set(m.key, await create.milestone({ name: m.name, description: m.description, dueOn: m.dueOn }))
  }
  return ids
}

/** A task's sprint or milestone id once the plan is saved. A left-out new one is none. */
export function resolveKey(key: string, created: Map<string, string>) {
  if (!key) return null
  if (key.startsWith('new')) return created.get(key) ?? null
  return key
}

/** Task ids grouped by the milestone they are tagged with. */
export function byMilestone(tagged: { taskId: string; milestoneId: string | null }[]) {
  const groups = new Map<string, string[]>()
  for (const { taskId, milestoneId } of tagged) {
    if (!milestoneId) continue
    groups.set(milestoneId, [...(groups.get(milestoneId) ?? []), taskId])
  }
  return groups
}

/** "29 tasks, 4 sprints and 1 milestone added". */
export function addedMessage(tasks: number, sprints: number, milestones: number) {
  const parts = [
    `${tasks} ${tasks === 1 ? 'task' : 'tasks'}`,
    sprints > 0 ? `${sprints} ${sprints === 1 ? 'sprint' : 'sprints'}` : '',
    milestones > 0 ? `${milestones} ${milestones === 1 ? 'milestone' : 'milestones'}` : '',
  ].filter(Boolean)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${list} added`
}

/** Midnight on a local `YYYY-MM-DD`, as ISO. Null for an empty or bad day. */
export function startOfDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00`).toISOString() : null
}

/** 11:59 pm on a local `YYYY-MM-DD`, as ISO. Null for an empty or bad day. */
export function endOfDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T23:59`).toISOString() : null
}
