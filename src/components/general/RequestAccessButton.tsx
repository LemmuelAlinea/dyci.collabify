// src/components/general/RequestAccessButton.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { requestAccess } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { PERMISSIONS, permissionLabel, requestable } from '../../lib/general/permissions'
import type { GeneralPermission } from '../../lib/general/permissions'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Shown exactly where a Member runs into something they cannot do.
 *
 * Nothing renders for somebody who already holds the permission, for an Owner
 * or Manager, or on an archived project. Once asked, it says so rather than
 * offering to ask again, because a second request is refused anyway.
 */
export function RequestAccessButton({
  state,
  permission,
}: {
  state: GeneralProjectState
  permission: GeneralPermission
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!state.project || state.archived || state.me?.level !== 'member') return null
  if (state.myOpenRequests.includes(permission)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg surface-sunken px-2.5 py-1 text-[12px] text-muted">
        <Icon name="clock" size={13} />
        Access requested
      </span>
    )
  }
  if (!requestable(state.me.level, state.myGrants, state.myOpenRequests).includes(permission)) return null

  async function send() {
    if (!state.project) return
    setError(null)
    setBusy(true)
    try {
      await requestAccess(state.project.id, permission, reason)
      show('Request sent to the Owners')
      setOpen(false)
      setReason('')
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send that request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon name="lock" size={14} />
        Request access
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Ask for: ${permissionLabel(permission)}`}
        description={PERMISSIONS.find((p) => p.value === permission)?.note}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void send()} loading={busy}>
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Why you need it" optional>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={LIMIT.accessReason}
                placeholder="What you are working on, so an Owner can decide quickly."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          <p className="text-[12px] text-faint">
            Every Owner of this project is notified. You hear back either way.
          </p>
        </div>
      </Modal>
    </>
  )
}
