import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ProjectsBoard } from '../../../components/projects/ProjectsBoard'
import { ProjectWizard } from '../../../components/projects/ProjectWizard'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useProjectsData } from '../../../hooks/useProjectsData'
import { listProfessorClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary } from '../../../lib/types'

export default function ProfessorProjects() {
  const { profile } = useAuth()
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const { projects, loading, error, reload } = useProjectsData(classes)

  useEffect(() => {
    document.title = 'Projects · Collabify'
  }, [])

  useEffect(() => {
    if (!profile) return
    void listProfessorClasses(profile.id)
      .then(setClasses)
      .catch((err) => {
        setClassError(authErrorMessage(err, 'Could not load your classes.'))
        setClasses([])
      })
  }, [profile])

  const withSyllabus = (classes ?? []).filter((c) => c.syllabus_id)
  const openProjects = projects.filter((p) => !p.archived_at && !p.scheduled && !p.locked_at)
  const scheduledProjects = projects.filter((p) => p.scheduled)

  return (
    <div className="w-full">
      <DirectoryHero
        title="Turn syllabus weeks into"
        accent="work that ships."
        description="Plan every brief against the course, release it at the right moment and read progress across all of its boards."
        action={
          <Button
            variant="accent"
            onClick={() => setWizardOpen(true)}
            disabled={withSyllabus.length === 0}
          >
            <Icon name="plus" size={17} />
            New project
          </Button>
        }
        stats={[
          { value: loading || classes === null ? '—' : openProjects.length, label: 'Open projects' },
          { value: loading || classes === null ? '—' : scheduledProjects.length, label: 'Scheduled next' },
        ]}
      />

      <div className="mt-8 border-b border-line pb-4">
        <p className="text-[12px] font-medium text-faint">Project directory</p>
        <h2 className="mt-1">Work across classes</h2>
      </div>

      <div className="mt-5 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {classes && classes.length === 0 && (
          <Alert tone="info">
            Projects belong to a class, and you don't have one yet. Create a class first.
          </Alert>
        )}

        {classes && classes.length > 0 && withSyllabus.length === 0 && (
          <Alert tone="info">
            None of your classes has a syllabus attached yet. Attach one, add its weeks, and
            projects become available.
          </Alert>
        )}

        {loading || classes === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            linkBase="/professor/projects"
            audience="class"
            emptyTitle="No projects yet"
            emptyBody="Pick a class, choose the weeks it covers, and the syllabus tells you what the project should be for. You can schedule it to open later."
            emptyAction={
              withSyllabus.length > 0 ? (
                <Button onClick={() => setWizardOpen(true)} className="!rounded-xl">
                  New project
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      {profile && (
        <ProjectWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          classes={withSyllabus}
          createdBy={profile.id}
          onSaved={reload}
        />
      )}
    </div>
  )
}
