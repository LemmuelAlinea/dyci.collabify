import { useEffect, useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Icon'
import { ProjectsBoard } from '../../../components/projects/ProjectsBoard'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
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
    <div className="w-full">
      <DirectoryHero
        title="Every brief, deadline"
        accent="and board."
        description="See the work your classes have set, the syllabus weeks behind it and how far your own board has moved."
        stats={[
          { value: loading || classes === null ? '—' : projects.length, label: 'Projects in view' },
          { value: classes === null ? '—' : classes.length, label: 'Classes represented' },
        ]}
      />

      <div className="mt-8 border-b border-line pb-4">
        <p className="text-[12px] font-medium text-faint">Project directory</p>
        <h2 className="mt-1">Your assigned work</h2>
      </div>

      <div className="mt-5 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading || classes === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading projects…
          </div>
        ) : (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            audience="mine"
            linkBase="/student/projects"
            emptyTitle="Nothing set yet"
            emptyBody="When a professor releases a project in one of your classes, it appears here with its deadline."
          />
        )}
      </div>
    </div>
  )
}
