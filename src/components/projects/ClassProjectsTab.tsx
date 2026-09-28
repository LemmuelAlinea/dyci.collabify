import { useMemo, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { ProjectsBoard } from './ProjectsBoard'
import { ProjectWizard } from './ProjectWizard'
import { useProjectsData } from '../../hooks/useProjectsData'
import { paths } from '../../lib/paths'
import type { ClassSummary } from '../../lib/types'

/** The Projects tab inside a class — same board, scoped to one class. */
export function ClassProjectsTab({
  cls,
  role,
  viewerId,
}: {
  cls: ClassSummary
  role: 'professor' | 'student'
  viewerId?: string
}) {
  const [wizardOpen, setWizardOpen] = useState(false)
  // The projects load keys on the id alone: the class page refetches its class
  // on every live refresh, and a new object each time would reload the list.
  const classId = cls.id
  const ids = useMemo(() => [{ id: classId }], [classId])
  const { projects, loading, error, reload } = useProjectsData(ids)
  // The wizard reads the class itself (its syllabus, its name), so it gets the
  // current one.
  const classes = useMemo(() => [cls], [cls])

  const canManage = role === 'professor' && !cls.archived_at && Boolean(cls.syllabus_id)

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading projects…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {role === 'professor' && !cls.syllabus_id && (
        <Alert tone="info">
          Projects are built on syllabus weeks, and this class has no syllabus attached yet.
          Add one in the class settings to start setting projects.
        </Alert>
      )}

      {canManage && projects.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
            <Icon name="plus" size={17} />
            New project
          </Button>
        </div>
      )}

      <ProjectsBoard
        projects={projects}
        classes={classes}
        linkBase={paths.classProjects}
        showClass={false}
        // A professor is looking at the whole class, not at a board of their
        // own — without this the cards speak to them in the second person and
        // say things like "accepted by your professor".
        audience={role === 'professor' ? 'class' : 'mine'}
        emptyTitle="No projects in this class yet"
        emptyBody={
          canManage
            ? 'Choose the weeks this class is on and the syllabus tells you what the project should cover.'
            : 'When your professor releases a project for this class, it shows up here.'
        }
        emptyAction={
          canManage ? (
            <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
              New project
            </Button>
          ) : undefined
        }
      />

      {canManage && viewerId && (
        <ProjectWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          classes={classes}
          fixedClassId={cls.id}
          createdBy={viewerId}
          onSaved={reload}
        />
      )}
    </div>
  )
}
