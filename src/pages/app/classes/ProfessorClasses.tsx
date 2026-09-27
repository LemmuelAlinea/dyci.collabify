import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ClassCard } from '../../../components/classes/ClassCard'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { NewSpaceDialog } from '../../../components/general/SpaceDialogs'
import { useAuth } from '../../../context/AuthContext'
import { canTeach } from '../../../lib/access'
import { listProfessorClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import { paths } from '../../../lib/paths'
import type { ClassSummary } from '../../../lib/types'

type View = 'active' | 'archived'

export default function ProfessorClasses() {
  const { profile } = useAuth()
  const teaching = canTeach(profile)

  const [view, setView] = useState<View>('active')
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    document.title = 'Classes · Collabify'
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    setClasses(null)
    try {
      setClasses(await listProfessorClasses(profile.id, view === 'archived'))
      setLoadError(null)
    } catch (err) {
      setLoadError(authErrorMessage(err, 'Could not load your classes.'))
      setClasses([])
    }
  }, [profile, view])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members'])


  return (
    <div className="w-full">
      <DirectoryHero
        title="Your classes shape"
        accent="the term."
        description="Build each section around one syllabus, then keep its people, projects and decisions moving from the same place."
        action={
          teaching ? (
            <Button variant="accent" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={17} />
              Create class
            </Button>
          ) : undefined
        }
      />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-[12px] font-medium text-faint">Class directory</p>
          <h2 className="mt-1">{view === 'active' ? 'This term' : 'Past classes'}</h2>
        </div>
        <div className="flex gap-1 rounded-lg surface-sunken p-1">
          {(['active', 'archived'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-4 py-1.5 text-[13px] transition-colors duration-150 ${
                view === v
                  ? 'surface font-medium text-ink ring-1 ring-[var(--line)]'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {v === 'active' ? 'Active' : 'Archived'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {classes === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading classes…
          </div>
        ) : classes.length === 0 ? (
          <EmptyState
            icon={view === 'active' ? 'board' : 'folder'}
            art="classes"
            title={view === 'active' ? 'No classes yet' : 'Nothing archived'}
            body={
              view === 'active'
                ? teaching
                  ? 'Create your first class and share its code with your section. Students join with the code — you never add them by hand.'
                  : 'Classes open once the program admin turns on teaching for your account. Work spaces are open to you now.'
                : 'Archived classes disappear for students but stay here for your records.'
            }
            action={
              view === 'active' && teaching ? (
                <Button onClick={() => setCreateOpen(true)} className="!rounded-xl">
                  Create class
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
            {classes.map((c, index) => (
              <ClassCard
                key={c.id}
                cls={c}
                to={paths.class(c.id)}
                audience="professor"
                index={index}
              />
            ))}
          </div>
        )}
      </div>

      <NewSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initialKind="education"
        onCreated={async () => {
          setView('active')
          await load()
        }}
      />
    </div>
  )
}
