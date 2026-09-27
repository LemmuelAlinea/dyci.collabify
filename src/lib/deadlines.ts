import { paths } from './paths'
import type { ProjectBoard, ProjectSummary } from './types'
import type { MyTask } from './api/tasks'

/** Anything with a date the viewer has to meet, from either source. */
export type Deadline = {
  id: string
  kind: 'task' | 'project'
  title: string
  context: string
  due_at: string
  to: string
  done: boolean
}

const WEEK = 7 * 86_400_000

/**
 * What a student still owes in the coming week, overdue included.
 *
 * Finished work never shows: a done task, anything on a board already handed
 * in (accepted or waiting on the professor), and any project that is closed,
 * archived or not yet released. Work the professor returns reappears on its
 * own, because returning it clears `submitted_at`.
 */
export function buildDeadlines(
  tasks: MyTask[],
  projects: ProjectSummary[],
  boards: Pick<ProjectBoard, 'id' | 'project_id' | 'submitted_at'>[],
  now: number,
): Deadline[] {
  const handedInBoards = new Set(boards.filter((b) => b.submitted_at).map((b) => b.id))
  const handedInProjects = new Set(boards.filter((b) => b.submitted_at).map((b) => b.project_id))
  const closed = new Set(projects.filter((p) => p.archived_at || p.locked_at).map((p) => p.id))

  const soon = now + WEEK
  return [
    ...tasks
      .filter((t) => t.due_at)
      .map((t) => ({
        id: t.id,
        kind: 'task' as const,
        title: t.title,
        context: `${t.project_title} · ${t.class_initial}`,
        due_at: t.due_at as string,
        to: paths.classProject(t.project_id),
        done: t.status === 'done' || handedInBoards.has(t.board_id) || closed.has(t.project_id),
      })),
    ...projects
      .filter((p) => p.due_at)
      .map((p) => ({
        id: p.id,
        kind: 'project' as const,
        title: p.title,
        context: `${p.class_initial} · ${p.class_name}`,
        due_at: p.due_at as string,
        to: paths.classProject(p.id),
        done: p.scheduled || closed.has(p.id) || handedInProjects.has(p.id),
      })),
  ]
    .filter((d) => !d.done && new Date(d.due_at).getTime() < soon)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))
}
