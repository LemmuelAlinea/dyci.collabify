import { Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { ProfessorTasksView } from './ProfessorTasksView'
import { StudentTasksView } from './StudentTasksView'
import { useProjectTasks } from './useProjectTasks'
import { isReleased } from '../../lib/types'
import type { ProjectSummary, Role } from '../../lib/types'

/**
 * Tasks inside one project. A student sees their own board; a professor sees
 * what they set, where every group stands, and can open any board read-only.
 *
 * This file holds only what both roles share: the loading state and the two
 * reasons there is nothing to show. The state lives in `useProjectTasks`, and
 * each role's markup lives in its own file — they had grown to 580 lines
 * together, and reading either one meant scrolling past the other.
 */
export function ProjectTasksTab({
  project,
  role,
  viewerId,
}: {
  project: ProjectSummary
  role: Role
  viewerId: string | undefined
}) {
  const t = useProjectTasks({ project, role })

  if (t.boards === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading tasks…
      </div>
    )
  }

  if (!t.isProfessor && !isReleased(project)) {
    return (
      <EmptyState
        icon="clock"
        title="Not open yet"
        body="This project has not been released, so there is nothing to plan against."
      />
    )
  }

  if (t.boards.length === 0) {
    return (
      <EmptyState
        icon="users"
        title="No boards yet"
        body={
          t.isProfessor
            ? 'A board appears for each group once the project reaches them. Check the group set on this project.'
            : 'You are not in a group for this project yet, so there is nowhere to plan your work.'
        }
      />
    )
  }

  return t.isProfessor ? (
    <ProfessorTasksView project={project} role={role} viewerId={viewerId} t={t} />
  ) : (
    <StudentTasksView project={project} role={role} viewerId={viewerId} t={t} />
  )
}
