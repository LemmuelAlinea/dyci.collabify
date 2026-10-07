// src/components/tasks/classWorkSource.ts
import {
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setSprintMilestone,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import { createMilestone, deleteMilestone, tagTasks, updateMilestone } from '../../lib/api/milestones'
import { addTask } from '../../lib/api/tasks'
import { boardOwnerName, canPlanBoard, fullName, isBoardSubmitted } from '../../lib/types'
import type { ProjectTask } from '../../lib/types'
import type { MilestoneSource, WorkItem, WorkSource } from '../../lib/work/types'
import type { ProjectTasks } from './useProjectTasks'

/** A class task as the planning views read it. */
export function classWorkItem(task: ProjectTask): WorkItem {
  return {
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
  }
}

/**
 * One group's board as Backlog and Sprints see it. The group plans while the
 * board is open; the professor follows along. Null with no board in view.
 */
export function classWorkSource(t: ProjectTasks, viewerId: string | undefined): WorkSource | null {
  const board = t.active
  if (!board) return null
  const home = { kind: 'class', boardId: board.id } as const
  const canPlan = !t.isProfessor && canPlanBoard(board, t.locked)
  // Reload even when the action fails: a partial write still changed rows.
  const then = async <T,>(action: Promise<T>) => {
    try {
      return await action
    } finally {
      await t.refresh()
    }
  }

  return {
    items: t.tasks.map(classWorkItem),
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

/**
 * A class project's milestones. The professor sets them and follows every
 * group; a student tags their own board's tasks while it is open.
 */
export function classMilestoneSource(t: ProjectTasks, projectId: string): MilestoneSource {
  const home = { kind: 'class', projectId } as const
  const board = t.active
  const canTag = !t.isProfessor && Boolean(board) && canPlanBoard(board, t.locked)
  // Reload even when the action fails: a partial write still changed rows.
  const then = async <T,>(action: Promise<T>) => {
    try {
      return await action
    } finally {
      await t.refresh()
    }
  }
  return {
    milestones: t.milestones,
    items: t.isProfessor ? [] : t.tasks.map(classWorkItem),
    groups: t.isProfessor
      ? (t.boards ?? []).map((b) => ({
          id: b.id,
          name: boardOwnerName(b),
          items: t.rows.filter((r) => r.board_id === b.id).map(classWorkItem),
        }))
      : [],
    canManage: t.isProfessor,
    canTag,
    sprints: t.isProfessor || !board ? [] : t.sprints,
    canMarkReached: false,
    readOnlyReason: t.isProfessor
      ? ''
      : !board
        ? ''
        : canTag
          ? ''
          : 'Your board is handed in or the project is closed, so tags are paused.',
    openTask: (id) => t.showTask(id),
    createMilestone: (input) => then(createMilestone(home, input)),
    updateMilestone: (id, input) => then(updateMilestone(home, id, input)),
    deleteMilestone: (id) => then(deleteMilestone(home, id)),
    setReached: async () => undefined,
    tag: (ids, milestoneId) => then(tagTasks(home, ids, milestoneId)),
    linkSprint: async (sprintId, milestoneId) => {
      if (!board) return
      await then(setSprintMilestone({ kind: 'class', boardId: board.id }, sprintId, milestoneId))
    },
  }
}
