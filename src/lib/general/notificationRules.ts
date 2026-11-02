// src/lib/general/notificationRules.ts
/**
 * What a work project sends on its own (supabase/project-notification-rules.sql).
 * The database sends the notices; the app only reads and sets the switches.
 */
export type SprintEndDays = 1 | 2 | 3
export type MilestoneDueDays = 1 | 2 | 3 | 7

export type NotificationRules = {
  /** Days before a sprint ends that its team is reminded. Null is off. */
  sprintEndDays: SprintEndDays | null
  /** Holders and planners are told when a task slips past its due date. */
  taskOverdue: boolean
  /** Days before a milestone is due that its planners are reminded. Null is off. */
  milestoneDueDays: MilestoneDueDays | null
  /** A person is told when a task is assigned to them. */
  assignment: boolean
  /** Planners and the sprint team are told when a sprint finishes. */
  sprintCompletion: boolean
}

/** What a project did before the settings existed; also what the app uses until the columns are live. */
export const DEFAULT_NOTIFICATION_RULES: NotificationRules = {
  sprintEndDays: 1,
  taskOverdue: true,
  milestoneDueDays: 2,
  assignment: true,
  sprintCompletion: true,
}
