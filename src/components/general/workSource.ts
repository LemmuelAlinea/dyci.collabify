// src/components/general/workSource.ts
import {
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import type { SprintHome } from '../../lib/api/sprints'
import { createTask } from '../../lib/api/general'
import type { WorkSource } from '../../lib/work/types'
import type { GeneralProjectState } from './useGeneralProject'

/** A work project as Backlog and Sprints see it. Owners and Managers plan; members add. */
export function generalWorkSource(state: GeneralProjectState, openTask: (id: string) => void): WorkSource {
  const project = state.project
  const home: SprintHome = { kind: 'work', projectId: project?.id ?? '' }
  const live = Boolean(project) && !state.archived
  const canPlan = live && state.can('manage_tasks')
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await state.reload()
    return result
  }

  return {
    items: state.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due_at: t.due_at,
      done_at: t.completed_at,
      sprint_id: t.sprint_id,
      rank: t.rank,
      holders: t.assignee_ids.map((id) => state.nameOf(id)),
      created_at: t.created_at,
    })),
    sprints: state.sprints,
    canPlan,
    canAdd: live,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : canPlan
        ? ''
        : 'Owners and Managers plan the sprints. You can follow the plan and add tasks to the backlog.',
    openTask,
    createSprint: (input) => then(createSprint(home, input)),
    updateSprint: (id, input) => then(updateSprint(home, id, input)),
    deleteSprint: (id) => then(deleteSprint(home, id)),
    startSprint: (id) => then(startSprint(home, id)),
    finishSprint: (id, carryTo) => then(finishSprint(home, id, carryTo)),
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addToBacklog: (title) =>
      then(
        createTask({ projectId: home.projectId, title, description: '', dueAt: null, startsAt: null, teamId: null }).then(
          () => undefined,
        ),
      ),
  }
}
