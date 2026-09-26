import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { JOIN_MESSAGE, joinClass } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'

/**
 * Entering a class code. The one thing a student can do before anybody has let
 * them in, so it opens from the dashboard as well as the classes page.
 */
export function JoinClassDialog({
  open,
  onClose,
  onJoined,
}: {
  open: boolean
  onClose: () => void
  onJoined?: () => void | Promise<void>
}) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setCode('')
    setError(null)
    onClose()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { result, class_id } = await joinClass(code)
      if (result === 'joined') {
        close()
        show('You joined the class')
        await onJoined?.()
        if (class_id) navigate(`/student/classes/${class_id}`)
      } else if (result === 'already_member' && class_id) {
        close()
        navigate(`/student/classes/${class_id}`)
      } else {
        setError(JOIN_MESSAGE[result])
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not join that class.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Join a class"
      description="Enter the code your professor gave you."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button form="join-class" type="submit" loading={busy} className="!rounded-xl">
            Join class
          </Button>
        </>
      }
    >
      <form id="join-class" onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Class code">
          {(id) => (
            <Input
              id={id}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="DBM-7823"
              autoComplete="off"
              className="font-mono tracking-widest"
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
