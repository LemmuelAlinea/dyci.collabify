/**
 * Which stage a dragged card may land on, and the small sums behind the drag.
 * The database decides; this only keeps the board from offering a drop it
 * would refuse, in the words it would refuse with. Mirrors the QA gate in
 * sync_general_task_stage (supabase/project-qa.sql) and check_general_task_rules
 * (supabase/project-task-rules.sql).
 */
import { stageIndex } from '../stages'
import type { StageStatus } from '../stages'
import { QA_PASSES } from './qa'

export type WorkDrop = {
  task: {
    status: StageStatus
    stage?: number | null
    assignee_ids: readonly string[]
    parent_id?: string | null
  }
  /** The stage it would land on, 0-based. */
  to: number
  stageCount: number
  qaBlocks: (from: number, to: number) => boolean
  /** The project's task rules; null on a class board, whose tasks have none of them. */
  rules: { requireAssignee: boolean; requireSubtasksDone: boolean } | null
  openSubtasks: number
  /** Open tasks this one waits for. */
  blockers: readonly { title: string }[]
  parentDone: boolean
}

/** Why this drop would be refused, or null when it is fine. */
export function workDropRefusal(drop: WorkDrop): string | null {
  const { task, to, stageCount, rules } = drop
  const from = stageIndex(task.status, task.stage, stageCount)
  if (drop.qaBlocks(from, to)) return QA_PASSES
  if (!rules) return null
  const last = stageCount - 1
  if (rules.requireSubtasksDone && task.parent_id && from === last && to !== last && drop.parentDone) {
    return 'Reopen the parent task before opening its subtask.'
  }
  if (rules.requireAssignee && to > from && to > 0 && task.assignee_ids.length === 0) {
    return 'Give this task a holder before moving it on.'
  }
  if (to === last && from !== last) {
    if (rules.requireSubtasksDone && drop.openSubtasks > 0) return 'Finish its subtasks first.'
    if (drop.blockers.length > 0) return `Waiting for ${drop.blockers[0].title}. Finish it first.`
  }
  return null
}

/** Where a card will sit in a column it joins: after everything the board's order puts before it. */
export function landingIndex(order: readonly string[], column: readonly string[], id: string): number {
  const at = order.indexOf(id)
  return column.filter((other) => order.indexOf(other) < at).length
}

/**
 * Auto-scroll speed in pixels per frame for a pointer at `at` in the area from
 * `start` to `end`: negative toward the start, positive toward the end, zero
 * outside the edge bands. Eased, so it starts gently.
 */
export function edgeSpeed(at: number, start: number, end: number, band = 88, max = 16): number {
  const fromStart = at - start
  const fromEnd = end - at
  const depth = fromStart < band ? band - fromStart : fromEnd < band ? band - fromEnd : 0
  if (depth === 0) return 0
  const ratio = Math.min(1, depth / band)
  return (fromStart < band ? -1 : 1) * max * ratio * ratio
}
