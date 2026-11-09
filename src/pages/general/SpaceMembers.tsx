import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { InviteToSpaceDialog } from '../../components/general/InviteToSpaceDialog'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useLive } from '../../hooks/useLive'
import { forgetSpace } from '../../hooks/useSpaces'
import {
  handOverSpace,
  inviteSpaceMember,
  listSpaceInvitations,
  listSpaceMembers,
  previewSpaceRole,
  removeSpaceMember,
  setSpaceRole,
  withdrawSpaceInvitation,
} from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import {
  ROLE_LABEL,
  SPACE_ROLES,
  canEditSpace,
  spaceRoleChoices,
} from '../../lib/general/permissions'
import type { ProjectRole } from '../../lib/general/permissions'
import type { SpaceInvitation, SpacePerson } from '../../lib/general/types'
import { paths } from '../../lib/paths'
import { plural } from '../../lib/plural'

type PendingRole = {
  person: SpacePerson
  role: ProjectRole
  projects: number
  tasks: number
  qa: number
}

/**
 * The people in a work space and the role each holds in it. The project manager
 * sets every role and hands the space over; a coordinator sets the roles below
 * their own. A change that would release tasks or start a QA gate asks first.
 */
export default function SpaceMembers() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()
  const {
    spaces,
    currentSpace: space,
    error: navigationError,
    reload: reloadNavigation,
  } = useGeneralNavigation()

  const [members, setMembers] = useState<SpacePerson[] | null>(null)
  const [invites, setInvites] = useState<SpaceInvitation[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [pending, setPending] = useState<PendingRole | null>(null)
  const [handingOver, setHandingOver] = useState<SpacePerson | null>(null)
  const [removing, setRemoving] = useState<SpacePerson | null>(null)
  const [leaving, setLeaving] = useState(false)

  const archived = Boolean(space?.archived_at)
  const mine = space?.my_role ?? null
  const seesInvites = !archived && canEditSpace(mine)
  const isPm = mine === 'pm' && !archived
  const inviteRoles = mine === 'pm' ? SPACE_ROLES : SPACE_ROLES.filter((r) => r !== 'coordinator')

  useEffect(() => {
    document.title = space ? `Members · ${space.name} · Collabify` : 'Members · Collabify'
  }, [space])

  const load = useCallback(async () => {
    if (!spaceId || !space) return
    try {
      setMembers(await listSpaceMembers(spaceId))
      // Only somebody who may invite can read these, so they are asked for
      // separately and their refusal is not the page's failure.
      if (!space.archived_at && canEditSpace(space.my_role ?? null)) {
        setInvites(await listSpaceInvitations(spaceId))
      } else {
        setInvites([])
      }
      setPageError(null)
    } catch (err) {
      setPageError(authErrorMessage(err, 'Could not load this space.'))
      setMembers((prev) => prev ?? [])
    }
  }, [space, spaceId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_space_members', 'general_space_invitations', 'general_spaces'])

  async function saveRole(person: SpacePerson, role: ProjectRole) {
    if (!spaceId) return
    await setSpaceRole(spaceId, person.user_id, role)
    show(`${person.first_name} is now ${ROLE_LABEL[role]} in this space`)
    await Promise.all([load(), reloadNavigation()])
  }

  async function changeRole(person: SpacePerson, role: ProjectRole) {
    if (!spaceId) return
    try {
      const preview = await previewSpaceRole(spaceId, person.user_id, role)
      if (preview.task_count === 0 && preview.qa_start_count === 0) {
        await saveRole(person, role)
      } else {
        setPending({
          person,
          role,
          projects: preview.project_count,
          tasks: preview.task_count,
          qa: preview.qa_start_count,
        })
      }
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that role.'), 'error')
    }
  }

  async function confirmRole() {
    if (!pending) return
    try {
      await saveRole(pending.person, pending.role)
    } catch (err) {
      throw new Error(authErrorMessage(err, 'Could not change that role.'), { cause: err })
    }
  }

  async function handOver() {
    if (!spaceId || !handingOver) return
    try {
      await handOverSpace(spaceId, handingOver.user_id)
    } catch (err) {
      throw new Error(authErrorMessage(err, 'Could not hand over the space.'), { cause: err })
    }
    show(`${handingOver.first_name} is now the project manager`)
    await Promise.all([load(), reloadNavigation()])
  }

  async function remove() {
    if (!spaceId || !removing) return
    await removeSpaceMember(spaceId, removing.user_id)
    show(`${removing.first_name} is no longer in this space`)
    await Promise.all([load(), reloadNavigation()])
  }

  async function leave() {
    if (!spaceId || !profile) return
    await removeSpaceMember(spaceId, profile.id)
    forgetSpace()
    await reloadNavigation()
    show('You left the space')
    navigate(paths.spaces, { replace: true })
  }

  if (spaceId && spaces !== null && !space) {
    return <Navigate to={paths.spaces} replace />
  }
  if (space?.kind === 'education' && space.class_id) {
    return <Navigate to={paths.class(space.class_id)} replace />
  }

  const error = navigationError ?? pageError

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[62ch] text-[13px] text-muted">
          A space holds projects. You see the projects you're on, and the project manager sees all
          of them.
        </p>
        <div className="flex flex-wrap gap-2">
          {seesInvites && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={15} />
              Invite a member
            </Button>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {archived && (
          <Alert tone="info">
            This space is archived. Its projects stay readable, but nothing in the space can
            change until the project manager restores it.
          </Alert>
        )}

        {seesInvites && invites.length > 0 && (
          <section className="overflow-hidden rounded-panel border border-line">
            <header className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-[15px]">Invited</h2>
              <p className="mt-0.5 text-[12px] text-muted">Waiting for an answer.</p>
            </header>
            <ul className="divide-y divide-line">
              {invites.map((i) => (
                <li
                  key={i.invitation_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <Avatar
                    profile={{
                      first_name: i.invitee_first_name,
                      last_name: i.invitee_last_name,
                      avatar_url: i.invitee_avatar_url,
                    }}
                    size={32}
                  />
                  <span className="min-w-[10rem] flex-1 text-[14px]">
                    {i.invitee_first_name} {i.invitee_last_name}
                  </span>
                  <span className="text-[13px] text-muted">{ROLE_LABEL[i.invited_role]}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await withdrawSpaceInvitation(i.invitation_id)
                        show('Invitation withdrawn')
                        await load()
                      } catch (err) {
                        show(authErrorMessage(err, 'Could not withdraw it.'), 'error')
                      }
                    }}
                  >
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {members === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading members…
          </div>
        ) : members.length === 0 ? (
          <EmptyState icon="users" title="Nobody here yet" body="Invite people to this space or to one of its projects." />
        ) : (
          <section className="overflow-hidden rounded-panel border border-line">
            <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-[15px]">In this space</h2>
              <span className="font-mono text-[12px] text-faint">{members.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {members.map((m) => {
                const own = m.user_id === profile?.id
                const role = m.role ?? 'member'
                // Nobody changes their own role, and an archived space changes nothing.
                const choices = own || archived ? [] : spaceRoleChoices(mine, role)
                return (
                  <li
                    key={m.user_id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                  >
                    <Avatar profile={m} size={32} />
                    <span className="min-w-[10rem] flex-1 text-[14px]">
                      {m.first_name} {m.last_name}
                      {own && <span className="text-faint"> · you</span>}
                    </span>
                    {choices.length > 0 ? (
                      <Select
                        value={role}
                        aria-label={`Role for ${m.first_name} ${m.last_name}`}
                        options={choices.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                        className="!h-9 !w-[9.5rem] !text-[13px]"
                        onChange={(e) => void changeRole(m, e.target.value as ProjectRole)}
                      />
                    ) : (
                      <span className="text-[13px] text-muted">{ROLE_LABEL[role]}</span>
                    )}
                    {isPm && !own && !m.is_student && (
                      <Button size="sm" variant="ghost" onClick={() => setHandingOver(m)}>
                        Hand over
                      </Button>
                    )}
                    {choices.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                        Remove
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <section className="rounded-panel border border-line p-4 sm:p-5">
          <h2 className="text-[15px]">Leave this space</h2>
          {mine === 'pm' ? (
            <p className="mt-1 text-[13px] text-muted">Hand over the space before leaving.</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-muted">
                You stop seeing the projects in it. Any project here you are actually on stays yours.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setLeaving(true)}>
                Leave
              </Button>
            </>
          )}
        </section>
      </div>

      <InviteToSpaceDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        spaceId={spaceId ?? ''}
        onDone={load}
        invite={inviteSpaceMember}
        roles={inviteRoles}
        title="Invite a member"
        description="They join this space with the role you choose. Joining a space does not add them to any project."
      />

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmRole}
        title="Change this role?"
        tone="primary"
        confirmLabel="Change role"
        body={
          pending && (
            <>
              <p>
                This moves {pending.person.first_name} to {ROLE_LABEL[pending.role]} in{' '}
                {pending.projects} {plural(pending.projects, 'project', 'projects')}.
              </p>
              {pending.tasks > 0 && (
                <p className="mt-2">
                  They let go of {pending.tasks} {plural(pending.tasks, 'task', 'tasks')}.
                </p>
              )}
              {pending.qa > 0 && (
                <p className="mt-2">
                  QA review starts in {pending.qa} {plural(pending.qa, 'project', 'projects')}.
                </p>
              )}
            </>
          )
        }
      />

      <ConfirmDialog
        open={handingOver !== null}
        onClose={() => setHandingOver(null)}
        onConfirm={handOver}
        title="Hand over this space?"
        tone="primary"
        confirmLabel="Hand over"
        body={`${handingOver?.first_name ?? 'They'} becomes the project manager, and you become a coordinator. Project roles stay as they are.`}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        title="Remove from this space?"
        body={`${removing?.first_name ?? 'They'} stops seeing the projects in this space. Any project here they are on stays theirs.`}
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={leave}
        title="Leave this space?"
        body="You stop seeing the projects in it. Any project here you are on stays yours."
        confirmLabel="Leave"
      />
    </div>
  )
}
