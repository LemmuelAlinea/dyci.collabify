import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import type { MilestoneInput } from '../../lib/work/types'

/**
 * Create or edit a milestone. The parent passes a `key` that changes per
 * milestone, so the fields start from `initial` each time it opens.
 */
export function MilestoneDialog({
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
  initial: MilestoneInput
  onSubmit: (input: MilestoneInput) => Promise<unknown>
}) {
  const [name, setName] = useState(initial.name)
  const [dueOn, setDueOn] = useState(initial.dueOn)
  const [description, setDescription] = useState(initial.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A milestone needs a name.')
    if (!dueOn) return setError('A milestone needs a due date.')
    setBusy(true)
    try {
      await onSubmit({ name, description, dueOn })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the milestone.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
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
        <Field label="Due">
          {(id) => <Input id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />}
        </Field>
        <Field label="Description" optional hint={<span className="text-[12px] text-faint">What reaching it means, in a sentence.</span>}>
          {(id) => <Textarea id={id} rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
