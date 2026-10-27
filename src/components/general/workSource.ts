// src/components/general/workSource.ts
import {
  createMilestone,
  deleteMilestone,
  setMilestoneReached,
  tagTasks,
  updateMilestone,
} from '../../lib/api/milestones'
import type { MilestoneHome } from '../../lib/api/milestones'
import {
  archiveSprint,
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setSprintMilestone,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import type { SprintHome } from '../../lib/api/sprints'
import { createTask } from '../../lib/api/general'
import { canStepRank } from '../../lib/general/permissions'
import type { MilestoneSource, WorkItem, WorkSource } from '../../lib/work/types'
import type { GeneralProjectState } from './useGeneralProject'

/** A work project's tasks as the shared Work views read them. */
export function generalWorkItems(state: GeneralProjectState): WorkItem[] {
  return state.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_at: t.due_at,
    done_at: t.completed_at,
    sprint_id: t.sprint_id,
    milestone_id: t.milestone_id,
    rank: t.rank,
    holders: t.assignee_ids.map((id) => state.nameOf(id)),
    holderIds: t.assignee_ids,
    teamId: t.team_id,
    kind: t.kind,
    created_at: t.created_at,
  }))
}

/** A work project as Backlog and Sprints see it. Owners and Managers plan; members add. */
export function generalWorkSource(state: GeneralProjectState, openTask: (id: string) => void): WorkSource {
  const project = state.project
  const home: SprintHome = { kind: 'work', projectId: project?.id ?? '' }
  const live = Boolean(project) && !state.readOnly
  const canPlan = live && state.can('manage_tasks')
  // Reload even when the action fails: a partial write still changed rows.
  const then = async <T,>(action: Promise<T>) => {
    try {
      return await action
    } finally {
      await state.reload()
    }
  }

  return {
    items: generalWorkItems(state),
    sprints: state.sprints,
    canPlan,
    // A team leader reorders the tasks people they lead hold; sprint moves stay with planners.
    canStepItem: (item) => live && canStepRank(canPlan, item.holderIds, state.leadsUser),
    canAdd: live,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : state.readOnly
        ? 'Stakeholders can follow the plan but not change it.'
        : canPlan
          ? ''
          : state.teams.some((t) => t.leader_id === state.viewerId)
            ? 'Owners and Managers plan the sprints. You can follow the plan, add tasks to the backlog, and reorder the tasks the people you lead hold.'
            : 'Owners and Managers plan the sprints. You can follow the plan and add tasks to the backlog.',
    teams:
      project && state.teams.length > 0
        ? { projectId: project.id, viewerId: state.viewerId, teams: state.teams, members: state.teamMembers }
        : undefined,
    openTask,
    createSprint: (input) => then(createSprint(home, input)),
    updateSprint: (id, input) => then(updateSprint(home, id, input)),
    deleteSprint: (id) => then(deleteSprint(home, id)),
    startSprint: (id) => then(startSprint(home, id)),
    finishSprint: (id, carryTo) => then(finishSprint(home, id, carryTo)),
    archiveSprint: (id, archived) => then(archiveSprint(home, id, archived)),
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addToBacklog: (title) =>
      then(
        createTask({
          projectId: home.projectId,
          title,
          description: '',
          dueAt: null,
          startsAt: null,
          teamId: null,
          // QA creates bug tasks only.
          kind: state.myRole === 'qa' ? 'bug' : undefined,
        }).then(() => undefined),
      ),
  }
}

export function generalMilestoneSource(state: GeneralProjectState, openTask: (id: string) => void): MilestoneSource {
  const project = state.project
  const home: MilestoneHome = { kind: 'work', projectId: project?.id ?? '' }
  const can = Boolean(project) && !state.readOnly && state.can('manage_tasks')
  // Reload even when the action fails: a partial write still changed rows.
  const then = async <T,>(action: Promise<T>) => {
    try {
      return await action
    } finally {
      await state.reload()
    }
  }
  return {
    milestones: state.milestones,
    items: generalWorkItems(state),
    groups: [],
    canManage: can,
    canTag: can,
    sprints: state.sprints,
    canMarkReached: can,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : state.readOnly
        ? 'Stakeholders can follow the plan but not change it.'
        : can
          ? ''
          : 'Owners and Managers run the milestones. You can follow how close each one is.',
    openTask,
    createMilestone: (input) => then(createMilestone(home, input)),
    updateMilestone: (id, input) => then(updateMilestone(home, id, input)),
    deleteMilestone: (id) => then(deleteMilestone(home, id)),
    setReached: (id, reached) => then(setMilestoneReached(id, reached)),
    tag: (ids, milestoneId) => then(tagTasks(home, ids, milestoneId)),
    linkSprint: (sprintId, milestoneId) =>
      then(setSprintMilestone({ kind: 'work', projectId: home.projectId }, sprintId, milestoneId)),
  }
}
