import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { joinGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'

/**
 * Joining a project by its code.
 *
 * Lives here rather than on the space dashboard because a project code does not
 * belong to a space: redeeming one adds the caller to `general_members` and
 * nothing else, so somebody with no space at all can still use it. Offered on
 * both the space dashboard and the projects list for that reason — the projects
 * list is the only one of the two an account without a space can reach.
 */
export function JoinProjectDialog({
  open,
  onClose,
  onJoined,
}: {
  open: boolean
  onClose: () => void
  /** Run before navigating, for pages holding their own copy of the list. */
  onJoined?: () => void
}) {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const projectId = await joinGeneralProject(code)
      onClose()
      setCode('')
      onJoined?.()
      navigate(`/general/projects/${projectId}`)
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
      title="Join with a code"
      description="Whoever runs the project can give you its eight-character code."
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="join-general-project"
            loading={busy}
            disabled={code.trim().length < 8}
          >
            Join
          </Button>
        </>
      }
    >
      <form id="join-general-project" onSubmit={onSubmit} className="space-y-4">
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
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
