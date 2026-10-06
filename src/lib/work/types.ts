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
