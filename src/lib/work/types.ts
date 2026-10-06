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
  started_at: string | null
  completed_at: string | null
  created_at: string
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
  created_at: string
}

/**
 * What a space hands Backlog and Sprints: its tasks, its sprints, what the
 * viewer may do, and how to do it. Every action reloads the space when done.
 */
export type WorkSource = {
  items: WorkItem[]
  sprints: Sprint[]
  /** May create, edit, start, finish, move and reorder. */
  canPlan: boolean
  /** May add a task to the backlog. */
  canAdd: boolean
  /** Why planning is off for this viewer; '' when it is on. */
  readOnlyReason: string
  openTask: (id: string) => void
  createSprint: (input: SprintInput) => Promise<string>
  updateSprint: (id: string, input: SprintInput) => Promise<void>
  deleteSprint: (id: string) => Promise<void>
  startSprint: (id: string) => Promise<void>
  finishSprint: (id: string, carryTo: string | null) => Promise<void>
  moveToSprint: (taskIds: string[], sprintId: string | null) => Promise<void>
  setRank: (taskId: string, rank: number) => Promise<void>
  addToBacklog: (title: string) => Promise<void>
}

export type Milestone = {
  id: string
  name: string
  description: string
  /** Calendar day, YYYY-MM-DD. */
  due_on: string
  /** Work projects only: when someone marked it reached. Always null in class projects. */
  reached_at: string | null
  created_at: string
}

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
  /** May tag and untag `items`. */
  canTag: boolean
  /** Work projects: may mark a milestone reached by hand. */
  canMarkReached: boolean
  /** Shown as a note when this viewer can only read; '' otherwise. */
  readOnlyReason: string
  openTask: (id: string) => void
  createMilestone: (input: MilestoneInput) => Promise<string>
  updateMilestone: (id: string, input: MilestoneInput) => Promise<void>
  deleteMilestone: (id: string) => Promise<void>
  setReached: (id: string, reached: boolean) => Promise<void>
  tag: (taskIds: string[], milestoneId: string | null) => Promise<void>
}
