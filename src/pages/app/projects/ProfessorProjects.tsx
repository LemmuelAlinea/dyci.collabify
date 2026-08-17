import { useEffect, useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { ProjectsBoard } from '../../../components/projects/ProjectsBoard'
import { ProjectWizard } from '../../../components/projects/ProjectWizard'
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

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Teaching</p>
          <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Projects</h1>
          <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
            Every project is built on the weeks of a class syllabus, so what you set always
            traces back to what the course said it would cover.
          </p>
        </div>
        <Button
          onClick={() => setWizardOpen(true)}
          disabled={withSyllabus.length === 0}
          className="!rounded-xl"
        >
          <Icon name="plus" size={17} />
          New project
        </Button>
      </header>

      <div className="mt-8 space-y-4">
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
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            linkBase="/professor/projects"
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
