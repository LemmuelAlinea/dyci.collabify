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
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type Renaming = { kind: 'team' | 'position'; id: string; name: string } | null
type Removing = { kind: 'team' | 'position'; id: string; name: string } | null

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
  const [positionName, setPositionName] = useState('')
  const [positionTeam, setPositionTeam] = useState('')
  const [renaming, setRenaming] = useState<Renaming>(null)
  const [removing, setRemoving] = useState<Removing>(null)

  const project = state.project
  if (!project) return null

  async function run(action: () => Promise<void>, done: string, failed: string) {
    try {
      await action()
      show(done)
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    }
  }

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
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
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
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!teamName.trim()) return
              void run(() => createTeam(project.id, teamName), 'Team added', 'Could not add that team.').then(() =>
                setTeamName(''),
              )
            }}
          >
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
                        className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
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
              ).then(() => setPositionName(''))
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
