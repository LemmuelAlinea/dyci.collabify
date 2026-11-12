import { listProfessorClasses } from './classes'
import { listProjectsForClasses } from './projects'
import { listReassignments } from './reassignments'
import { listHandedInBoards } from './results'
import { submissionStatus, toSubmissions } from '../submissions'

/**
 * What is waiting on a teacher, kept apart: hand-ins no one has answered and
 * reassignment requests still pending. With a class id, only that class's.
 */
export async function teachingWaitingCounts(
  userId: string,
  classId?: string,
): Promise<{ handIns: number; requests: number }> {
  const classes = (await listProfessorClasses(userId)).filter((c) => !classId || c.id === classId)
  const projects = await listProjectsForClasses(classes.map((c) => c.id))
  const boards = await listHandedInBoards(projects.filter((p) => !p.archived_at).map((p) => p.id))
  const handIns = toSubmissions(boards, classes).filter(
    (s) => submissionStatus(s) === 'waiting',
  ).length
  const requests = (await listReassignments()).filter(
    (r) => r.status === 'pending' && (!classId || r.class_id === classId),
  ).length
  return { handIns, requests }
}

/** Both of `teachingWaitingCounts`, as the one number a badge shows. */
export async function teachingWaitingCount(userId: string, classId?: string): Promise<number> {
  const { handIns, requests } = await teachingWaitingCounts(userId, classId)
  return handIns + requests
}
