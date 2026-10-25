import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { ProjectsBoard } from './ProjectsBoard'
import { ProjectWizard } from './ProjectWizard'
import { DirectoryHero } from '../app/DirectoryHero'
import { JoinProjectDialog } from '../general/JoinProjectDialog'
import { useAuth } from '../../context/AuthContext'
import { useProjectsData } from '../../hooks/useProjectsData'
import { listProfessorClasses, listStudentClasses } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { ClassSummary } from '../../lib/types'

/**
 * The Classes half of the Projects page. A student sees the work their classes
 * set; a professor plans it, so they also get New project and the reasons it
 * might not be available yet.
 */
export function ClassProjectsView({ scope }: { scope?: ReactNode }) {
  const { profile } = useAuth()
  const professor = profile?.role !== 'student'
  // The filter renders into the section header, beside the heading.
  const [filterSlot, setFilterSlot] = useState<HTMLDivElement | null>(null)
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [classError, setClassError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const { projects, loading, error, reload } = useProjectsData(classes)

  useEffect(() => {
    if (!profile) return
    const list = professor ? listProfessorClasses : listStudentClasses
    void list(profile.id)
      .then(setClasses)
      .catch((err) => {
        setClassError(authErrorMessage(err, 'Could not load your classes.'))
        setClasses([])
      })
  }, [profile, professor])

  const withSyllabus = (classes ?? []).filter((c) => c.syllabus_id)

  return (
    <div className="w-full">
      {professor ? (
        <DirectoryHero
          title="Turn syllabus weeks into"
          accent="work that ships."
          description="Plan every brief against the course, release it at the right moment and read progress across all of its boards."
          action={
            <Button
              variant="create"
              onClick={() => setWizardOpen(true)}
              disabled={withSyllabus.length === 0}
            >
              <Icon name="plus" size={17} />
              New project
            </Button>
          }
        />
      ) : (
        <DirectoryHero
          title="Every brief, deadline"
          accent="and board."
          description="See the work your classes have set, the syllabus weeks behind it and how far your own board has moved."
          action={
            <Button variant="onNavy" size="sm" onClick={() => setJoinOpen(true)}>
              <Icon name="lock" size={15} />
              Join with code
            </Button>
          }
        />
      )}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-[12px] font-medium text-faint">Project directory</p>
          <h2 className="mt-1">{professor ? 'Work across classes' : 'Your assigned work'}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {scope}
          <div ref={setFilterSlot} className="flex items-center gap-3" />
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {classError && <Alert tone="error">{classError}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {professor && classes && classes.length === 0 && (
          <Alert tone="info">
            Projects belong to a class, and you don't have one yet. Create a class first.
          </Alert>
        )}

        {professor && classes && classes.length > 0 && withSyllabus.length === 0 && (
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
        ) : professor ? (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            linkBase={paths.classProjects}
            audience="class"
            filterSlot={filterSlot}
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
        ) : (
          <ProjectsBoard
            projects={projects}
            classes={classes}
            audience="mine"
            filterSlot={filterSlot}
            linkBase={paths.classProjects}
            emptyTitle="Nothing set yet"
            emptyBody="When a professor releases a project in one of your classes, it appears here with its deadline."
          />
        )}
      </div>

      {professor && profile && (
        <ProjectWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          classes={withSyllabus}
          createdBy={profile.id}
          onSaved={reload}
        />
      )}
      {!professor && <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} />}
    </div>
  )
}
