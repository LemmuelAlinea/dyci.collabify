// src/components/general/StructurePanel.tsx
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  archiveTeam,
  addPositionHolder,
  addTeamMember,
  createPosition,
  createTeam,
  deletePosition,
  deleteTeam,
  removePositionHolder,
  removeTeamMember,
  renamePosition,
  renameTeam,
  setTeamLeader,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type Renaming = { kind: 'team' | 'position'; id: string; name: string } | null
type Removing = { kind: 'team' | 'position'; id: string; name: string } | null
type ChangingLeader = { id: string; name: string; members: string[]; current: string | null } | null

/**
 * Teams split a project's people; positions say what somebody is to it.
 *
 * Neither grants anything. A "Treasurer" who needs to edit files still asks an
 * Owner for that, which keeps names free to be whatever the project calls its
 * people without each name becoming a security decision.
 */
export function StructurePanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const editable = state.can('manage_structure')
  const [teamName, setTeamName] = useState('')
  const [teamPeople, setTeamPeople] = useState<string[]>([])
  const [teamLeader, setTeamLeaderChoice] = useState('')
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [openTeamId, setOpenTeamId] = useState<string | null>(null)
  const [changingLeader, setChangingLeader] = useState<ChangingLeader>(null)
  const [positionName, setPositionName] = useState('')
  const [positionScope, setPositionScope] = useState<string | null>(null)
  const [creatingPosition, setCreatingPosition] = useState(false)
  const [renaming, setRenaming] = useState<Renaming>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const project = state.project
  if (!project) return null
  // A class board's Files project keeps the old model: its teams have no leader.
  const leaders = !project.class_board_id
  const openTeam = state.teams.find((team) => team.id === openTeamId)
  const openTeamPeople = state.teamMembers.filter((member) => member.team_id === openTeamId).map((member) => member.user_id)
  const openPositions = state.positions.filter((position) => position.team_id === (openTeam?.id ?? null))
  const projectPositions = state.positions.filter((position) => position.team_id === null)

  /** Answers whether it went through, so a caller only clears what was taken. */
  async function run(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return false
    setBusy(true)
    try {
      await action()
      show(done)
      await state.reload()
      return true
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  /** A stakeholder reads the project and never leads a team. */
  const leaderOptions = (ids: string[]) =>
    ids
      .filter((id) => state.roleOf(id) !== 'stakeholder')
      .map((id) => ({ value: id, label: state.nameOf(id) }))

  const memberOptions = (taken: string[], teamId?: string | null) => {
    const inTeam = new Set(state.teamMembers.filter((member) => member.team_id === teamId).map((member) => member.user_id))
    return state.members
      .filter((m) => !taken.includes(m.user_id) && (!teamId || inTeam.has(m.user_id)))
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))
  }

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Teams and positions</h2>
          <p className="mt-0.5 text-[12px] text-muted">Group people into teams and name their positions.</p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="manage_structure" />}
      </header>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-[12px] font-medium text-muted">Teams · {state.teams.length}</p>
        {editable && (
          <Button type="button" size="sm" onClick={() => setCreatingTeam(true)}>
            <Icon name="plus" size={16} /> Create team
          </Button>
        )}
      </div>
      {state.teams.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-[13px] text-muted">
          {editable ? 'No teams yet. Create one to group people and positions.' : 'No teams yet. Everybody works as one group.'}
        </p>
      )}
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {state.teams.map((team) => {
          const people = state.teamMembers.filter((member) => member.team_id === team.id)
          const positions = state.positions.filter((position) => position.team_id === team.id)
          return (
            <li key={team.id}>
              <button
                type="button"
                onClick={() => setOpenTeamId(team.id)}
                className="group h-full w-full rounded-xl border border-line surface-sunken p-4 text-left transition-colors hover:border-line-strong hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-500"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px] font-semibold text-ink">{team.name}</span>
                  <Icon name="chevronRight" size={17} className="mt-0.5 shrink-0 text-faint group-hover:text-ink" />
                </span>
                {leaders && <span className="mt-2 block text-[12px] text-muted">{team.leader_id ? `Lead: ${state.nameOf(team.leader_id)}` : 'No lead yet'}</span>}
                <span className="mt-3 flex gap-3 border-t border-line pt-3 text-[12px] text-muted">
                  <span>{people.length} {people.length === 1 ? 'person' : 'people'}</span>
                  <span>{positions.length} {positions.length === 1 ? 'position' : 'positions'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {(projectPositions.length > 0 || editable) && (
        <button
          type="button"
          onClick={() => setOpenTeamId('')}
          className="mt-5 flex w-full items-center justify-between gap-3 border-t border-line pt-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-500"
        >
          <span>
            <span className="block text-[13px] font-medium text-ink">Project-wide positions</span>
            <span className="mt-0.5 block text-[12px] text-muted">{projectPositions.length} {projectPositions.length === 1 ? 'position' : 'positions'} across all teams</span>
          </span>
          <Icon name="chevronRight" size={17} className="shrink-0 text-faint" />
        </button>
      )}

      <Modal
        open={creatingTeam}
        onClose={busy ? () => {} : () => setCreatingTeam(false)}
        title="Create team"
        description={leaders ? 'Name the team, then choose its people and leader.' : 'Name the team and choose its people.'}
        size="md"
        focusField
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setCreatingTeam(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" form="create-team-form" loading={busy} disabled={!teamName.trim()}>Create team</Button>
          </>
        }
      >
        <form
          id="create-team-form"
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!teamName.trim()) return
            const people = teamPeople
            const leader = leaders && people.includes(teamLeader) ? teamLeader : ''
            const clear = () => {
              setTeamName('')
              setTeamPeople([])
              setTeamLeaderChoice('')
            }
            void run(
              async () => {
                const id = await createTeam(project.id, teamName)
                try {
                  for (const userId of people) await addTeamMember(id, project.id, userId)
                  if (leader) await setTeamLeader(id, leader)
                } catch (err) {
                  clear()
                  setCreatingTeam(false)
                  setOpenTeamId(id)
                  await state.reload()
                  throw err
                }
              },
              'Team added',
              'The team was added, but its people or leader could not be set. Open the team to finish.',
            ).then((ok) => {
              if (ok) {
                clear()
                setCreatingTeam(false)
              }
            })
          }}
        >
          <Field label="Team name">
            {(id) => <Input id={id} placeholder="Logistics, Program, Finance" maxLength={LIMIT.generalShortName} value={teamName} onChange={(event) => setTeamName(event.target.value)} />}
          </Field>
          <div>
            <p className="text-[12px] font-medium text-muted">People</p>
            {teamPeople.length > 0 && (
              <PeopleChips ids={teamPeople} state={state} editable onRemove={(userId) => {
                setTeamPeople((prev) => prev.filter((id) => id !== userId))
                if (teamLeader === userId) setTeamLeaderChoice('')
              }} />
            )}
            {memberOptions(teamPeople).length > 0 && (
              <AddPerson options={memberOptions(teamPeople)} onAdd={(userId) => setTeamPeople((prev) => [...prev, userId])} />
            )}
          </div>
          {leaders && (
            <Field label="Leader">
              {(id) => <Select id={id} value={teamPeople.includes(teamLeader) ? teamLeader : ''} onChange={(event) => setTeamLeaderChoice(event.target.value)} placeholder="No leader" options={leaderOptions(teamPeople)} />}
            </Field>
          )}
        </form>
      </Modal>

      <Modal
        open={openTeamId !== null}
        onClose={() => setOpenTeamId(null)}
        title={openTeam?.name ?? 'Whole project'}
        description={openTeam ? `${openTeamPeople.length} ${openTeamPeople.length === 1 ? 'person' : 'people'} · ${openPositions.length} ${openPositions.length === 1 ? 'position' : 'positions'}` : 'Positions that cover the whole project'}
        size="lg"
        headerActions={editable && openTeam && (
          <>
            <button type="button" aria-label={`Rename ${openTeam.name}`} title="Rename team" onClick={() => setRenaming({ kind: 'team', id: openTeam.id, name: openTeam.name })} className="grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"><Icon name="edit" size={16} /></button>
            <button type="button" aria-label={`Archive ${openTeam.name}`} title="Archive team" onClick={() => setArchiving({ id: openTeam.id, name: openTeam.name })} className="grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"><Icon name="archive" size={16} /></button>
            <button type="button" aria-label={`Remove ${openTeam.name}`} title="Remove team" onClick={() => setRemoving({ kind: 'team', id: openTeam.id, name: openTeam.name })} className="grid h-9 w-9 place-items-center rounded-full text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"><Icon name="trash" size={16} /></button>
          </>
        )}
      >
        {openTeam && (
          <div className="space-y-5 border-b border-line pb-6">
            {leaders && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium text-muted">Team leader</p>
                  <p className="mt-1 text-[14px] text-ink">{openTeam.leader_id ? state.nameOf(openTeam.leader_id) : 'No lead yet'}</p>
                </div>
                {editable && <Button type="button" size="sm" variant="outline" onClick={() => setChangingLeader({ id: openTeam.id, name: openTeam.name, members: openTeamPeople, current: openTeam.leader_id })}>Change leader</Button>}
              </div>
            )}
            <div>
              <p className="text-[12px] font-medium text-muted">People · {openTeamPeople.length}</p>
              <PeopleChips ids={openTeamPeople} state={state} editable={editable} onRemove={(userId) => void run(() => removeTeamMember(openTeam.id, userId), 'Taken off the team', 'Could not change the team.')} />
              {editable && memberOptions(openTeamPeople).length > 0 && (
                <AddPerson options={memberOptions(openTeamPeople)} onAdd={(userId) => void run(() => addTeamMember(openTeam.id, project.id, userId), 'Added to the team', 'Could not change the team.')} />
              )}
            </div>
          </div>
        )}
        <div className={openTeam ? 'pt-6' : ''}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Positions</h3>
              <p className="mt-1 text-[12px] text-muted">Positions describe people; they do not grant access.</p>
            </div>
            {editable && <Button type="button" size="sm" variant="outline" onClick={() => { setPositionScope(openTeam?.id ?? null); setCreatingPosition(true) }}><Icon name="plus" size={15} /> Create position</Button>}
          </div>
          {openPositions.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-5 text-[13px] text-muted">No positions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {openPositions.map((position) => {
                const holding = state.holders.filter((holder) => holder.position_id === position.id).map((holder) => holder.user_id)
                return (
                  <li key={position.id} className="rounded-xl border border-line p-4">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{position.name}</p>
                      {editable && (
                        <>
                          <button type="button" aria-label={`Rename ${position.name}`} onClick={() => setRenaming({ kind: 'position', id: position.id, name: position.name })} className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"><Icon name="edit" size={15} /></button>
                          <button type="button" aria-label={`Remove ${position.name}`} onClick={() => setRemoving({ kind: 'position', id: position.id, name: position.name })} className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"><Icon name="trash" size={15} /></button>
                        </>
                      )}
                    </div>
                    <PeopleChips ids={holding} state={state} editable={editable} onRemove={(userId) => void run(() => removePositionHolder(position.id, userId), 'Position updated', 'Could not change that position.')} />
                    {editable && memberOptions(holding, position.team_id).length > 0 && (
                      <AddPerson options={memberOptions(holding, position.team_id)} onAdd={(userId) => void run(() => addPositionHolder(position.id, project.id, userId), 'Position updated', 'Could not change that position.')} />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={creatingPosition}
        onClose={busy ? () => {} : () => setCreatingPosition(false)}
        title="Create position"
        description={positionScope ? `In ${state.teams.find((team) => team.id === positionScope)?.name ?? 'team'}` : 'Across the whole project'}
        size="sm"
        focusField
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setCreatingPosition(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" form="create-position-form" loading={busy} disabled={!positionName.trim()}>Create position</Button>
          </>
        }
      >
        <form id="create-position-form" onSubmit={(event) => {
          event.preventDefault()
          if (!positionName.trim()) return
          void run(() => createPosition(project.id, positionName, positionScope, state.positions.length), 'Position added', 'Could not add that position.').then((ok) => {
            if (ok) {
              setPositionName('')
              setCreatingPosition(false)
            }
          })
        }}>
          <Field label="Position name">
            {(id) => <Input id={id} placeholder="Adviser, Treasurer, Team lead" maxLength={LIMIT.generalShortName} value={positionName} onChange={(event) => setPositionName(event.target.value)} />}
          </Field>
        </form>
      </Modal>

      <LeaderDialog
        changing={changingLeader}
        options={leaderOptions(changingLeader?.members ?? [])}
        onClose={() => setChangingLeader(null)}
        onSave={async (userId) => {
          if (!changingLeader) return
          await setTeamLeader(changingLeader.id, userId)
          show(userId ? 'Leader changed' : 'Leader cleared')
          await state.reload()
        }}
      />
      <RenameDialog
        renaming={renaming}
        onClose={() => setRenaming(null)}
        onSave={async (name) => {
          if (!renaming) return
          await (renaming.kind === 'team' ? renameTeam(renaming.id, name) : renamePosition(renaming.id, name))
          show('Renamed')
          await state.reload()
        }}
      />
      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return
          await archiveTeam(archiving.id, true)
          setOpenTeamId(null)
          show('Team archived')
          await state.reload()
        }}
        title={`Archive ${archiving?.name ?? ''}?`}
        body="The team, its people and positions will move to this project's archive. Move or complete its open tasks first."
        confirmLabel="Archive"
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await (removing.kind === 'team' ? deleteTeam(removing.id) : deletePosition(removing.id))
          if (removing.kind === 'team') setOpenTeamId(null)
          show(removing.kind === 'team' ? 'Team removed' : 'Position removed')
          await state.reload()
        }}
        title={`Remove ${removing?.name ?? ''}?`}
        body={
          removing?.kind === 'team'
            ? 'Its positions are removed with it. Its tasks stay on the project, just without a team.'
            : 'Whoever holds it keeps everything else on the project.'
        }
        confirmLabel="Remove"
      />
    </section>
  )
}

