// src/components/tasks/classTimeline.ts
import type { ProjectTaskRow } from '../../lib/api/tasks'
import type { TimelineTask } from '../../lib/work/timeline'

/**
 * Class rows as timeline tasks. A professor looking across every board wants a
 * row per board, so the board is the group; anyone looking at one board wants
 * a single row.
 */
export function classTimelineTasks(rows: readonly ProjectTaskRow[], byBoard: boolean): TimelineTask[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    starts_at: r.starts_at,
    due_at: r.due_at,
    group_id: byBoard ? r.board_id : null,
  }))
}
