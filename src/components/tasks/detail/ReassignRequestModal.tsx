import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Alert } from '../../ui/Alert'
import { Modal } from '../../ui/Modal'
import { Textarea } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { requestReassignment } from '../../../lib/api/reassignments'
import { authErrorMessage } from '../../../lib/authError'
import { REASSIGNMENT_OUTCOMES } from '../../../lib/types'
import type { ReassignmentOutcome } from '../../../lib/types'

/**
 * Asking for a task to change hands.
 *
 * The reason is required and goes only to the professor — the person holding
 * the task never reads it. Saying so on the form matters: a student writing
 * about a groupmate should know who is on the other end before they write it.
 */
export function ReassignRequestModal({
  open,
  onClose,
  taskId,
  taskTitle,
  /** Who has it now, when it is one person. Null when nobody or several do. */
  holderName,
  mine,
  onDone,
}: {
  open: boolean
  onClose: () => void
  taskId: string
  taskTitle: string
  holderName: string | null
  /** The viewer is on this task, so the sensible default is handing it back. */
  mine: boolean
  onDone: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [wants, setWants] = useState<ReassignmentOutcome>(mine ? 'release' : 'take_over')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setReason('')
    setError(null)
    setWants(mine ? 'release' : 'take_over')
    onClose()
  }

  async function submit() {
    if (!reason.trim()) {
      setError('Say why this needs to change hands. Your professor reads this.')
      return
    }
    setBusy(true)
    try {
      await requestReassignment({ taskId, wants, reason })
      show('Request sent to your professor')
      await onDone()
      close()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send that request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Ask for this to change hands"
      description={taskTitle}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Sending…' : 'Send request'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        <p className="text-[13px] leading-relaxed text-muted">
          {holderName
            ? `${holderName} holds this task. Your professor decides whether it moves.`
            : 'Your professor decides whether this moves.'}
        </p>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] font-medium text-ink">What should happen</legend>
          {REASSIGNMENT_OUTCOMES.map((o) => (
            <label
              key={o.value}
              className={`flex cursor-pointer gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                wants === o.value
                  ? 'border-navy-400 bg-navy-50 dark:border-navy-300 dark:bg-navy-500/12'
                  : 'border-line hover:border-line-strong'
              }`}
            >
              <input
                type="radio"
                name="wants"
                value={o.value}
                checked={wants === o.value}
                onChange={() => setWants(o.value)}
                className="mt-0.5 accent-navy-600"
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-ink">{o.label}</span>
                <span className="block text-[12px] text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <Field label="Why">
          {(id) => (
            <>
              <Textarea
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="What has happened, and what it is holding up."
              />
              <p className="mt-1.5 text-[12px] text-faint">
                Only your professor reads this. Whoever holds the task does not.
              </p>
            </>
          )}
        </Field>
      </div>
    </Modal>
  )
}
