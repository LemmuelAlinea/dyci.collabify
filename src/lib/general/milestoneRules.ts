// src/lib/general/milestoneRules.ts
/**
 * A work project's milestone settings. The database enforces them
 * (supabase/project-milestone-rules.sql); the app reads them to word statuses
 * and to hide what the database would refuse.
 */
export type MilestoneCompletion = 'automatic' | 'manual'

export type MilestoneRules = {
  /** Automatic: the database reaches a milestone when its tasks are done. Manual: someone marks it. */
  completion: MilestoneCompletion
  /** A milestone needs a due date. */
  requireDue: boolean
  /** Milestones may wait for other milestones. */
  allowDependencies: boolean
  /** The project manager and coordinators are told when a due date passes unreached. */
  overdueAlerts: boolean
}

/** What a project did before the settings existed; also what the app uses until the columns are live. */
export const DEFAULT_MILESTONE_RULES: MilestoneRules = {
  completion: 'automatic',
  requireDue: true,
  allowDependencies: true,
  overdueAlerts: true,
}
