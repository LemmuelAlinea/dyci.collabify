import { useEffect, useId, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { CheckboxList } from '../ui/CheckboxList'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { shareDraftPath } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { fullName } from '../../lib/types'
import type { GeneralProjectState } from './useGeneralProject'

export type ShareTarget = { type: 'file' | 'folder'; path: string }

/**
 * Hands a copy of a draft file or folder to some of the project's other
 * members. Only members are offered, and the database refuses anybody else.
 */
export function ShareDialog({
  repoId,
  target,
  state,
  onClose,
}: {
  repoId: string
  target: ShareTarget | null
  state: GeneralProjectState
  onClose: () => void
}) {
  const { show } = useToast()
  const allId = useId()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const items = state.members
    .filter((m) => m.user_id !== state.viewerId && m.profile?.status !== 'rejected')
    .map((m) => ({ id: m.user_id, label: m.profile ? fullName(m.profile) : 'A member' }))
  const everyone = items.length > 0 && picked.length === items.length

  useEffect(() => {
    if (target) {
      setPicked([])
      setError(null)
    }
  }, [target])

  async function share() {
    if (!target || picked.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await shareDraftPath(repoId, target.path, target.type === 'folder', picked)
      show(everyone ? 'Shared with all members' : `Shared with ${picked.length === 1 ? '1 person' : `${picked.length} people`}`)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not share it. Try again in a moment.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={`Share this ${target?.type ?? 'file'}`}
      description={
        target ? `${target.path} goes over as a copy of what is in your draft now. Changes you make later stay yours.` : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={picked.length === 0} onClick={() => void share()}>
            Share
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {items.length === 0 ? (
          <Alert tone="info">Nobody else is on this project yet, so there is nobody to share with.</Alert>
        ) : (
          <>
            <label
              htmlFor={allId}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-2 py-2 text-[13px] font-medium text-ink hover:bg-[var(--surface-sunken)]"
            >
              <input
                id={allId}
                type="checkbox"
                checked={everyone}
                onChange={() => setPicked(everyone ? [] : items.map((i) => i.id))}
                className="h-4 w-4 shrink-0 accent-navy-600"
              />
              All members
              <span className="ml-auto font-mono text-[11px] text-faint">{items.length}</span>
            </label>
            <CheckboxList items={items} selected={picked} onChange={setPicked} label="Members" searchable />
          </>
        )}
      </div>
    </Modal>
  )
}
