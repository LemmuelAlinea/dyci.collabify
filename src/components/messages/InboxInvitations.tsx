import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { useSearchParams } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { usePendingInvitations } from '../../hooks/usePendingInvitations'
import { respondToInvitation } from '../../lib/api/general'
import { respondToSpaceInvitation } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'

type Invite = {
  /** `project:<id>` or `space:<id>` — what a notification links to with `?invite=`. */
  target: string
  id: string
  kind: 'Project' | 'Space' | 'Class'
  name: string
  description: string
  inviter: { first_name: string; last_name: string; avatar_url: string | null } | null
  createdAt: string
  answer: (accept: boolean) => Promise<void>
}

/**
 * Every invitation waiting on this person — projects, spaces and classes — in
 * one list, the only place any of them is answered. A notification opens the
 * Inbox with `?invite=`, and the matching row is brought into view and marked.
 */
export function InboxInvitations({ onAnswered }: { onAnswered?: () => void }) {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigation = useGeneralNavigation()
  const projects = usePendingInvitations(profile?.id)
  const [params, setParams] = useSearchParams()
  const [answering, setAnswering] = useState<string | null>(null)
  const reduce = useReducedMotion()
  const rows = useRef(new Map<string, HTMLLIElement>())

  const target = params.get('invite')

  const invites: Invite[] = [
    ...(projects.invitations ?? []).map(
      (inv): Invite => ({
        target: `project:${inv.project_id}`,
        id: inv.id,
        kind: 'Project',
        name: inv.project?.name ?? 'A project',
        description: inv.project?.description ?? '',
        inviter: inv.inviter ?? null,
        createdAt: inv.created_at,
        answer: (accept) => respondToInvitation(inv.id, accept),
      }),
    ),
    ...navigation.invitations.map(
      (inv): Invite => ({
        target: `space:${inv.space_id}`,
        id: inv.invitation_id,
        kind: inv.space_kind === 'education' ? 'Class' : 'Space',
        name: inv.space_name,
        description: inv.space_description,
        inviter: inv.inviter_id
          ? {
              first_name: inv.inviter_first_name ?? '',
              last_name: inv.inviter_last_name ?? '',
              avatar_url: inv.inviter_avatar_url,
            }
          : null,
        createdAt: inv.created_at,
        answer: (accept) => respondToSpaceInvitation(inv.invitation_id, accept),
      }),
    ),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const loaded = projects.invitations !== null && navigation.spaces !== null
  const found = target ? invites.some((i) => i.target === target) : false

  useEffect(() => {
    if (!loaded || !target) return
    rows.current.get(target)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [loaded, target, reduce])

  async function answer(invite: Invite, accept: boolean) {
    setAnswering(invite.id)
    try {
      await invite.answer(accept)
      show(accept ? `You joined ${invite.name}` : 'Invitation declined')
      if (invite.target === target) {
        const next = new URLSearchParams(params)
        next.delete('invite')
        setParams(next, { replace: true })
      }
      await Promise.all([projects.reload(), navigation.reload()])
      onAnswered?.()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation. Try again.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  return (
    <>
      {projects.error && <Alert tone="error">{projects.error}</Alert>}

      {loaded && target && !found && (
        <Alert tone="info">That invitation was already answered or withdrawn.</Alert>
      )}

      {invites.length > 0 && (
        <section
          aria-labelledby="inbox-invitations"
          className="overflow-hidden rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8"
        >
          <header className="flex items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
            <div>
              <h2 id="inbox-invitations">Invitations</h2>
              <p className="mt-0.5 text-[12px] text-muted">Projects, spaces and classes waiting for your answer.</p>
            </div>
            <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
              {invites.length}
            </span>
          </header>
          <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
            {invites.map((invite) => {
              const marked = invite.target === target
              return (
                <li
                  key={invite.target + invite.id}
                  ref={(el) => {
                    if (el) rows.current.set(invite.target, el)
                    else rows.current.delete(invite.target)
                  }}
                  aria-current={marked ? 'true' : undefined}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors sm:px-5 ${
                    marked ? 'bg-amber-400/15 ring-2 ring-amber-400 ring-inset' : ''
                  }`}
                >
                  {invite.inviter && <Avatar profile={invite.inviter} size={34} />}
                  <div className="min-w-[14rem] flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                      {invite.name}
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          invite.kind === 'Class'
                            ? 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
                            : 'border border-line text-muted'
                        }`}
                      >
                        {invite.kind}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {invite.inviter
                        ? `${`${invite.inviter.first_name} ${invite.inviter.last_name}`.trim()} invited you${
                            invite.kind === 'Class' ? ' to teach this class' : ''
                          }`
                        : 'You were invited'}
                      {invite.description ? ` · ${invite.description.slice(0, 90)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={answering === invite.id}
                      onClick={() => void answer(invite, false)}
                    >
                      Decline
                    </Button>
                    <Button size="sm" loading={answering === invite.id} onClick={() => void answer(invite, true)}>
                      <Icon name="check" size={14} />
                      Join
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </>
  )
}
