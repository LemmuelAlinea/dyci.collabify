// src/components/general/MembersTab.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { ScrollTenList } from '../ui/ScrollTenList'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import {
  grantPermission,
  leaveProject,
  removeMember,
  revokePermission,
  searchPeople,
  setMemberRole,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'
import {
  PERMISSIONS,
  ROLE_LABEL,
  assignableRoles,
  canGive,
  canRemoveRole,
  permissionLabel,
} from '../../lib/general/permissions'
import type { ProjectRole } from '../../lib/general/permissions'
import type { GeneralMember } from '../../lib/general/types'
import { HandOverDialog } from './HandOverDialog'
import { InvitePanel } from './InvitePanel'
import { RequestsPanel } from './RequestsPanel'
import { RoleBadge } from './RoleBadge'
import { RoleGuide } from './RoleGuide'
import { SkillTags } from './SkillTags'
import { StructurePanel } from './StructurePanel'
import type { GeneralProjectState } from './useGeneralProject'

const ROLE_ORDER: Record<ProjectRole, number> = {
  pm: 0,
  coordinator: 1,
  stakeholder: 2,
  qa: 3,
  member: 5,
}

export function MembersTab({ state }: { state: GeneralProjectState }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
      <div className="space-y-6">
        <MemberList state={state} />
        <RoleGuide />
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
  const { profile: viewer } = useAuth()
  const navigate = useNavigate()
  const [permissionsFor, setPermissionsFor] = useState<GeneralMember | null>(null)
  const [removing, setRemoving] = useState<GeneralMember | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [query, setQuery] = useState('')
  const [emailResult, setEmailResult] = useState<{ query: string; id: string | null } | null>(null)
  const project = state.project

  // The database refuses what canRemoveRole refuses.
  const canRemove = (m: GeneralMember) =>
    m.user_id !== state.viewerId &&
    state.can('manage_members') &&
    canRemoveRole(state.myRole, m.role)

  /** The roles a row's select offers: its own, then the ones the viewer may move it to. */
  function roleChoices(m: GeneralMember): ProjectRole[] {
    if (!state.myRole || state.archived) return []
    const moves = assignableRoles(state.myRole, m.role)
    return moves.some((r) => r !== m.role) ? [m.role, ...moves.filter((r) => r !== m.role)] : []
  }

  async function changeRole(m: GeneralMember, role: ProjectRole) {
    if (!project) return
    try {
      await setMemberRole(project.id, m.user_id, role)
      show(`${state.nameOf(m.user_id)} is now a ${ROLE_LABEL[role].toLowerCase()}`)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that role.'), 'error')
    }
  }

  const leads = new Set(state.teams.flatMap((t) => (t.leader_id ? [t.leader_id] : [])))

  const positionsOf = (userId: string) =>
    state.holders
      .filter((h) => h.user_id === userId)
      .map((h) => state.positions.find((p) => p.id === h.position_id)?.name)
      .filter(Boolean) as string[]

  const me = state.me
  // Skill tags are for work projects; a class board's Files project has none.
  const work = Boolean(project && !project.class_board_id)
  const rank = (m: GeneralMember) =>
    m.role === 'member' && leads.has(m.user_id) ? 4 : ROLE_ORDER[m.role]
  const members = work
    ? [...state.members].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          state.nameOf(a.user_id).localeCompare(state.nameOf(b.user_id), undefined, {
            sensitivity: 'base',
          }),
      )
    : state.members
  const q = query.trim().toLowerCase()
  const emailQuery = q.includes('@')
  useEffect(() => {
    if (!emailQuery || q.length < 3) return
    const timer = setTimeout(() => {
      searchPeople(q)
        .then((hits) => setEmailResult({ query: q, id: hits.find((hit) => hit.email?.toLowerCase() === q)?.person_id ?? null }))
        .catch((err) => {
          setEmailResult({ query: q, id: null })
          show(authErrorMessage(err, 'Could not search email right now.'), 'error')
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [emailQuery, q, show])
  const emailId = viewer?.email.toLowerCase() === q
    ? state.viewerId
    : emailResult?.query === q ? emailResult.id : null
  const shown = work && q
    ? members.filter((m) => emailQuery
      ? m.user_id === emailId
      : state.nameOf(m.user_id).toLowerCase().includes(q))
    : members

  if (!project) return null

  return (
    <section className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div>
          <h2>Members</h2>
        </div>
        <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
          {state.members.length}
        </span>
      </header>

      {work && (
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <label className="block max-w-sm">
            <span className="sr-only">Search members by name or exact email</span>
            <FilterSearch value={query} onChange={setQuery} placeholder="Name or exact email" />
          </label>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted sm:px-5">
          {emailQuery && q.length >= 3 && emailResult?.query !== q && viewer?.email.toLowerCase() !== q
            ? 'Checking email…'
            : q ? 'No members match.' : 'No members yet.'}
        </p>
      ) : (
        <ScrollTenList
          ids={work ? shown.map((m) => m.user_id) : []}
          label="Project members"
          visibleRows={5}
          className="divide-y divide-[var(--line)]"
        >
        {shown.map((m) => {
          const grants = state.grants
            .filter((g) => g.user_id === m.user_id && (!work || g.permission !== 'commit_main'))
            .map((g) => g.permission)
          const positions = positionsOf(m.user_id)
          const choices = roleChoices(m)
          const lead = leads.has(m.user_id)
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
                {choices.length > 0 ? (
                  <>
                    <RoleBadge role="member" lead={lead} />
                    <Select
                      aria-label={`Role for ${state.nameOf(m.user_id)}`}
                      value={m.role}
                      onChange={(e) => void changeRole(m, e.target.value as ProjectRole)}
                      options={choices.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                      className="!h-9 !w-[9.5rem] !text-[13px]"
                    />
                  </>
                ) : (
                  <RoleBadge role={m.role} lead={lead} />
                )}
                {state.canGrant && !state.archived && m.role === 'member' && m.level === 'member' && (
                  <Button size="sm" variant="ghost" onClick={() => setPermissionsFor(m)}>
                    Permissions
                  </Button>
                )}
                {canRemove(m) && (
                  <button
                    type="button"
                    aria-label={`Remove ${state.nameOf(m.user_id)}`}
                    onClick={() => setRemoving(m)}
                    className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                )}
              </div>

              {work && <SkillTags state={state} member={m} />}
            </li>
          )
        })}
        </ScrollTenList>
      )}

      {me && (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          {me.role === 'pm' ? (
            <>
              <p className="text-[12px] text-faint">
                You are the project manager. Hand the project over before you leave.
              </p>
              {!state.archived && (
                <Button size="sm" variant="outline" onClick={() => setHandingOver(true)}>
                  Hand over project
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-[12px] text-faint">Leaving removes your tasks' assignments and your positions.</p>
              <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                Leave project
              </Button>
            </>
          )}
        </footer>
      )}

      <HandOverDialog open={handingOver} onClose={() => setHandingOver(false)} state={state} />

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
          navigate(paths.home)
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
  const permissions = PERMISSIONS.filter((p) => project?.class_board_id || p.value !== 'commit_main')

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
      description="On top of what every Member can do. To give them all of it, make them a Coordinator instead."
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <ul className="space-y-2">
        {permissions.map((p) => {
          const on = held.includes(p.value)
          // A class board's Owner gives everything; on a work project a
          // Coordinator gives only what it holds (general_can_grant).
          const givable = state.myRole === 'coordinator' ? canGive('coordinator', p.value) : true
          return (
            <li key={p.value}>
              <label
                className={`flex items-start gap-3 rounded-xl border border-line px-3.5 py-3 ${
                  givable ? 'cursor-pointer hover:bg-[var(--surface-sunken)]' : 'cursor-not-allowed opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={busy !== null || !givable}
                  onChange={(e) => void toggle(p.value, e.target.checked)}
                />
                <span>
                  <span className="block text-[14px] font-medium text-ink">{p.label}</span>
                  <span className="block text-[12px] text-muted">
                    {givable ? p.note : 'Only the project manager gives this.'}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
