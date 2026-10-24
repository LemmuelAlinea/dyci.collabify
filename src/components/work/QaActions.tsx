import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { passTask, sendBackTask } from '../../lib/api/qa'
import { authErrorMessage } from '../../lib/authError'

const NOTE_LIMIT = 2000

/**
 * Pass and Send back for one task waiting in QA. Send back asks for a note,
 * which the holders read as a comment. Both reload through `onDone`; a refusal
 * from the database shows as a toast.
 */
export function QaActions({
  taskId,
  title,
  onDone,
}: {
  taskId: string
  title: string
  onDone: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState<'pass' | 'back' | null>(null)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function pass() {
    if (busy) return
    setBusy('pass')
    try {
      await passTask(taskId)
      show('Task passed')
      await onDone()
    } catch (err) {
      show(authErrorMessage(err, 'Could not pass that task. Try again.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function sendBack() {
    if (busy) return
    if (!note.trim()) return setError('Add a note saying what to fix.')
    setError(null)
    setBusy('back')
    try {
      await sendBackTask(taskId, note)
      show('Task sent back')
      setSending(false)
      setNote('')
      await onDone()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that task back. Try again.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const close = () => {
    setSending(false)
    setError(null)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy === 'pass'} disabled={busy === 'back'} onClick={() => void pass()}>
          <Icon name="check" size={14} />
          Pass
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setSending(true)}>
          Send back
        </Button>
      </div>
      <Modal
        open={sending}
        onClose={busy ? () => {} : close}
        title="Send back"
        description={title}
        size="md"
        focusField
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy === 'back'}>
              Cancel
            </Button>
            <Button onClick={() => void sendBack()} loading={busy === 'back'} disabled={!note.trim()}>
              Send back
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="What needs fixing" hint={<span className="text-[12px] text-faint">Shown to the holders as a comment.</span>}>
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                maxLength={NOTE_LIMIT}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  )
}
