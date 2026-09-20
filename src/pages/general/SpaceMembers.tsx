import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/app/Avatar'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Field, Input } from '../../components/ui/Field'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useLive } from '../../hooks/useLive'
import { forgetSpace } from '../../hooks/useSpaces'
import { searchPeople } from '../../lib/api/general'
import {
  getSpace,
  inviteToSpace,
  listSpaceInvitations,
  listSpaceMembers,
  removeSpaceMember,
  setSpaceJoinCode,
  setSpaceLevel,
  withdrawSpaceInvitation,
} from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { LEVELS, levelLabel } from '../../lib/general/permissions'
import type { GeneralLevel } from '../../lib/general/permissions'
import type {
  GeneralSpaceSummary,
  PersonHit,
  SpaceInvitation,
  SpacePerson,
} from '../../lib/general/types'

/**
 * Who is in a space, and the two doors into it.
 *
 * The levels here decide only what somebody may do to the space itself —
 * rename it, invite to it, archive it. None of them grants any power inside a
 * project: a space Owner who is not on a project reads it like everybody else
 * and changes nothing.
 */
export default function SpaceMembers() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [space, setSpace] = useState<GeneralSpaceSummary | null>(null)
  const [gone, setGone] = useState(false)
  const [members, setMembers] = useState<SpacePerson[] | null>(null)
  const [invites, setInvites] = useState<SpaceInvitation[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<SpacePerson | null>(null)
  const [leaving, setLeaving] = useState(false)

  const canInvite = space?.my_level === 'owner' || space?.my_level === 'manager'
  const isOwner = space?.my_level === 'owner'

  useEffect(() => {
    document.title = space ? `Members · ${space.name} · Collabify` : 'Members · Collabify'
  }, [space])

  const load = useCallback(async () => {
    if (!spaceId) return
    try {
      const s = await getSpace(spaceId)
      if (!s) return setGone(true)
      setSpace(s)
      setMembers(await listSpaceMembers(spaceId))
      // Only somebody who may invite can read either of these, so they are
      // asked for separately and their refusal is not the page's failure.
      if (s.my_level === 'owner' || s.my_level === 'manager') {
        setInvites(await listSpaceInvitations(spaceId))
      }
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load this space.'))
      setMembers((prev) => prev ?? [])
    }
  }, [spaceId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_space_members', 'general_space_invitations', 'general_spaces'])

  async function toggleCode(open: boolean, regenerate = false) {
    if (!spaceId) return
    try {
      setCode(await setSpaceJoinCode(spaceId, open, regenerate))
      show(open ? 'Join code is open' : 'Join code is closed')
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the join code.'), 'error')
    }
  }

  async function changeLevel(person: SpacePerson, level: GeneralLevel) {
    if (!spaceId) return
    try {
      await setSpaceLevel(spaceId, person.user_id, level)
      show(`${person.first_name} is now ${levelLabel(level)}`)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change that level.'), 'error')
    }
  }

  async function remove() {
    if (!spaceId || !removing) return
    await removeSpaceMember(spaceId, removing.user_id)
    show(`${removing.first_name} is no longer in this space`)
    await load()
  }

  async function leave() {
    if (!spaceId || !profile) return
    await removeSpaceMember(spaceId, profile.id)
    forgetSpace()
    show('You left the space')
    navigate('/general/spaces', { replace: true })
  }

  if (gone) return <Navigate to="/general/spaces" replace />

  return (
    <div className="w-full">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{space?.name ?? 'Space'}</p>
          <h1 className="mt-1 font-display">Members</h1>
          <p className="mt-1 max-w-[62ch] text-[13px] text-muted">
            Everyone here can see every project in this space. What they can change inside one
            still depends on whether they are on it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {spaceId && (
            <Link
              to={`/general/spaces/${spaceId}`}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-line-strong hover:text-ink"
            >
              <Icon name="board" size={15} />
              Back to projects
            </Link>
          )}
          {canInvite && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Icon name="plus" size={15} />
              Invite
            </Button>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        {canInvite && (
          <section className="rounded-panel border border-line p-4 sm:p-5">
            <h2 className="text-[15px]">Join code</h2>
            <p className="mt-1 text-[13px] text-muted">
              Anybody with an open code can join this space and read every project in it. Close it
              when you are done sharing it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(code ?? null) && (
                <code className="rounded-lg surface-sunken px-3 py-1.5 font-mono text-[15px] tracking-[0.2em]">
                  {code}
                </code>
              )}
              <Button size="sm" variant="outline" onClick={() => void toggleCode(true)}>
                {code ? 'Show again' : 'Open a code'}
              </Button>
              {code && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void toggleCode(true, true)}>
                    New code
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void toggleCode(false)}>
                    Close
                  </Button>
                </>
              )}
            </div>
          </section>
        )}

        {invites.length > 0 && (
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
          <EmptyState icon="users" title="Nobody here yet" body="Invite people or open a join code." />
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
                  {isOwner && m.user_id !== profile?.id ? (
                    <Select
                      value={m.level}
                      options={LEVELS}
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

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        spaceId={spaceId ?? ''}
        onDone={load}
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

function InviteDialog({
  open,
  onClose,
  spaceId,
  onDone,
}: {
  open: boolean
  onClose: () => void
  spaceId: string
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) return setHits([])
    // Debounced: a search on every keystroke is a request per keystroke.
    const t = setTimeout(() => {
      void searchPeople(q)
        .then(setHits)
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open])

  async function invite(person: PersonHit) {
    setBusy(person.person_id)
    try {
      await inviteToSpace(spaceId, person.person_id)
      show(`${person.first_name} was invited`)
      await onDone()
      onClose()
      setQuery('')
    } catch (err) {
      show(authErrorMessage(err, 'Could not invite them.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite to this space"
      description="They will be able to see every project in it."
      size="sm"
      focusField
      footer={
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Search by name">
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              placeholder="Start typing a name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {hits.map((h) => (
            <li key={h.person_id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
              <Avatar profile={h} size={30} />
              <span className="flex-1 truncate text-[14px]">
                {h.first_name} {h.last_name}
              </span>
              <Button size="sm" loading={busy === h.person_id} onClick={() => void invite(h)}>
                Invite
              </Button>
            </li>
          ))}
          {query.trim().length >= 2 && hits.length === 0 && (
            <li className="px-1 py-2 text-[13px] text-muted">Nobody by that name.</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
