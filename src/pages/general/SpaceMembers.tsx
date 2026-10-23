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
import { searchProjectManagers } from '../../lib/api/general'
import {
  listSpaceInvitations,
  listSpaceMembers,
  removeSpaceMember,
  setSpaceLevel,
  withdrawSpaceInvitation,
} from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, levelLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type { SpaceInvitation, SpacePerson } from '../../lib/general/types'
import { paths } from '../../lib/paths'

/**
 * Who is in a space, and its one door: an Owner adds a co-owner, who must have
 * Project manager turned on. Everybody else comes in through a project.
 *
 * The levels here decide only what somebody may do to the space itself —
 * rename it, add co-owners, archive it (Settings). A space Owner who is not on
 * a project reads it and changes nothing, except assigning a project manager
 * when it has none.
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
  const [removing, setRemoving] = useState<SpacePerson | null>(null)
  const [leaving, setLeaving] = useState(false)

  const archived = Boolean(space?.archived_at)
  const canInvite = !archived && (space?.my_level === 'owner' || space?.my_level === 'manager')
  const isOwner = space?.my_level === 'owner'
  const canManageLevels = isOwner && !archived
  // A work space's only invite. A class's space keeps its own (FacultyPanel).
  const canAddCoOwner = isOwner && !archived && space?.kind === 'work'
  // Owners only in a work space; a class's space lets its Managers see them too.
  const seesInvites =
    !archived && (isOwner || (space?.kind !== 'work' && space?.my_level === 'manager'))

  // Co-owners need Project manager, so the search lists only them, and never
  // the Owner doing the adding.
  const viewerId = profile?.id
  const searchCoOwners = useCallback(
    async (query: string) =>
      (await searchProjectManagers(query)).filter((hit) => hit.person_id !== viewerId),
    [viewerId],
  )

  useEffect(() => {
    document.title = space ? `Members · ${space.name} · Collabify` : 'Members · Collabify'
  }, [space])

  const load = useCallback(async () => {
    if (!spaceId || !space) return
    try {
      setMembers(await listSpaceMembers(spaceId))
      // Only somebody who may invite can read either of these, so they are
      // asked for separately and their refusal is not the page's failure.
      if (
        !space.archived_at &&
        (space.my_level === 'owner' || (space.kind !== 'work' && space.my_level === 'manager'))
      ) {
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

  async function changeLevel(person: SpacePerson, level: GeneralLevel) {
    if (!spaceId) return
    try {
      await setSpaceLevel(spaceId, person.user_id, level)
      show(`${person.first_name} is now ${levelLabel(level)}`)
      await Promise.all([load(), reloadNavigation()])
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that level.'), 'error')
    }
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
          A space holds projects. You see the projects you're on; the space's owners see all of
          them.
        </p>
        <div className="flex flex-wrap gap-2">
          {canAddCoOwner && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={15} />
              Add a co-owner
            </Button>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {archived && (
          <Alert tone="info">
            This space is archived. Its projects stay readable, but nothing in the space can
            change until an Owner restores it.
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
          <EmptyState icon="users" title="Nobody here yet" body="People join a space through its projects." />
        ) : (
          <section className="overflow-hidden rounded-panel border border-line">
            <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-[15px]">In this space</h2>
              <span className="font-mono text-[12px] text-faint">{members.length}</span>
            </header>
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li
                  key={m.user_id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <Avatar profile={m} size={32} />
                  <span className="min-w-[10rem] flex-1 text-[14px]">
                    {m.first_name} {m.last_name}
                    {m.user_id === profile?.id && <span className="text-faint"> · you</span>}
                  </span>
                  {canManageLevels && m.user_id !== profile?.id ? (
                    <Select
                      value={m.level}
                      options={m.is_student ? LEVELS.filter((l) => l.value === 'member') : LEVELS}
                      className="!h-9 !w-[9.5rem] !text-[13px]"
                      onChange={(e) => void changeLevel(m, e.target.value as GeneralLevel)}
                    />
                  ) : (
                    <span className="text-[13px] text-muted">{levelLabel(m.level)}</span>
                  )}
                  {canInvite && m.user_id !== profile?.id && (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-panel border border-line p-4 sm:p-5">
          <h2 className="text-[15px]">Leave this space</h2>
          <p className="mt-1 text-[13px] text-muted">
            You stop seeing the projects in it. Any project here you are actually on stays yours.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setLeaving(true)}>
            Leave
          </Button>
        </section>
      </div>

      <InviteToSpaceDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        spaceId={spaceId ?? ''}
        onDone={load}
        search={searchCoOwners}
        title="Add a co-owner"
        description="A co-owner sees every project in this space and can add co-owners too. Only people with Project manager turned on are listed."
        noMatch="Nobody by that name has Project manager turned on."
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
