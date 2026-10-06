// src/components/tasks/classWorkSource.ts
import {
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import { addTask } from '../../lib/api/tasks'
import { canPlanBoard, fullName, isBoardSubmitted } from '../../lib/types'
import type { WorkSource } from '../../lib/work/types'
import type { ProjectTasks } from './useProjectTasks'

/**
 * One group's board as Backlog and Sprints see it. The group plans while the
 * board is open; the professor follows along. Null with no board in view.
 */
export function classWorkSource(t: ProjectTasks, viewerId: string | undefined): WorkSource | null {
  const board = t.active
  if (!board) return null
  const home = { kind: 'class', boardId: board.id } as const
  const canPlan = !t.isProfessor && canPlanBoard(board, t.locked)
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await t.refresh()
    return result
  }

  return {
    items: t.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      due_at: task.due_at,
      done_at: task.done_at,
      sprint_id: task.sprint_id,
      milestone_id: task.milestone_id,
      rank: task.rank,
      holders: task.assignees.flatMap((a) => (a.profile ? [fullName(a.profile)] : [])),
      created_at: task.created_at,
    })),
    sprints: t.sprints,
    canPlan,
    canAdd: canPlan && Boolean(viewerId),
    readOnlyReason: t.isProfessor
      ? 'Each group plans its own sprints. You can follow along here.'
      : t.locked
        ? 'This project is closed, so planning is paused.'
        : isBoardSubmitted(board)
          ? 'This board is handed in, so planning is paused. Take it back to change the plan.'
          : '',
    openTask: (id) => t.showTask(id),
    createSprint: (input) => then(createSprint(home, input)),
    updateSprint: (id, input) => then(updateSprint(home, id, input)),
    deleteSprint: (id) => then(deleteSprint(home, id)),
    startSprint: (id) => then(startSprint(home, id)),
    finishSprint: (id, carryTo) => then(finishSprint(home, id, carryTo)),
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addToBacklog: async (title) => {
      if (!viewerId) return
      await then(addTask(board.id, { title, details: '', weight: 1, dueAt: null }, viewerId))
    },
  }
}
