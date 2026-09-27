import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { InviteToSpaceDialog } from '../general/InviteToSpaceDialog'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon, Spinner } from '../ui/Icon'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import {
  listSpaceInvitations,
  listSpaceMembers,
  removeSpaceMember,
  searchFaculty,
  setSpaceLevel,
  withdrawSpaceInvitation,
} from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, levelLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type { SpaceInvitation, SpacePerson } from '../../lib/general/types'
import { paths } from '../../lib/paths'
import type { ClassSummary } from '../../lib/types'

/** Faculty in a class are Owner or Manager; Member is for students. */
const FACULTY_LEVELS = LEVELS.filter((l) => l.value !== 'member')

/**
 * Who teaches the class: its professor and every co-teacher or adviser. They
 * are the faculty in the class's space, which is where their seats live; the
 * students are the roster below this panel.
 */
export function FacultyPanel({ cls }: { cls: ClassSummary }) {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [people, setPeople] = useState<SpacePerson[] | null>(null)
  const [invites, setInvites] = useState<SpaceInvitation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<SpacePerson | null>(null)
  const [leaving, setLeaving] = useState(false)

  const myId = profile?.id
  const myLevel = people?.find((p) => p.user_id === myId)?.level ?? null
  const archived = Boolean(cls.archived_at)
  const isOwner = myLevel === 'owner'
  const canInvite = !archived && isOwner
  const canSetLevels = !archived && isOwner

  const load = useCallback(async () => {
    try {
      const everyone = await listSpaceMembers(cls.space_id)
      setPeople(everyone.filter((p) => !p.is_student))
      const mine = everyone.find((p) => p.user_id === myId)?.level
      setInvites(mine === 'owner' ? await listSpaceInvitations(cls.space_id) : [])
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the faculty.'))
      setPeople((p) => p ?? [])
    }
  }, [cls.space_id, myId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_space_members', 'general_space_invitations'])

  async function changeLevel(person: SpacePerson, level: GeneralLevel) {
    try {
      await setSpaceLevel(cls.space_id, person.user_id, level)
      show(`${person.first_name} is now ${levelLabel(level)}`)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that.'), 'error')
    }
  }

  async function withdraw(inv: SpaceInvitation) {
    try {
      await withdrawSpaceInvitation(inv.invitation_id)
      show('Invitation withdrawn')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that invitation.'), 'error')
    }
  }

  const canRemove = (p: SpacePerson) =>
    !archived && isOwner && p.user_id !== myId && p.user_id !== cls.professor_id

  return (
    <section className="overflow-hidden rounded-panel border border-line">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[15px]">
            Faculty
            <span className="ml-2 font-mono text-[12px] text-faint">{people?.length ?? '—'}</span>
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            They teach the class together: its students, projects, grading and class chat.
          </p>
        </div>
        {canInvite && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <Icon name="plus" size={15} />
            Invite faculty
          </Button>
        )}
      </header>

      {error && (
        <div className="px-4 pt-3 sm:px-5">
          <Alert tone="error" onRetry={load}>
            {error}
          </Alert>
        </div>
      )}

      {people === null ? (
        <div className="flex items-center gap-3 px-4 py-4 text-[13px] text-muted sm:px-5">
          <Spinner size={14} />
          Loading faculty…
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li
              key={p.user_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <Avatar profile={p} size={32} />
              <span className="min-w-[10rem] flex-1 text-[14px]">
                {p.first_name} {p.last_name}
                {p.user_id === myId && <span className="text-faint"> · you</span>}
                {p.user_id === cls.professor_id && (
                  <span className="text-faint"> · class owner</span>
                )}
              </span>
              {canSetLevels && p.user_id !== myId && p.user_id !== cls.professor_id ? (
                <Select
                  aria-label={`Level for ${p.first_name} ${p.last_name}`}
                  value={p.level}
                  options={FACULTY_LEVELS}
                  className="!h-9 !w-[9.5rem] !text-[13px]"
                  onChange={(e) => void changeLevel(p, e.target.value as GeneralLevel)}
                />
              ) : (
                <span className="text-[13px] text-muted">{levelLabel(p.level)}</span>
              )}
              {canRemove(p) && (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                  Remove
                </Button>
              )}
              {p.user_id === myId && p.user_id !== cls.professor_id && (
                <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                  Leave class
                </Button>
              )}
            </li>
          ))}
          {canInvite &&
            invites.map((inv) => (
              <li
                key={inv.invitation_id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
              >
                <Avatar
                  profile={{
                    first_name: inv.invitee_first_name,
                    last_name: inv.invitee_last_name,
                    avatar_url: inv.invitee_avatar_url,
                  }}
                  size={32}
                />
                <span className="min-w-[10rem] flex-1 text-[14px]">
                  {inv.invitee_first_name} {inv.invitee_last_name}
                  <span className="text-faint"> · invited</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void withdraw(inv)}>
                  Withdraw
                </Button>
              </li>
            ))}
        </ul>
      )}

      <InviteToSpaceDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        spaceId={cls.space_id}
        onDone={load}
        search={searchFaculty}
        title="Invite faculty"
        description="They teach this class with you and join its class chat once they accept."
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          try {
            await removeSpaceMember(cls.space_id, removing.user_id)
            show(`${removing.first_name} no longer teaches ${cls.name}`)
            await load()
          } catch (err) {
            show(authErrorMessage(err, 'Could not remove them.'), 'error')
          }
        }}
        title={removing ? `Remove ${removing.first_name} from ${cls.name}?` : ''}
        body="They stop seeing the class, its students and its chat. Their past comments and grading stay."
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={leaving}
        onClose={() => setLeaving(false)}
        onConfirm={async () => {
          if (!myId) return
          try {
            await removeSpaceMember(cls.space_id, myId)
            show(`You left ${cls.name}`)
            navigate(paths.classes)
          } catch (err) {
            show(authErrorMessage(err, 'Could not leave the class.'), 'error')
          }
        }}
        title={`Leave ${cls.name}?`}
        body="You stop seeing the class, its students and its chat. Its Owner can invite you back."
        confirmLabel="Leave class"
      />
    </section>
  )
}
