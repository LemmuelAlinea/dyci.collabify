import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { EmptyState } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { START_DM_MESSAGE, startDirectConversation } from '../../lib/api/messages'
import { authErrorMessage } from '../../lib/authError'
import { fullName } from '../../lib/types'
import type { ClassMember } from '../../lib/types'

type Props = {
  members: ClassMember[]
  /** Professors manage; students see names only. */
  canManage: boolean
  showEmail: boolean
  onRemove?: (member: ClassMember) => Promise<void>
  /** Puts them back with what they held. Returns what came back. */
  onRestore?: (member: ClassMember) => Promise<{ groups?: number; tasks?: number } | void>
  emptyBody: string
  /** Professors only: open a direct thread from the roster. */
  canMessage?: boolean
}

export function RosterTable({
  members,
  canManage,
  showEmail,
  onRemove,
  onRestore,
  emptyBody,
  canMessage = false,
}: Props) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [pendingRemove, setPendingRemove] = useState<ClassMember | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  /** Finds the thread or makes it, then lands on it ready to type. */
  async function message(member: ClassMember) {
    setOpening(member.student_id)
    try {
      const res = await startDirectConversation(member.student_id)
      if (res.result !== 'ok' || !res.conversation_id) {
        show(START_DM_MESSAGE[res.result as keyof typeof START_DM_MESSAGE], 'error')
        return
      }
      navigate(`/professor/messages/${res.conversation_id}`)
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that conversation.'), 'error')
    } finally {
      setOpening(null)
    }
  }

  const active = members.filter((m) => m.status === 'active')
  const removed = members.filter((m) => m.status === 'removed')

  if (members.length === 0) {
    return <EmptyState icon="users" title="Nobody here yet" body={emptyBody} />
  }

  return (
    <div className="space-y-6">
      <ol className="surface divide-y divide-[var(--line)] rounded-card border border-line shadow-card">
        {active.map((m, i) => (
          <li key={m.student_id} className="flex items-center gap-4 px-5 py-3.5">
            <span className="w-6 shrink-0 text-right font-mono text-[12px] text-faint tabular-nums">
              {i + 1}
            </span>
            <Avatar profile={m.profile} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14.5px] font-medium text-ink">
                {m.profile.last_name}, {m.profile.first_name}
                {m.profile.middle_name ? ` ${m.profile.middle_name[0]}.` : ''}
              </p>
              {showEmail && <p className="truncate text-[12.5px] text-faint">{m.profile.email}</p>}
            </div>
            {canMessage && (
              <button
                type="button"
                onClick={() => void message(m)}
                disabled={opening === m.student_id}
                aria-label={`Message ${fullName(m.profile)}`}
                title="Send a direct message"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-navy-600 disabled:opacity-50 dark:hover:text-navy-200"
              >
                <Icon name="message" size={17} />
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setPendingRemove(m)}
                aria-label={`Remove ${fullName(m.profile)}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
              >
                <Icon name="x" size={17} />
              </button>
            )}
          </li>
        ))}
      </ol>

      {canManage && removed.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="eyebrow text-faint">
              Removed · {removed.length} {removed.length === 1 ? 'student' : 'students'}
            </p>
            <p className="text-[12px] text-faint">
              Their group and their claimed tasks are kept, and come back with them.
            </p>
          </div>
          <ol className="surface divide-y divide-[var(--line)] rounded-card border border-line">
            {removed.map((m) => (
              <li key={m.student_id} className="flex items-center gap-4 px-5 py-3.5">
                <Avatar profile={m.profile} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-muted">
                    {m.profile.last_name}, {m.profile.first_name}
                  </p>
                  {m.removed_at && (
                    <p className="text-[12px] text-faint">
                      Removed {new Date(m.removed_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  loading={restoring === m.student_id}
                  onClick={async () => {
                    setRestoring(m.student_id)
                    try {
                      const back = await onRestore?.(m)
                      const bits = [
                        back?.groups ? `${back.groups} group` : '',
                        back?.tasks
                          ? `${back.tasks} ${back.tasks === 1 ? 'task' : 'tasks'}`
                          : '',
                      ].filter(Boolean)
                      show(
                        bits.length
                          ? `${m.profile.first_name} is back, with ${bits.join(' and ')}`
                          : `${m.profile.first_name} is back in the class`,
                      )
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not put them back.'), 'error')
                    } finally {
                      setRestoring(null)
                    }
                  }}
                >
                  <Icon name="refresh" size={15} />
                  Put back
                </Button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (!pendingRemove) return
          await onRemove?.(pendingRemove)
          show(`${fullName(pendingRemove.profile)} removed`)
        }}
        title="Remove this student?"
        body={
          <>
            <strong className="text-ink">
              {pendingRemove ? fullName(pendingRemove.profile) : ''}
            </strong>{' '}
            loses access to this class and cannot rejoin with the code. Their group and the
            tasks they had claimed are set aside, not destroyed — putting them back from the
            removed list below returns both.
          </>
        }
        confirmLabel="Remove student"
      />
    </div>
  )
}
