import { useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { answerAccessRequest, grantPermission, revokePermission } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A class board's leader decides who else commits straight to Main: grant it,
 * take it back, answer requests. Everyone else's work goes in as a change the
 * leader (or anyone they granted) reviews.
 */
export function CommitAccessButton({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const projectId = state.project?.id
  const pending = state.requests.filter((r) => r.permission === 'commit_main' && r.status === 'open')
  const others = state.members.filter((m) => m.user_id !== state.viewerId)

  async function act(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key)
    try {
      await action()
      show(done)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!projectId) return null

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Icon name="shield" size={14} />
        Commit access
        {pending.length > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-badge px-1.5 font-mono text-[11px] font-bold text-badge-ink">
            {pending.length}
          </span>
        )}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Who commits to Main"
        description="As the group leader you always can. Groupmates without it submit their drafts for review instead."
        footer={
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="space-y-5">
          {pending.length > 0 && (
            <section>
              <p className="eyebrow mb-2">Asking for it</p>
              <ul className="space-y-2">
                {pending.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line px-3.5 py-3">
                    <p className="text-[14px] font-medium text-ink">{state.nameOf(r.user_id)}</p>
                    {r.reason && <p className="mt-0.5 text-[13px] text-muted">{r.reason}</p>}
                    <div className="mt-2.5 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => void act(r.id, () => answerAccessRequest(r.id, false, ''), 'Request declined')}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        loading={busy === r.id}
                        disabled={busy !== null && busy !== r.id}
                        onClick={() =>
                          void act(r.id, () => answerAccessRequest(r.id, true, ''), `${state.nameOf(r.user_id)} can commit to Main`)
                        }
                      >
                        Approve
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className="eyebrow mb-2">Groupmates</p>
            {others.length === 0 ? (
              <p className="text-[13px] text-muted">Nobody else is on this board.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
                {others.map((m) => {
                  const can = state.commitRights.committers.includes(m.user_id)
                  return (
                    <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                      {m.profile && <Avatar profile={m.profile} size={30} />}
                      <div className="min-w-[140px] flex-1">
                        <p className="truncate text-[14px] font-medium text-ink">{state.nameOf(m.user_id)}</p>
                        <p className="text-[12px] text-faint">{can ? 'Commits to Main' : 'Submits drafts for review'}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={can ? 'ghost' : 'outline'}
                        loading={busy === m.user_id}
                        disabled={busy !== null && busy !== m.user_id}
                        onClick={() =>
                          void act(
                            m.user_id,
                            () =>
                              can
                                ? revokePermission(projectId, m.user_id, 'commit_main')
                                : grantPermission(projectId, m.user_id, 'commit_main'),
                            can ? `${state.nameOf(m.user_id)} now submits for review` : `${state.nameOf(m.user_id)} can commit to Main`,
                          )
                        }
                      >
                        {can ? 'Take back' : 'Let them commit'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </Modal>
    </>
  )
}