function PeopleChips({
  ids,
  state,
  editable,
  onRemove,
}: {
  ids: string[]
  state: GeneralProjectState
  editable: boolean
  onRemove: (userId: string) => void
}) {
  if (ids.length === 0) return <p className="mt-2 text-[12px] text-faint">Nobody yet.</p>
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <li
          key={id}
          className="flex items-center gap-1 rounded-full surface-sunken py-0.5 pr-1 pl-2.5 text-[12px] text-ink"
        >
          {state.nameOf(id)}
          {editable && (
            <button
              type="button"
              aria-label={`Take ${state.nameOf(id)} off`}
              onClick={() => onRemove(id)}
              className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function AddPerson({
  options,
  onAdd,
}: {
  options: { value: string; label: string }[]
  onAdd: (userId: string) => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const [query, setQuery] = useState('')
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <details
      ref={details}
      className="relative mt-2 max-w-[16rem]"
      onToggle={(event) => {
        if (event.currentTarget.open) event.currentTarget.querySelector('input')?.focus()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault()
        if (event.key === 'Escape') {
          details.current?.removeAttribute('open')
          details.current?.querySelector('summary')?.focus()
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) details.current?.removeAttribute('open')
      }}
    >
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between rounded-xl border border-[var(--control-line)] surface px-3 text-[13px] text-ink [&::-webkit-details-marker]:hidden">
        Add a person… <Icon name="chevronDown" size={16} className="text-faint" />
      </summary>
      <div className="surface absolute z-30 mt-1 w-full rounded-xl border border-line p-2 shadow-lift">
        <label>
          <span className="sr-only">Search people to add</span>
          <FilterSearch value={query} onChange={setQuery} placeholder="Search people" />
        </label>
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted">Nobody matches.</p>
        ) : (
          <ul className="mt-2 max-h-56 overflow-y-auto">
            {shown.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(option.value)
                    setQuery('')
                    details.current?.removeAttribute('open')
                  }}
                  className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)]"
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

function RenameDialog({
  renaming,
  onClose,
  onSave,
}: {
  renaming: Renaming
  onClose: () => void
  onSave: (name: string) => Promise<void>
}) {
  const { show } = useToast()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(renaming?.name ?? '')
  }, [renaming])

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSave(name)
      onClose()
    } catch (err) {
      show(authErrorMessage(err, 'Could not rename that.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(renaming)}
      onClose={onClose}
      title={renaming?.kind === 'team' ? 'Rename team' : 'Rename position'}
      size="sm"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id) => (
          <Input id={id} maxLength={LIMIT.generalShortName} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
    </Modal>
  )
}

function LeaderDialog({
  changing,
  options,
  onClose,
  onSave,
}: {
  changing: ChangingLeader
  options: { value: string; label: string }[]
  onClose: () => void
  onSave: (userId: string | null) => Promise<void>
}) {
  const { show } = useToast()
  const [leader, setLeader] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLeader(changing?.current ?? '')
  }, [changing])

  async function save() {
    setBusy(true)
    try {
      await onSave(leader || null)
      onClose()
    } catch (err) {
      show(authErrorMessage(err, 'Could not change the leader.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={Boolean(changing)}
      onClose={onClose}
      title={`Leader of ${changing?.name ?? 'the team'}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Leader">
        {(id) => (
          <Select
            id={id}
            value={leader}
            onChange={(e) => setLeader(e.target.value)}
            placeholder="No leader"
            options={options}
          />
        )}
      </Field>
      <p className="mt-2 text-[12px] text-muted">
        The leader is somebody on the team, and never a Stakeholder. They can edit and assign their team&apos;s tasks.
      </p>
    </Modal>
  )
}
