import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { rememberSpace } from '../../hooks/useSpaces'
import { canTeach } from '../../lib/access'
import { copyClassProjects, createClass, listProfessorClasses } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import { createSpace, joinSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { ClassSummary, TeachingResource } from '../../lib/types'
import { ClassForm } from '../classes/ClassForm'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'

type SpaceKind = 'education' | 'work'

/** What carries over from a past class. Section and school year are new each term. */
function sourceDefaults(c: ClassSummary | undefined): Partial<ClassInput> | undefined {
  if (!c) return undefined
  return {
    name: c.name,
    initial: c.initial,
    year_level: c.year_level,
    semester: c.semester,
    description: c.description,
    syllabus_id: c.syllabus_id,
    curriculum_id: c.curriculum_id,
    student_cap: c.student_cap,
  }
}

export function NewSpaceDialog({
  open,
  onClose,
  onCreated,
  initialKind,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void | Promise<void>
  /** `education` opens the class form (Create class). Anything else makes a work space. */
  initialKind?: SpaceKind
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { show } = useToast()
  // Classes have their own Create class, so Create space always makes a work
  // space. Only members who can teach can open the class form.
  const kind: SpaceKind = canTeach(profile) && initialKind === 'education' ? 'education' : 'work'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  // Teaching the same course again: start from last term's class.
  const [pastClasses, setPastClasses] = useState<ClassSummary[]>([])
  const [sourceId, setSourceId] = useState('')
  const [copyProjects, setCopyProjects] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  useEffect(() => {
    if (!open || kind !== 'education' || !profile) return
    setSourceId('')
    setCopyProjects(true)
    void Promise.all([listProfessorClasses(profile.id), listProfessorClasses(profile.id, true)])
      .then(([live, archived]) =>
        setPastClasses(
          [...live, ...archived].filter((c) => c.professor_id === profile.id),
        ),
      )
      .catch(() => setPastClasses([]))
  }, [open, kind, profile])

  useEffect(() => {
    if (!open || kind !== 'education' || !profile) return
    void Promise.all([listResources(profile.id, 'syllabus'), listResources(profile.id, 'curriculum')])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns simply stay empty; making the class does not depend on them.
      })
  }, [open, kind, profile])

  async function createWork(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const space = await createSpace(name, description)
      rememberSpace(space.id)
      await onCreated?.()
      onClose()
      setName('')
      setDescription('')
      navigate(paths.space(space.id))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that space.'))
    } finally {
      setBusy(false)
    }
  }

  async function createEducation(input: ClassInput) {
    if (!profile) return
    setError(null)
    setBusy(true)
    try {
      const created = await createClass(profile.id, input)
      let copied = ''
      if (sourceId && copyProjects) {
        try {
          const res = await copyClassProjects(sourceId, created.id)
          if (res.copied > 0) {
            copied = ` · ${res.copied} ${res.copied === 1 ? 'project' : 'projects'} waiting in Archived`
          }
          if (res.skipped > 0) {
            copied += ` · ${res.skipped} left out, their weeks are not in this syllabus`
          }
        } catch (err) {
          show(
            authErrorMessage(err, 'The class was created, but its projects could not be copied.'),
            'error',
          )
        }
      }
      show(`${created.name} created · code ${created.code}${copied}`)
      await onCreated?.()
      onClose()
      navigate(paths.class(created.id))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that class.'))
    } finally {
      setBusy(false)
    }
  }

  if (kind === 'education') {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Create class"
        description="Students join with its code. You can change everything here later in its settings."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button form="new-class" type="submit" loading={busy} className="!rounded-xl">
              Create class
            </Button>
          </>
        }
      >
        {pastClasses.length > 0 && (
          <div className="mb-6 space-y-3 rounded-xl border border-dashed border-line p-4">
            <Field label="Start from a past class" optional>
              {(id) => (
                <Select
                  id={id}
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  placeholder="Start blank"
                  options={pastClasses.map((c) => ({
                    value: c.id,
                    label: `${c.initial} · ${c.section} — ${c.name} (${c.school_year}, ${c.semester} sem)`,
                  }))}
                />
              )}
            </Field>
            {sourceId && (
              <label className="flex items-start gap-2.5 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={copyProjects}
                  onChange={(e) => setCopyProjects(e.target.checked)}
                />
                <span>
                  Also copy its projects and rubrics
                  <span className="block text-[12px] text-muted">
                    They wait in Archived with no dates. Restore each one when you are ready,
                    and students see it then. Groups and students are not copied.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}
        <ClassForm
          key={sourceId || 'blank'}
          defaults={sourceDefaults(pastClasses.find((c) => c.id === sourceId))}
          formId="new-class"
          assignedTo={profile?.id}
          syllabi={syllabi}
          curricula={curricula}
          error={error}
          onSubmit={createEducation}
        />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create space"
      description="A space holds projects. Everyone you add to it can see every project inside."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-general-space"
            loading={busy}
            disabled={name.trim().length === 0}
          >
            Create
          </Button>
        </>
      }
    >
      <form id="new-general-space" onSubmit={createWork} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={80}
              placeholder="Student council"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label="Description" hint="Optional. What the space is for.">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={400}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}

export function JoinSpaceDialog({
  open,
  onClose,
  onJoined,
}: {
  open: boolean
  onClose: () => void
  onJoined?: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const spaceId = await joinSpace(code)
      rememberSpace(spaceId)
      await onJoined?.()
      onClose()
      setCode('')
      navigate(paths.space(spaceId))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not join with that code.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join a space"
      description="Whoever runs the space can give you its eight-character code."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="join-general-space"
            loading={busy}
            disabled={code.trim().length < 8}
          >
            Join
          </Button>
        </>
      }
    >
      <form id="join-general-space" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Code">
          {(id) => (
            <Input
              id={id}
              required
              autoComplete="off"
              maxLength={8}
              placeholder="ABCD2345"
              className="font-mono uppercase tracking-[0.2em]"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
