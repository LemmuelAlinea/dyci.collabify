// src/components/general/workSource.ts
import {
  addMilestoneDependency,
  createMilestone,
  deleteMilestone,
  removeMilestoneDependency,
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
  reopenSprint,
  setSprintMilestone,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import type { SprintHome } from '../../lib/api/sprints'
import { createMemberTask, createTask } from '../../lib/api/general'
import { DEFAULT_MILESTONE_RULES } from '../../lib/general/milestoneRules'
import { DEFAULT_MEMBER_RULES, canCreateWorkTaskWith, canManageMilestones, canStepRank } from '../../lib/general/permissions'
import type { MilestoneSource, WorkItem, WorkSource } from '../../lib/work/types'
import type { GeneralProjectState } from './useGeneralProject'

/** A work project's tasks as the shared Work views read them. */
export function generalWorkItems(state: GeneralProjectState): WorkItem[] {
  return state.tasks.filter(t => state.project?.class_board_id || (t.routing_state ?? 'released') === 'released').map((t) => ({
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
  const memberRules = project?.memberRules ?? DEFAULT_MEMBER_RULES
  // A work project's Member adds through createMemberTask; a class board's members keep createTask.
  const viaMember = !project?.class_board_id && state.myRole === 'member'
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
    canRunSprints: live && (state.myRole === 'pm' || state.myRole === 'coordinator'),
    sprintSettings: state.sprintSettings,
    milestoneCompletion: project?.milestoneRules?.completion,
    // A team leader reorders the tasks people they lead hold; sprint moves stay with planners.
    canStepItem: (item) => live && canStepRank(canPlan, item.holderIds, state.leadsUser),
    canAdd: live && (Boolean(project?.class_board_id) || canCreateWorkTaskWith(state.myRole, state.myRole === 'qa' ? 'bug' : 'task', memberRules)),
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : state.myRole === 'stakeholder'
        ? 'Stakeholders can follow the plan but not change it.'
      : state.readOnly
        ? 'You are viewing this project from its space. Join it to change the plan.'
        : canPlan
          ? ''
          : state.teams.some((t) => t.leader_id === state.viewerId)
            ? 'Planners manage sprints. You can follow the released work and reorder the tasks the people you lead hold.'
            : 'Planners manage sprints. You can follow the released work.',
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
    reopenSprint:
      live && (state.myRole === 'pm' || state.myRole === 'coordinator')
        ? (id) => then(reopenSprint(id))
        : undefined,
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addedMessage: viaMember ? 'Sent to planners for review' : undefined,
    addPlaceholder: viaMember ? 'Suggest a task for the planners' : undefined,
    addToBacklog: (title) =>
      then(
        // A Member's task starts in planning for a planner to send; they cannot read it back.
        viaMember
          ? createMemberTask(home.projectId, title).then(() => undefined)
          : createTask({
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
  const live = Boolean(project) && !state.readOnly
  const can = live && state.can('manage_tasks')
  // Members may run milestones while the project lets them; tagging and sprint links stay with manage_tasks.
  const manage = live && canManageMilestones(state.myRole, can, project?.memberRules)
  const rules = project?.milestoneRules ?? DEFAULT_MILESTONE_RULES
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
    canManage: manage,
    canTag: can,
    sprints: state.sprints,
    canMarkReached: manage,
    completion: rules.completion,
    requireDue: rules.requireDue,
    dependencies: state.milestoneDependencies ?? [],
    // The database lets whoever manages milestones link them.
    canLink: manage,
    allowLinks: rules.allowDependencies,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : state.myRole === 'stakeholder'
        ? 'Stakeholders can follow the plan but not change it.'
      : state.readOnly
        ? 'You are viewing this project from its space. Join it to change the plan.'
        : can
          ? ''
          : manage
            ? 'You can create, edit, delete and mark milestones reached. Tagging tasks still needs Manage tasks.'
            : 'Owners and Managers run the milestones. You can follow how close each one is.',
    openTask,
    createMilestone: (input) => then(createMilestone(home, input)),
    updateMilestone: (id, input) => then(updateMilestone(home, id, input)),
    deleteMilestone: (id) => then(deleteMilestone(home, id)),
    setReached: (id, reached) => then(setMilestoneReached(id, reached)),
    addDependency: (id, dependsOnId) => then(addMilestoneDependency(id, dependsOnId)),
    removeDependency: (id, dependsOnId) => then(removeMilestoneDependency(id, dependsOnId)),
    tag: (ids, milestoneId) => then(tagTasks(home, ids, milestoneId)),
    linkSprint: (sprintId, milestoneId) =>
      then(setSprintMilestone({ kind: 'work', projectId: home.projectId }, sprintId, milestoneId)),
  }
}
