import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { createGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { presetById, presetPayload } from '../../lib/general/presets'
import type { PresetAudience } from '../../lib/general/presets'
import { PresetPicker } from './PresetPicker'

/**
 * Four things and a starting shape, all changeable later. A preset writes the
 * fields, teams, positions and tasks its kind of project usually needs, so
 * nobody types out a research timeline from memory — but people are still
 * added on the project itself, where they can be seen in context.
 */
export function NewProjectDialog({
  open,
  onClose,
  spaceId,
}: {
  open: boolean
  onClose: () => void
  /** The space it goes into. Left out, the database uses your own. */
  spaceId?: string | null
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [preset, setPreset] = useState('blank')
  const [audience, setAudience] = useState<PresetAudience | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Give the project a name.')
    if (startsOn && endsOn && endsOn < startsOn) return setError('The end date is before the start date.')
    setBusy(true)
    try {
      const chosen = presetById(preset)
      const project = await createGeneralProject({
        name,
        description,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        preset: chosen && chosen.id !== 'blank' ? chosen.id : null,
        content: chosen && chosen.id !== 'blank' ? presetPayload(chosen) : null,
        spaceId,
      })
      onClose()
      navigate(`/general/projects/${project.id}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="You become its Owner. You can change all of this later."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-general-project" loading={busy}>
            Create project
          </Button>
        </>
      }
    >
      <form id="new-general-project" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={LIMIT.generalName}
              placeholder="Intramurals 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="What it is for" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              placeholder="The goal, who it is for, and what done looks like."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" optional>
            {(id) => (
              <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            )}
          </Field>
          <Field label="Ends" optional>
            {(id) => (
              <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            )}
          </Field>
        </div>
        <PresetPicker
          value={preset}
          onChange={setPreset}
          audience={audience}
          onAudienceChange={setAudience}
        />
      </form>
    </Modal>
  )
}
