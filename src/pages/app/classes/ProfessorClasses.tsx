import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { ClassCard } from '../../../components/classes/ClassCard'
import { ClassForm } from '../../../components/classes/ClassForm'
import { useAuth } from '../../../context/AuthContext'
import { createClass, listProfessorClasses } from '../../../lib/api/classes'
import type { ClassInput } from '../../../lib/api/classes'
import { listResources } from '../../../lib/api/resources'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary, TeachingResource } from '../../../lib/types'

type View = 'active' | 'archived'

export default function ProfessorClasses() {
  const { profile } = useAuth()
  const { show } = useToast()

  const [view, setView] = useState<View>('active')
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])

  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!profile) return
    void Promise.all([
      listResources(profile.id, 'syllabus'),
      listResources(profile.id, 'curriculum'),
    ])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns simply stay empty; class creation does not depend on them.
      })
  }, [profile, createOpen])

  async function submit(input: ClassInput) {
    if (!profile) return
    setFormError(null)
    setBusy(true)
    try {
      const created = await createClass(profile.id, input)
      setCreateOpen(false)
      show(`${created.name} created · code ${created.code}`)
      setView('active')
      await load()
    } catch (err) {
      setFormError(authErrorMessage(err, 'Could not create that class.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Advising</p>
          <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Classes</h1>
          <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
            Each class gets a join code you hand to your section. Everything else — roster,
            announcements, files — lives inside it.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="!rounded-xl">
          <Icon name="plus" size={17} />
          Create class
        </Button>
      </header>

      <div className="mt-7 flex gap-1 rounded-full surface-sunken p-1 sm:w-fit">
        {(['active', 'archived'] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`flex-1 rounded-full px-5 py-2 text-[14px] transition-colors duration-200 sm:flex-none ${
              view === v ? 'surface font-semibold text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
            }`}
          >
            {v === 'active' ? 'Active' : 'Archived'}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {classes === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
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
                ? 'Create your first class and share its code with your section. Students join with the code — you never add them by hand.'
                : 'Archived classes disappear for students but stay here for your records.'
            }
            action={
              view === 'active' ? (
                <Button onClick={() => setCreateOpen(true)} className="!rounded-xl">
                  Create class
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4 min-[2100px]:grid-cols-5 max-sm:[&>*:only-child]:col-span-2">
            {classes.map((c) => (
              <ClassCard key={c.id} cls={c} to={`/professor/classes/${c.id}`} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a class"
        description="The join code is generated for you once the class is saved."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="create-class" type="submit" loading={busy} className="!rounded-xl">
              Create class
            </Button>
          </>
        }
      >
        <ClassForm
          formId="create-class"
          syllabi={syllabi}
          curricula={curricula}
          error={formError}
          onSubmit={submit}
        />
      </Modal>
    </div>
  )
}
