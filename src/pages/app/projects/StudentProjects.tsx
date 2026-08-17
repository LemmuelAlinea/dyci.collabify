import { useEffect, useState } from 'react'
import { Alert } from '../../../components/ui/Field'
import { Spinner } from '../../../components/ui/Icon'
import { ProjectsBoard } from '../../../components/projects/ProjectsBoard'
import { useAuth } from '../../../context/AuthContext'
import { useProjectsData } from '../../../hooks/useProjectsData'
import { listStudentClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary } from '../../../lib/types'

export default function StudentProjects() {
  const { profile } = useAuth()
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)

  const { projects, loading, error } = useProjectsData(classes)

  useEffect(() => {
    document.title = 'Projects · Collabify'
  }, [])

  useEffect(() => {
    if (!profile) return
    void listStudentClasses(profile.id)
      .then(setClasses)
      .catch((err) => {
        setClassError(authErrorMessage(err, 'Could not load your classes.'))
        setClasses([])
      })
  }, [profile])

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header>
        <p className="eyebrow text-amber-500 dark:text-amber-300">Workspace</p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Projects</h1>
        <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
          Everything your classes have set, with the week of the syllabus each one comes from.
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading || classes === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            linkBase="/student/projects"
            emptyTitle="Nothing set yet"
            emptyBody="When a professor releases a project in one of your classes, it appears here with its deadline."
          />
        )}
      </div>
    </div>
  )
}
