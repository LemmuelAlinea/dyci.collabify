import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberSpace } from '../../hooks/useSpaces'
import { createSpace, joinSpace, updateSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralSpaceSummary } from '../../lib/general/types'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'

export function NewSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: () => void | Promise<void>
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
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
      navigate(`/general/spaces/${space.id}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create that space.'))
    } finally {
      setBusy(false)
    }
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
      <form id="new-general-space" onSubmit={onSubmit} className="space-y-4">
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
      navigate(`/general/spaces/${spaceId}`)
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
