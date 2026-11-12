import { Spinner } from '../ui/Icon'
import { WorkNav } from '../work/WorkNav'
import { workSectionsFor } from '../../lib/work/nav'
import { EmptyState } from '../ui/EmptyState'
import { StudentTasksView } from './StudentTasksView'
import type { ProjectTasks } from './useProjectTasks'
import { isReleased } from '../../lib/types'
import type { ProjectSummary, TeachingViewRole } from '../../lib/types'

/** A class project's Work has no QA. */
const CLASS_SECTIONS = workSectionsFor(false)

/**
 * A student's Work inside one project: Summary, Backlog, Sprints, Milestones and
 * Tasks on their own board. The professor reads a class project through
 * `ProfessorProject` instead.
 *
 * This file holds the loading state and the two reasons there is nothing to
 * show. The state lives in `useProjectTasks`, and the markup in `StudentTasksView`.
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

  if (!isReleased(project)) {
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
        body="You are not in a group for this project yet, so there is nowhere to plan your work."
      />
    )
  }

  return (
    <div className="space-y-5">
      <WorkNav sections={CLASS_SECTIONS} active={t.section} onChange={t.setSection} />
      <StudentTasksView project={project} role={role} viewerId={viewerId} t={t} />
    </div>
  )
}
