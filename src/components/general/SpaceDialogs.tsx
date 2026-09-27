import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { rememberSpace } from '../../hooks/useSpaces'
import { canTeach } from '../../lib/access'
import { createClass } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import { createSpace, joinSpace, updateSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import type { TeachingResource } from '../../lib/types'
import type { GeneralSpaceSummary } from '../../lib/general/types'
import { ClassForm } from '../classes/ClassForm'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'

type SpaceKind = 'education' | 'work'

export function NewSpaceDialog({
  open,
  onClose,
  onCreated,
  initialKind,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void | Promise<void>
  /** Skip the choice and open straight at this kind. */
  initialKind?: SpaceKind
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { show } = useToast()
  const teaching = canTeach(profile)
  // Only faculty who teach choose; everyone else can only make a work space.
  const startKind: SpaceKind | null = teaching ? (initialKind ?? null) : 'work'
  const choosing = teaching && !initialKind

  const [kind, setKind] = useState<SpaceKind | null>(startKind)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKind(startKind)
    setError(null)
  }, [open, startKind])

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

  function pick(next: SpaceKind | null) {
    setError(null)
    setKind(next)
  }

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
      show(`${created.name} created · code ${created.code}`)
      await onCreated?.()
      onClose()
      navigate(paths.class(created.id))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that class.'))
    } finally {
      setBusy(false)
    }
  }

  const back = choosing ? (
    <Button variant="ghost" onClick={() => pick(null)} disabled={busy}>
      Back
    </Button>
  ) : null

  if (kind === null) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Create space"
        description="Choose what the space is for. A space keeps its kind."
        size="sm"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <div className="grid gap-3">
          <KindOption
            icon="folder"
            tone="education"
            title="Education"
            body="A class. Students join with its code, and it has syllabus weeks, groups, projects and grading."
            onPick={() => pick('education')}
          />
          <KindOption
            icon="kanban"
            tone="work"
            title="Work"
            body="Projects, teams and reports for anything that isn't a class."
            onPick={() => pick('work')}
          />
        </div>
      </Modal>
    )
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
            {back}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button form="new-class" type="submit" loading={busy} className="!rounded-xl">
              Create class
            </Button>
          </>
        }
      >
        <ClassForm
          formId="new-class"
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
          {back}
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

/** One kind of space to pick, badged the way the sidebar badges it. */
function KindOption({
  icon,
  tone,
  title,
  body,
  onPick,
}: {
  icon: IconName
  tone: SpaceKind
  title: string
  body: string
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-start gap-3 rounded-card border border-line p-4 text-left transition-colors hover:border-line-strong"
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-lg ${
          tone === 'education'
            ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
            : 'surface-sunken text-muted'
        }`}
      >
        <Icon name={icon} size={17} />
      </span>
      <span>
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-muted">{body}</span>
      </span>
    </button>
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

export function EditSpaceDialog({
  open,
  onClose,
  space,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  space: GeneralSpaceSummary
  onSaved: () => void | Promise<void>
}) {
  const [name, setName] = useState(space.name)
  const [description, setDescription] = useState(space.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (busy) return
    setName(space.name)
    setDescription(space.description)
    setError(null)
    onClose()
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateSpace(space.id, name, description)
      await onSaved()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not update this space.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Edit space"
      description="Change how this space is identified."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-general-space"
            loading={busy}
            disabled={name.trim().length === 0}
          >
            Save
          </Button>
        </>
      }
    >
      <form id="edit-general-space" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={80}
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
