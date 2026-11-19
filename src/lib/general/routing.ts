import { canAssignIncoming, type ProjectRole } from './permissions'
import type { GeneralTask } from './types'

/**
 * The Plan & route work queues and who may act on their rows. Mirrors the
 * checks in `send_work_tasks_to_teams`, `send_work_tasks_to_coordinator` and
 * `return_work_task` (`supabase/work-task-handoff.sql`): only the project
 * manager and coordinators route; a coordinator acts on the review rows sent to
 * them, and the project manager on review rows only while no coordinator is
 * active.
 */
export type RoutingQueue = 'planning' | 'coordinator_review' | 'released'

export type RoutingViewer = {
  viewerId: string | undefined
  role: ProjectRole | null
  /** Whether the project has an active coordinator (one who can review). */
  hasActiveCoordinator: boolean
}

/** The viewer as the routing rules read them, from useGeneralProject's state. */
export function routingViewer(state: {
  viewerId: string | undefined
  myRole: ProjectRole | null
  readOnly: boolean
  members: readonly { role?: string | null; profile?: { status?: string | null } | null }[]
}): RoutingViewer & { readOnly: boolean } {
  return {
    viewerId: state.viewerId,
    role: state.myRole,
    hasActiveCoordinator: state.members.some(m => m.role === 'coordinator' && m.profile?.status === 'active'),
    readOnly: state.readOnly,
  }
}

export function canRoute(role: ProjectRole | null): boolean {
  return role === 'pm' || role === 'coordinator'
}

/** Whether the viewer acts on the Coordinator review queue at all. */
export function canReviewQueue(viewer: RoutingViewer): boolean {
  return viewer.role === 'coordinator' || (viewer.role === 'pm' && !viewer.hasActiveCoordinator)
}

/** The rows a queue lists. */
export function routingRows(tasks: readonly GeneralTask[], queue: RoutingQueue): GeneralTask[] {
  return tasks.filter(t => (t.routing_state ?? 'released') === queue)
}

/** Whether the viewer may pick this row in this queue. */
export function canUseRoutingRow(viewer: RoutingViewer, queue: RoutingQueue, t: GeneralTask): boolean {
  if (queue !== 'coordinator_review') return true
  return viewer.role === 'coordinator' ? t.reviewer_id === viewer.viewerId : canReviewQueue(viewer)
}

/**
 * Released tasks sent to a team the viewer leads that wait for a member
 * (Incoming tasks). The rule per task is canAssignIncoming.
 */
export function incomingTasks(viewerId: string | undefined, teams: readonly { id: string; leader_id: string | null }[], tasks: readonly GeneralTask[]): GeneralTask[] {
  const led = teams.filter(t => viewerId && t.leader_id === viewerId).map(t => t.id)
  return led.length ? tasks.filter(t => canAssignIncoming(led, t)) : []
}

/**
 * Tasks waiting for this viewer to route: Planning rows, plus the Coordinator
 * review rows they act on. A subtask moves with its parent, so it never counts
 * on its own. Zero for anyone who doesn't route or can't write.
 */
export function routingWaitingCount(viewer: RoutingViewer & { readOnly: boolean }, tasks: readonly GeneralTask[]): number {
  if (viewer.readOnly || !canRoute(viewer.role)) return 0
  const queues: RoutingQueue[] = ['planning', 'coordinator_review']
  return queues.reduce((sum, queue) =>
    sum + routingRows(tasks, queue).filter(t => !t.parent_id && canUseRoutingRow(viewer, queue, t)).length, 0)
}
