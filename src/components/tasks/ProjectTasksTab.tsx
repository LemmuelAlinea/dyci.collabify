import { Spinner } from '../ui/Icon'
import { WorkNav } from '../work/WorkNav'
import { EmptyState } from '../ui/EmptyState'
import { ProfessorTasksView } from './ProfessorTasksView'
import { StudentTasksView } from './StudentTasksView'
import type { ProjectTasks } from './useProjectTasks'
import { isReleased } from '../../lib/types'
import type { ProjectSummary, TeachingViewRole } from '../../lib/types'

/**
 * Work inside one project: Summary and Tasks. A student sees their own board; a professor sees
 * what they set, where every group stands, and can open any board read-only.
 *
 * This file holds only what both roles share: the loading state and the two
 * reasons there is nothing to show. The state lives in `useProjectTasks`, and
 * each role's markup lives in its own file — they had grown to 580 lines
 * together, and reading either one meant scrolling past the other.
 */
export function ProjectTasksTab({
  project, role,
  viewerId,
  t,
}: {
  project: ProjectSummary
  role: TeachingViewRole
  viewerId: string | undefined
  /** Owned by the project page, which shares it with Files and the hand-in. */
  t: ProjectTasks
}) {

  if (t.boards === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
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

  return (
    <div className="space-y-5">
      <WorkNav active={t.section} onChange={t.setSection} />
      {t.isProfessor ? (
        <ProfessorTasksView project={project} role={role} viewerId={viewerId} t={t} />
      ) : (
        <StudentTasksView project={project} role={role} viewerId={viewerId} t={t} />
      )}
    </div>
  )
}
