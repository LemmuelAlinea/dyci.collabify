// src/components/general/StructurePanel.tsx
import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
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
  const [changingLeader, setChangingLeader] = useState<ChangingLeader>(null)
  const [positionName, setPositionName] = useState('')
  const [positionTeam, setPositionTeam] = useState('')
  const [renaming, setRenaming] = useState<Renaming>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [busy, setBusy] = useState(false)

  const project = state.project
  if (!project) return null

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

  const memberOptions = (taken: string[]) =>
    state.members
      .filter((m) => !taken.includes(m.user_id))
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) }))

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Teams and positions</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Name them whatever this project calls them. They describe people; they grant nothing.
          </p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="manage_structure" />}
      </header>

      {/* Teams */}
      <div className="mt-5">
        <p className="text-[12px] font-medium text-muted">Teams</p>
        {state.teams.length === 0 && (
          <p className="mt-2 text-[13px] text-faint">No teams. Everybody works as one group.</p>
        )}
        <ul className="mt-2 space-y-2.5">
          {state.teams.map((team) => {
            const inTeam = state.teamMembers.filter((tm) => tm.team_id === team.id).map((tm) => tm.user_id)
            return (
              <li key={team.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{team.name}</p>
                  {editable && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${team.name}`}
                        onClick={() => setRenaming({ kind: 'team', id: team.id, name: team.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${team.name}`}
                        onClick={() => setRemoving({ kind: 'team', id: team.id, name: team.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  <p className="text-muted">
                    {team.leader_id ? (
                      <>
                        Lead: <span className="font-medium text-ink">{state.nameOf(team.leader_id)}</span>
                      </>
                    ) : (
                      'No lead yet'
                    )}
                  </p>
                  {editable && (
                    <button
                      type="button"
                      onClick={() =>
                        setChangingLeader({ id: team.id, name: team.name, members: inTeam, current: team.leader_id })
                      }
                      className="font-medium text-navy-700 underline-offset-2 hover:underline dark:text-navy-200"
                    >
                      Change leader
                    </button>
                  )}
                </div>
                <PeopleChips
                  ids={inTeam}
                  state={state}
                  editable={editable}
                  onRemove={(userId) =>
                    void run(() => removeTeamMember(team.id, userId), 'Taken off the team', 'Could not change the team.')
                  }
                />
                {editable && memberOptions(inTeam).length > 0 && (
                  <AddPerson
                    options={memberOptions(inTeam)}
                    onAdd={(userId) =>
                      void run(() => addTeamMember(team.id, project.id, userId), 'Added to the team', 'Could not change the team.')
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        {editable && (
          <form
            className="mt-3 space-y-3 rounded-xl border border-dashed border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!teamName.trim()) return
              const people = teamPeople
              const leader = people.includes(teamLeader) ? teamLeader : ''
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
                    // The team exists now; leaving the form full would add it twice.
                    clear()
                    await state.reload()
                    throw err
                  }
                },
                'Team added',
                'The team was added, but not everyone could be put on it. Open the team to finish.',
              ).then((ok) => ok && clear())
            }}
          >
            <div className="flex gap-2">
              <Input
                aria-label="New team name"
                placeholder="Logistics, Program, Finance"
                maxLength={LIMIT.generalShortName}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="!h-10"
              />
              <Button type="submit" size="sm" variant="outline" className="!h-10 shrink-0">
                Add team
              </Button>
            </div>
            <div>
              <p className="text-[12px] font-medium text-muted">People</p>
              {teamPeople.length > 0 && (
                <PeopleChips
                  ids={teamPeople}
                  state={state}
                  editable
                  onRemove={(userId) => {
                    setTeamPeople((prev) => prev.filter((id) => id !== userId))
                    if (teamLeader === userId) setTeamLeaderChoice('')
                  }}
                />
              )}
              {memberOptions(teamPeople).length > 0 && (
                <AddPerson
                  options={memberOptions(teamPeople)}
                  onAdd={(userId) => setTeamPeople((prev) => [...prev, userId])}
                />
              )}
            </div>
            <div className="max-w-[16rem]">
              <label htmlFor="new-team-leader" className="text-[12px] font-medium text-muted">
                Leader
              </label>
              <div className="mt-1">
                <Select
                  id="new-team-leader"
                  value={teamPeople.includes(teamLeader) ? teamLeader : ''}
                  onChange={(e) => setTeamLeaderChoice(e.target.value)}
                  placeholder="No leader"
                  options={leaderOptions(teamPeople)}
                  className="!h-10 !text-[13px]"
                />
              </div>
              {teamPeople.length === 0 && (
                <p className="mt-1 text-[12px] text-faint">Add people first. The leader is one of them.</p>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Positions */}
      <div className="mt-6 border-t border-line pt-5">
        <p className="text-[12px] font-medium text-muted">Positions</p>
        {state.positions.length === 0 && (
          <p className="mt-2 text-[13px] text-faint">No positions yet, like Adviser, Chairperson or Treasurer.</p>
        )}
        <ul className="mt-2 space-y-2.5">
          {state.positions.map((position) => {
            const holding = state.holders.filter((h) => h.position_id === position.id).map((h) => h.user_id)
            const team = state.teams.find((t) => t.id === position.team_id)
            return (
              <li key={position.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                    {position.name}
                    <span className="ml-2 text-[12px] font-normal text-faint">
                      {team ? team.name : 'Whole project'}
                    </span>
                  </p>
                  {editable && (
                    <>
                      <button
                        type="button"
                        aria-label={`Rename ${position.name}`}
                        onClick={() => setRenaming({ kind: 'position', id: position.id, name: position.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${position.name}`}
                        onClick={() => setRemoving({ kind: 'position', id: position.id, name: position.name })}
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>
                <PeopleChips
                  ids={holding}
                  state={state}
                  editable={editable}
                  onRemove={(userId) =>
                    void run(() => removePositionHolder(position.id, userId), 'Position updated', 'Could not change that position.')
                  }
                />
                {editable && memberOptions(holding).length > 0 && (
                  <AddPerson
                    options={memberOptions(holding)}
                    onAdd={(userId) =>
                      void run(
                        () => addPositionHolder(position.id, project.id, userId),
                        'Position updated',
                        'Could not change that position.',
                      )
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        {editable && (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!positionName.trim()) return
              void run(
                () => createPosition(project.id, positionName, positionTeam || null, state.positions.length),
                'Position added',
                'Could not add that position.',
              ).then((ok) => ok && setPositionName(''))
            }}
          >
            <Input
              aria-label="New position name"
              placeholder="Adviser, Treasurer, Team lead"
              maxLength={LIMIT.generalShortName}
              value={positionName}
              onChange={(e) => setPositionName(e.target.value)}
              className="!h-10"
            />
            <Select
              aria-label="Position covers"
              value={positionTeam}
              onChange={(e) => setPositionTeam(e.target.value)}
              placeholder="Whole project"
              options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
              className="!h-10 !text-[13px]"
            />
            <Button type="submit" size="sm" variant="outline" className="!h-10">
              Add position
            </Button>
          </form>
        )}
      </div>

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
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await (removing.kind === 'team' ? deleteTeam(removing.id) : deletePosition(removing.id))
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
  return (
    <div className="mt-2 max-w-[16rem]">
      <Select
        aria-label="Add a person"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value)
        }}
        placeholder="Add a person…"
        options={options}
        className="!h-9 !text-[13px]"
      />
    </div>
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
