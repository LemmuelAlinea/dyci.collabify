// src/components/general/MembersTab.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  grantPermission,
  leaveProject,
  removeMember,
  revokePermission,
  setMemberLevel,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, PERMISSIONS, canStepDown, levelLabel, permissionLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type { GeneralMember } from '../../lib/general/types'
import { InvitePanel } from './InvitePanel'
import { RequestsPanel } from './RequestsPanel'
import { StructurePanel } from './StructurePanel'
import type { GeneralProjectState } from './useGeneralProject'

export function MembersTab({ state }: { state: GeneralProjectState }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-6">
        <MemberList state={state} />
        <StructurePanel state={state} />
      </div>
      <div className="space-y-6">
        <RequestsPanel state={state} />
        <InvitePanel state={state} />
      </div>
    </div>
  )
}

function MemberList({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [permissionsFor, setPermissionsFor] = useState<GeneralMember | null>(null)
  const [removing, setRemoving] = useState<GeneralMember | null>(null)
  const [leaving, setLeaving] = useState(false)
  const project = state.project
  if (!project) return null

  const canRemove = (m: GeneralMember) =>
    m.user_id !== state.viewerId &&
    state.can('manage_members') &&
    (m.level === 'member' || state.isOwner)

  async function changeLevel(m: GeneralMember, level: GeneralLevel) {
    if (!project) return
    try {
      await setMemberLevel(project.id, m.user_id, level)
      show(`${state.nameOf(m.user_id)} is now ${levelLabel(level)}`)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that access level.'), 'error')
    }
  }

  const positionsOf = (userId: string) =>
    state.holders
      .filter((h) => h.user_id === userId)
      .map((h) => state.positions.find((p) => p.id === h.position_id)?.name)
      .filter(Boolean) as string[]

  const me = state.me

  return (
    <section className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <h2>Members</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Owners and Managers can do everything. Members do what they were given.
          </p>
        </div>
        <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
          {state.members.length}
        </span>
      </header>

      <ul className="divide-y divide-[var(--line)]">
        {state.members.map((m) => {
          const grants = state.grants.filter((g) => g.user_id === m.user_id).map((g) => g.permission)
          const positions = positionsOf(m.user_id)
          return (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
              {m.profile && <Avatar profile={m.profile} size={36} />}
              <div className="min-w-[12rem] flex-1">
                <p className="text-[14px] font-medium text-ink">
                  {state.nameOf(m.user_id)}
                  {m.user_id === state.viewerId && <span className="ml-1.5 text-[12px] font-normal text-faint">you</span>}
                </p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {positions.length > 0 ? positions.join(', ') : 'No position'}
                  {grants.length > 0 && ` · Also: ${grants.map(permissionLabel).join(', ')}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {state.isOwner && !state.archived ? (
                  <Select
                    aria-label={`Access level for ${state.nameOf(m.user_id)}`}
                    value={m.level}
                    onChange={(e) => void changeLevel(m, e.target.value as GeneralLevel)}
                    options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
                    className="!h-9 !w-[8.5rem] !text-[13px]"
                  />
                ) : (
                  <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                    {levelLabel(m.level)}
                  </span>
                )}
                {state.isOwner && !state.archived && m.level === 'member' && (
                  <Button size="sm" variant="ghost" onClick={() => setPermissionsFor(m)}>
                    Permissions
                  </Button>
                )}
                {canRemove(m) && (
                  <button
                    type="button"
                    aria-label={`Remove ${state.nameOf(m.user_id)}`}
                    onClick={() => setRemoving(m)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {me && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          {canStepDown(me.level, state.ownerCount) ? (
            <>
              <p className="text-[12px] text-faint">Leaving removes your tasks' assignments and your positions.</p>
              <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                Leave project
              </Button>
            </>
          ) : (
            <p className="text-[12px] text-faint">
              You are the only Owner. Make someone else an Owner before you leave.
            </p>
          )}
        </footer>
      )}

      <PermissionsDialog member={permissionsFor} state={state} onClose={() => setPermissionsFor(null)} />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await removeMember(project.id, removing.user_id)
          show(`${state.nameOf(removing.user_id)} removed`)
          await state.reload()
        }}
        title={`Remove ${removing ? state.nameOf(removing.user_id) : 'this person'}?`}
        body="They lose access to the project, its tasks and its conversation. Tasks they created stay. You can invite them again."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          await leaveProject(project.id)
          show('You left the project')
          navigate('/general')
        }}
        title={`Leave ${project.name}?`}
        body="You lose access to the project and its conversation until somebody invites you back."
        confirmLabel="Leave project"
      />
    </section>
  )
}

function PermissionsDialog({
  member,
  state,
  onClose,
}: {
  member: GeneralMember | null
  state: GeneralProjectState
  onClose: () => void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const project = state.project
  const held = member ? state.grants.filter((g) => g.user_id === member.user_id).map((g) => g.permission) : []

  async function toggle(permission: (typeof PERMISSIONS)[number]['value'], on: boolean) {
    if (!project || !member) return
    setBusy(permission)
    try {
      if (on) await grantPermission(project.id, member.user_id, permission)
      else await revokePermission(project.id, member.user_id, permission)
      show(on ? `Granted: ${permissionLabel(permission)}` : `Taken back: ${permissionLabel(permission)}`)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that permission.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      title={member ? `What ${state.nameOf(member.user_id)} can also do` : 'Permissions'}
      description="On top of what every Member can do. To give everything, make them a Manager instead."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <ul className="space-y-2">
        {PERMISSIONS.map((p) => {
          const on = held.includes(p.value)
          return (
            <li key={p.value}>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 hover:bg-[var(--surface-sunken)]">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={busy !== null}
                  onChange={(e) => void toggle(p.value, e.target.checked)}
                />
                <span>
                  <span className="block text-[14px] font-medium text-ink">{p.label}</span>
                  <span className="block text-[12px] text-muted">{p.note}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
