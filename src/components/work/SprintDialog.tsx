import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import type { SprintInput } from '../../lib/work/types'

/**
 * Create or edit a sprint. The parent passes a `key` that changes per sprint,
 * so the fields start from `initial` each time it opens.
 */
export function SprintDialog({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: SprintInput
  onSubmit: (input: SprintInput) => Promise<unknown>
}) {
  const [name, setName] = useState(initial.name)
  const [goal, setGoal] = useState(initial.goal)
  const [startsOn, setStartsOn] = useState(initial.startsOn)
  const [endsOn, setEndsOn] = useState(initial.endsOn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A sprint needs a name.')
    if (!startsOn || !endsOn) return setError('A sprint needs a start and an end date.')
    if (endsOn < startsOn) return setError('A sprint cannot end before it starts. Move one of the two dates.')
    setBusy(true)
    try {
      await onSubmit({ name, goal, startsOn, endsOn })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the sprint.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
          <Field label="Ends">
            {(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
          </Field>
        </div>
        <Field label="Goal" optional hint={<span className="text-[12px] text-faint">What this sprint should get done, in a sentence.</span>}>
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
