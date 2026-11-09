// src/components/general/settings/JoinRequestsPanel.tsx
import { useEffect, useState } from 'react'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { answerJoinRequest } from '../../../lib/api/general'
import { listSpaceMembers } from '../../../lib/api/spaces'
import { authErrorMessage } from '../../../lib/authError'
import { formatDue } from '../../../lib/general/dates'
import { ROLE_LABEL, defaultInviteRole, inviteRoles } from '../../../lib/general/permissions'
import type { ProjectRole } from '../../../lib/general/permissions'
import type { JoinRequest } from '../../../lib/general/types'
import { fullName } from '../../../lib/types'
import type { GeneralProjectState } from '../useGeneralProject'

/**
 * Space members asking to join this Workspace project. The project manager and
 * coordinators answer here; nothing renders for anybody else or when none is open.
 *
 * Requesters are not on the project, so their names come from the space's
 * member list rather than the project's.
 */
export function JoinRequestsPanel({ state }: { state: GeneralProjectState }) {
  const open = state.joinRequests.filter((r) => r.status === 'open')
  const spaceId = state.project?.space_id
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [spaceRoles, setSpaceRoles] = useState<Map<string, ProjectRole>>(new Map())
  const listed = open.length > 0

  useEffect(() => {
    if (!spaceId || !listed) return
    let live = true
    listSpaceMembers(spaceId)
      .then((people) => {
        if (!live) return
        setNames(new Map(people.map((p) => [p.user_id, fullName(p)])))
        setSpaceRoles(new Map(people.flatMap((p) => (p.role ? [[p.user_id, p.role] as const] : []))))
      })
      // A failure costs names, not the panel.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [spaceId, listed])

  if (!state.canGrant || state.archived || !state.myRole || open.length === 0) return null

  return (
    <section aria-label="Join requests" className="rounded-xl border border-warning-300 bg-warning-400/6 p-4 dark:border-warning-400/40 dark:bg-warning-400/8">
      <h3 className="text-[14px] font-medium text-ink">Asking to join</h3>
      <p className="mt-0.5 text-[12px] text-muted">People in your space who want to be on this project.</p>
      <ul className="mt-3 space-y-3">
        {open.map((r) => (
          <JoinRequestRow key={r.id} request={r} name={names.get(r.user_id)} spaceRole={spaceRoles.get(r.user_id)} state={state} />
        ))}
      </ul>
    </section>
  )
}

function JoinRequestRow({
  request,
  name: known,
  spaceRole,
  state,
}: {
  request: JoinRequest
  name: string | undefined
  spaceRole: ProjectRole | undefined
  state: GeneralProjectState
}) {
  const name = known ?? 'Someone in your space'
  const { show } = useToast()
  const roles = inviteRoles(state.myRole as ProjectRole)
  // Starts on the space role once the list loads; a role the manager picked is never overwritten.
  const [chosen, setChosen] = useState<ProjectRole | null>(null)
  const role = chosen ?? defaultInviteRole(spaceRole, roles)
  const [busy, setBusy] = useState(false)

  async function answer(approve: boolean) {
    setBusy(true)
    try {
      if (approve) {
        await answerJoinRequest(request.id, true, role)
        show(`${known ?? 'They'} joined as ${ROLE_LABEL[role]}`)
      } else {
        await answerJoinRequest(request.id, false)
        show('Request declined')
      }
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that request. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{name}</p>
        <p className="text-[12px] text-muted">Asked {formatDue(request.created_at)}</p>
      </div>
      <div className="w-40">
        <Select
          aria-label={`Role for ${name}`}
          value={role}
          disabled={busy}
          onChange={(e) => setChosen(e.target.value as ProjectRole)}
          options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          className="!h-9 !text-[13px]"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
          Decline
        </Button>
        <Button size="sm" loading={busy} onClick={() => void answer(true)}>
          Approve
        </Button>
      </div>
    </li>
  )
}
