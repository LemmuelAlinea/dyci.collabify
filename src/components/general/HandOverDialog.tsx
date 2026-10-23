import { useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { handOverProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * The project manager picks who takes over. Only an active member who has
 * Project manager turned on can run a project, so only they are listed; the
 * database checks the same thing again when the hand over is confirmed.
 */
export function HandOverDialog({
  open,
  onClose,
  state,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
}) {
  const { show } = useToast()
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const project = state.project

  useEffect(() => {
    if (!open) setChosen(null)
  }, [open])

  const eligible = state.members.filter(
    (m) =>
      m.user_id !== state.viewerId &&
      m.profile?.status === 'active' &&
      m.profile.can_manage_projects,
  )
  const picked = eligible.find((m) => m.user_id === chosen) ?? null

  async function confirm() {
    if (!project || !picked) return
    setBusy(true)
    try {
      await handOverProject(project.id, picked.user_id)
      show(`${state.nameOf(picked.user_id)} is now the project manager`)
      onClose()
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not hand over the project.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Hand over project"
      description={
        eligible.length > 0
          ? 'Choose who runs this project from now on.'
          : undefined
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {eligible.length > 0 ? 'Cancel' : 'Close'}
          </Button>
          {eligible.length > 0 && (
            <Button onClick={() => void confirm()} loading={busy} disabled={!picked}>
              Hand over project
            </Button>
          )}
        </>
      }
    >
      {eligible.length === 0 ? (
        <p className="text-[14px] leading-relaxed text-muted">
          Nobody here has Project manager turned on. Ask the admin to turn it on for the person you
          want, then hand over.
        </p>
      ) : (
        <fieldset>
          <legend className="sr-only">New project manager</legend>
          <ul className="space-y-2">
            {eligible.map((m) => {
              const on = chosen === m.user_id
              return (
                <li key={m.user_id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                      on
                        ? 'border-navy-500 bg-navy-50 dark:bg-navy-500/15'
                        : 'border-line hover:bg-[var(--surface-sunken)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="new-project-manager"
                      checked={on}
                      onChange={() => setChosen(m.user_id)}
                    />
                    {m.profile && <Avatar profile={m.profile} size={30} />}
                    <span className="text-[14px] font-medium text-ink">{state.nameOf(m.user_id)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {picked && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted" aria-live="polite">
              You become a coordinator. They become the project manager.
            </p>
          )}
        </fieldset>
      )}
    </Modal>
  )
}
