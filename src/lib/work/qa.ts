import { stageIndex, stagesOf } from '../stages'
import type { StageStatus } from '../stages'
import type { ProjectRole } from '../general/permissions'

/** A middle stage's 0-based index by name, ignoring case and spaces; -1 when it is not one. */
function middleIndex(list: readonly string[], name: string | null): number {
  if (name === null) return -1
  const want = name.trim().toLowerCase()
  return list.findIndex((s, i) => i > 0 && i < list.length - 1 && s.trim().toLowerCase() === want)
}

/**
 * The stage QA passes tasks out of, 0-based: the stage `qaStage` names, else
 * a stage named Testing, else the one before the last. Mirrors
 * general_qa_stage_index (supabase/project-qa.sql).
 */
export function qaStageIndex(stages: readonly string[] | null | undefined, qaStage: string | null | undefined): number {
  const list = stagesOf(stages)
  const named = middleIndex(list, qaStage ?? null)
  if (named >= 0) return named
  const testing = middleIndex(list, 'Testing')
  return testing >= 0 ? testing : list.length - 2
}

/** Whether a task sits on its project's QA stage. */
export function inQa(
  task: { status: StageStatus; stage?: number | null },
  stages: readonly string[] | null | undefined,
  qaStage: string | null | undefined,
): boolean {
  const n = stagesOf(stages).length
  return stageIndex(task.status, task.stage, n) === qaStageIndex(stages, qaStage)
}

/**
 * The QA stage selection after the stage list changes in the editor. A renamed
 * stage carries its selection to the new name; a reordered list keeps it; a
 * removed stage, one moved to the first or last place, or a whole new list
 * lets it go (null), as the database clears a QA stage that is no longer a
 * middle stage.
 */
export function carryQaStage(
  prev: readonly string[] | null | undefined,
  next: readonly string[] | null | undefined,
  qaStage: string | null,
): string | null {
  if (qaStage === null) return null
  const before = stagesOf(prev)
  const after = stagesOf(next)
  if (middleIndex(after, qaStage) >= 0) return qaStage
  const at = middleIndex(before, qaStage)
  if (at < 0 || before.length !== after.length) return null
  // A rename changes exactly the selected stage and nothing else.
  const changed = after.flatMap((s, i) => (s === before[i] ? [] : [i]))
  return changed.length === 1 && changed[0] === at ? after[at] : null
}

/** Said where a control is hidden or disabled because the project's QA gate refuses it. */
export const QA_PASSES = 'QA passes tasks in this project.'

/** Whether the QA gate applies to this person: the project has QA and they are neither QA nor the project manager. */
export function qaGated(gate: { hasQa: boolean; role: ProjectRole | null }): boolean {
  return gate.hasQa && gate.role !== 'qa' && gate.role !== 'pm'
}

/**
 * Whether the QA gate refuses this move for the viewer. In a project with
 * active QA, crossing the QA stage (from it or before it to a stage after it)
 * goes only by the project manager, or by QA from the QA stage itself. Moves
 * among the stages after QA, and moves back, are not crossings. Mirrors the
 * gate in sync_general_task_stage (supabase/project-qa.sql); the database
 * decides, this only keeps the app from offering what it refuses.
 */
export function qaBlocks(
  gate: { hasQa: boolean; role: ProjectRole | null },
  stages: readonly string[] | null | undefined,
  qaStage: string | null | undefined,
  from: number,
  to: number,
): boolean {
  if (!gate.hasQa || gate.role === 'pm') return false
  const qa = qaStageIndex(stages, qaStage)
  const crosses = from <= qa && to > qa
  return crosses && !(gate.role === 'qa' && from === qa)
}

/**
 * The QA queue's order: the task that has waited longest first. A task with no
 * entry time (it was already in QA before qa_entered_at existed) goes last, in
 * the order it came. Returns a new array.
 */
export function queueOrder<T extends { qa_entered_at?: string | null }>(tasks: readonly T[]): T[] {
  const at = (t: T) => (t.qa_entered_at ? new Date(t.qa_entered_at).getTime() : null)
  return [...tasks].sort((a, b) => {
    const x = at(a)
    const y = at(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return x - y
  })
}

/** How long a task has sat in QA, as a line under its title. */
export function waitedFor(enteredAt: string | null | undefined, now: number): string {
  if (!enteredAt) return 'Waiting since before the queue kept time'
  const hours = Math.floor(Math.max(0, now - new Date(enteredAt).getTime()) / 3_600_000)
  if (hours < 1) return 'Waiting under an hour'
  if (hours < 24) return `Waiting ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `Waiting ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Whether the person is QA on any live project, so Home has a queue to ask after. */
export function holdsQa(projects: readonly { my_role: ProjectRole | null; archived_at: string | null }[] | null | undefined): boolean {
  return (projects ?? []).some((p) => p.my_role === 'qa' && !p.archived_at)
}

/** One row of my_qa_queue(): a work project where the caller is QA. */
export type QaQueueRow = {
  project_id: string
  name: string
  qa_stage_name: string
  waiting: number
  oldest_entered_at: string | null
}

/**
 * Home's "Waiting for QA" figures: everything waiting across the caller's
 * projects, and the project with the most waiting (the first of them when
 * tied), which the tile links to. Null when nothing is waiting anywhere.
 */
export function qaTile(rows: readonly QaQueueRow[]): { total: number; busiest: QaQueueRow | null } {
  const total = rows.reduce((n, r) => n + r.waiting, 0)
  const busiest = rows.reduce<QaQueueRow | null>((best, r) => (r.waiting > (best?.waiting ?? 0) ? r : best), null)
  return { total, busiest }
}
