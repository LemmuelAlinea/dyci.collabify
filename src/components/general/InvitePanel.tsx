// src/components/general/InvitePanel.tsx
import { useCallback, useEffect, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { FilterSearch } from '../ui/FilterPopover'
import { useLive } from '../../hooks/useLive'
import {
  inviteToProject,
  listProjectInvitations,
  searchPeople,
  setJoinCode,
  withdrawInvitation,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { PersonHit, ProjectInvitation } from '../../lib/general/types'
import { fullName } from '../../lib/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Bringing people in, two ways: find them by name, or hand out a code.
 *
 * A name search shows names and photos, never addresses — the email appears
 * only when the search was that exact address, which the person searching
 * already had.
 */
export function InvitePanel({ state }: { state: GeneralProjectState }) {
  const allowed = state.can('manage_members')
  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Bring people in</h2>
          <p className="mt-0.5 text-[12px] text-muted">Invite someone, or share a join code.</p>
        </div>
        {!allowed && <RequestAccessButton state={state} permission="manage_members" />}
      </header>
      {allowed && (
        <>
          <Search state={state} />
          <Pending state={state} />
        </>
      )}
      {(state.isOwner || (allowed && state.project?.join_open)) && <JoinCode state={state} />}
    </section>
  )
}

function Search({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      searchPeople(q)
        .then(setHits)
        .catch((err) => show(authErrorMessage(err, 'Could not search right now.'), 'error'))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query, show])

  const memberIds = new Set(state.members.map((m) => m.user_id))

  async function invite(hit: PersonHit) {
    if (!state.project) return
    setInviting(hit.person_id)
    try {
      await inviteToProject(state.project.id, hit.person_id)
      show(`Invited ${hit.first_name} ${hit.last_name}`)
      setQuery('')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that invitation.'), 'error')
    } finally {
      setInviting(null)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <FilterSearch value={query} onChange={setQuery} placeholder="Name, or their exact email" />
      {query.trim().length > 0 && query.trim().length < 3 && (
        <p className="text-[12px] text-faint">Type at least three characters.</p>
      )}
      {searching && <p className="text-[12px] text-faint">Searching…</p>}
      {hits.length > 0 && (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-line">
          {hits.map((hit) => {
            const onIt = memberIds.has(hit.person_id)
            return (
              <li key={hit.person_id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar
                  profile={{ first_name: hit.first_name, last_name: hit.last_name, avatar_url: hit.avatar_url }}
                  size={30}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">
                    {hit.first_name} {hit.last_name}
                  </span>
                  {hit.email && <span className="block truncate text-[12px] text-faint">{hit.email}</span>}
                </span>
                {onIt ? (
                  <span className="text-[12px] text-faint">On the project</span>
                ) : (
                  <Button size="sm" loading={inviting === hit.person_id} onClick={() => void invite(hit)}>
                    Invite
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!searching && query.trim().length >= 3 && hits.length === 0 && (
        <p className="text-[12px] text-faint">Nobody matches. They may need to create an account first.</p>
      )}
    </div>
  )
}

function Pending({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const projectId = state.project?.id
  const [invites, setInvites] = useState<ProjectInvitation[]>([])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      setInvites(await listProjectInvitations(projectId))
    } catch {
      setInvites([])
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load, state.members.length])

  useLive(load, ['general_invitations'])

  if (invites.length === 0) return null

  async function withdraw(inv: ProjectInvitation) {
    try {
      await withdrawInvitation(inv.id)
      show('Invitation withdrawn')
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that invitation.'), 'error')
    }
  }

  return (
    <div className="mt-5">
      <p className="text-[12px] font-medium text-muted">Waiting for an answer</p>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {invites.map((inv) => (
          <li key={inv.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
              {inv.invitee_profile ? fullName(inv.invitee_profile) : 'Somebody'}
            </span>
            <button
              type="button"
              onClick={() => void withdraw(inv)}
              className="text-[12px] font-medium text-muted hover:text-ink"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function JoinCode({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const [busy, setBusy] = useState(false)
  if (!p) return null

  async function set(open: boolean, regenerate = false) {
    if (!p) return
    setBusy(true)
    try {
      await setJoinCode(p.id, open, regenerate)
      show(open ? (regenerate ? 'New code made. The old one no longer works.' : 'Join code is on') : 'Join code is off')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the join code.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!p?.join_code) return
    try {
      await navigator.clipboard.writeText(p.join_code)
      show('Code copied')
    } catch {
      show('Could not copy. Select the code and copy it instead.', 'error')
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[12px] font-medium text-muted">Join code</p>
      {p.join_open && p.join_code ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="rounded-lg surface-sunken px-3 py-1.5 font-mono text-[16px] tracking-[0.2em] text-ink select-all">
            {p.join_code}
          </code>
          <button
            type="button"
            aria-label="Copy the join code"
            onClick={() => void copy()}
            className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="copy" size={16} />
          </button>
          {state.isOwner && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void set(true, true)}>
                New code
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void set(false)}>
                Turn off
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted">Off. Anyone with a code joins as a Member, so share it with care.</p>
          {state.isOwner && !state.archived && (
            <Button size="sm" variant="outline" loading={busy} onClick={() => void set(true)}>
              Turn on
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
