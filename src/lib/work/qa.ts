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
 * active QA, only QA and the project manager move a task out of the QA stage
 * forward, or into the last stage from anywhere else. Mirrors the gate in
 * sync_general_task_stage (supabase/project-qa.sql); the database decides, this
 * only keeps the app from offering what it refuses.
 */
export function qaBlocks(
  gate: { hasQa: boolean; role: ProjectRole | null },
  stages: readonly string[] | null | undefined,
  qaStage: string | null | undefined,
  from: number,
  to: number,
): boolean {
  if (!qaGated(gate)) return false
  const last = stagesOf(stages).length - 1
  const qa = qaStageIndex(stages, qaStage)
  return (from === qa && to > qa) || (to === last && from !== last)
}
