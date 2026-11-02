import type { MilestoneCompletion } from '../general/milestoneRules'
import type { SprintSettings } from './sprintSettings'
import type { WorkStatus } from './timeline'

export type SprintState = 'planned' | 'active' | 'completed'

export type Sprint = {
  id: string
  name: string
  goal: string
  /** Calendar days, YYYY-MM-DD; the sprint covers both. */
  starts_on: string
  ends_on: string
  state: SprintState
  archived: boolean
  started_at: string | null
  completed_at: string | null
  created_at: string
  /** The milestone it counts toward: its tasks are tagged with it. Null for none. */
  milestone_id: string | null
}

export type SprintInput = { name: string; goal: string; startsOn: string; endsOn: string }

/** One task as Backlog and Sprints see it, from either space. */
export type WorkItem = {
  id: string
  title: string
  status: WorkStatus
  due_at: string | null
  /** When it was finished; null while it is not done. */
  done_at: string | null
  sprint_id: string | null
  /** The milestone it counts toward; null when untagged. */
  milestone_id: string | null
  rank: number
  /** Names of whoever holds it; empty when nobody does. */
  holders: string[]
  /** Who holds it, where the space can say (work projects); the Team filter reads this. */
  holderIds?: string[]
  /** The team it is filed under, where the space has teams (work projects). */
  teamId?: string | null
  /** A bug is a task QA raised. Work projects only; absent means a plain task. */
  kind?: 'task' | 'bug'
  created_at: string
}

/** A project's teams, for the Team filter on Backlog. Work projects only. */
export type WorkTeams = {
  projectId: string
  viewerId: string | undefined
  teams: { id: string; name: string; leader_id: string | null }[]
  members: { team_id: string; user_id: string }[]
}

/**
 * What a space hands Backlog and Sprints: its tasks, its sprints, what the
 * viewer may do, and how to do it. Every action reloads the space when done.
 */
export type WorkSource = {
  items: WorkItem[]
  sprints: Sprint[]
  /** May create, edit, move and reorder. */
  canPlan: boolean
  /**
   * May start and finish a sprint. A work project limits this to the project
   * manager and Coordinators; a class board's planners all may.
   */
  canRunSprints: boolean
  /** A work project's sprint settings. Unset for a class board. */
  sprintSettings?: SprintSettings
  /** A work project's milestone completion, for the timeline's reached checkpoints. Unset means a class source. */
  milestoneCompletion?: MilestoneCompletion
  /**
   * May move this task up or down its list. Planners always may; a work
   * project's team leader may for tasks somebody they lead holds. Unset means
   * only planners.
   */
  canStepItem?: (item: WorkItem) => boolean
  /** May add a task to the backlog. */
  canAdd: boolean
  /** Why planning is off for this viewer; '' when it is on. */
  readOnlyReason: string
  /** Set when the project has teams, so Backlog offers a Team filter. */
  teams?: WorkTeams
  openTask: (id: string) => void
  createSprint: (input: SprintInput) => Promise<string>
  updateSprint: (id: string, input: SprintInput) => Promise<void>
  deleteSprint: (id: string) => Promise<void>
  startSprint: (id: string) => Promise<void>
  finishSprint: (id: string, carryTo: string | null) => Promise<void>
  archiveSprint: (id: string, archived: boolean) => Promise<void>
  /** Run a finished sprint again. Set only for a work project's project manager and coordinators. */
  reopenSprint?: (id: string) => Promise<void>
  moveToSprint: (taskIds: string[], sprintId: string | null) => Promise<void>
  setRank: (taskId: string, rank: number) => Promise<void>
  addToBacklog: (title: string) => Promise<void>
  /** Shown after a task is added, when the new task does not appear in the list (a Member's goes to the planners). */
  addedMessage?: string
  /** The backlog's add-a-task placeholder, when the source has its own (a Member suggests a task). */
  addPlaceholder?: string
}

export type Milestone = {
  id: string
  name: string
  description: string
  /** Calendar day, YYYY-MM-DD. Null in a work project that does not require due dates. */
  due_on: string | null
  /** Work projects only: when it was reached, by a person or by the database. Always null in class projects. */
  reached_at: string | null
  /** Work projects only: the database reached it (automatic completion), not a person. */
  reached_auto?: boolean
  created_at: string
}

/** One link: `milestone_id` waits for `depends_on_id`. Work projects only. */
export type MilestoneDependency = { milestone_id: string; depends_on_id: string }

/** `dueOn` is '' for no due date (work projects whose settings allow it). */
export type MilestoneInput = { name: string; description: string; dueOn: string }

/** One group's tasks, for a professor following every group's progress. */
export type MilestoneGroup = { id: string; name: string; items: WorkItem[] }

/** What a space hands the Milestones view. Every action reloads the space when done. */
export type MilestoneSource = {
  milestones: Milestone[]
  /** The tasks this viewer can tag (empty for a professor, who reads `groups`). */
  items: WorkItem[]
  /** Per-group tasks for a professor's view; empty elsewhere. */
  groups: MilestoneGroup[]
  /** May create, edit and delete milestones. */
  canManage: boolean
  /** May tag and untag `items`, and add or take off `sprints`. */
  canTag: boolean
  /** The sprints this viewer can add to a milestone (empty for a professor). */
  sprints: Sprint[]
  /** Work projects: may mark a milestone reached by hand. */
  canMarkReached: boolean
  /** Work projects: how a milestone is reached. Class milestones read as automatic. */
  completion?: MilestoneCompletion
  /** Work projects: a milestone needs a due date. Class milestones always do. */
  requireDue?: boolean
  /** Work projects: which milestone waits for which. */
  dependencies?: MilestoneDependency[]
  /** May change what milestones wait for. */
  canLink?: boolean
  /** The project allows new links; existing ones stay and can still be removed. */
  allowLinks?: boolean
  addDependency?: (milestoneId: string, dependsOnId: string) => Promise<void>
  removeDependency?: (milestoneId: string, dependsOnId: string) => Promise<void>
  /** Shown as a note when this viewer can only read; '' otherwise. */
  readOnlyReason: string
  openTask: (id: string) => void
  createMilestone: (input: MilestoneInput) => Promise<string>
  updateMilestone: (id: string, input: MilestoneInput) => Promise<void>
  deleteMilestone: (id: string) => Promise<void>
  setReached: (id: string, reached: boolean) => Promise<void>
  tag: (taskIds: string[], milestoneId: string | null) => Promise<void>
  /** Count a sprint's tasks toward a milestone, or (null) stop. */
  linkSprint: (sprintId: string, milestoneId: string | null) => Promise<void>
}
