import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import type { SprintInput } from '../../lib/work/types'

/** The Team picker, on a work project with teams. */
export type SprintTeamField = {
  options: { value: string; label: string }[]
  /** In Multiple sprint streams every sprint needs a team. */
  required: boolean
  /** Set when the team cannot change, saying why. */
  lockedReason?: string
  /** A fresh name and dates for a team, used until the person edits them. */
  draftFor?: (teamId: string) => SprintInput
}

/**
 * Create or edit a sprint. The parent passes a `key` that changes per sprint,
 * so the fields start from `initial` each time it opens.
 */
export function SprintDialog({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  team,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: SprintInput
  team?: SprintTeamField
  onSubmit: (input: SprintInput) => Promise<unknown>
}) {
  const [name, setName] = useState(initial.name)
  const [goal, setGoal] = useState(initial.goal)
  const [startsOn, setStartsOn] = useState(initial.startsOn)
  const [endsOn, setEndsOn] = useState(initial.endsOn)
  const [teamId, setTeamId] = useState(initial.teamId ?? '')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function chooseTeam(next: string) {
    setTeamId(next)
    const draft = next && !edited ? team?.draftFor?.(next) : undefined
    if (draft) {
      setName(draft.name)
      setStartsOn(draft.startsOn)
      setEndsOn(draft.endsOn)
    }
  }

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A sprint needs a name.')
    if (!startsOn || !endsOn) return setError('A sprint needs a start and an end date.')
    if (endsOn < startsOn) return setError('A sprint cannot end before it starts. Move one of the two dates.')
    if (team?.required && !teamId) return setError('Choose the team this sprint is for.')
    setBusy(true)
    try {
      await onSubmit({ name, goal, startsOn, endsOn, ...(team ? { teamId: teamId || null } : {}) })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the sprint.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => <Input id={id} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setEdited(true) }} />}
        </Field>
        {team && (
          <Field
            label="Team"
            optional={!team.required}
            hint={team.lockedReason ? <span className="text-[12px] text-faint">{team.lockedReason}</span> : undefined}
          >
            {(id) => (
              <Select
                id={id}
                value={teamId}
                onChange={(e) => chooseTeam(e.target.value)}
                placeholder={team.required ? 'Choose a team' : 'No team'}
                options={team.options}
                disabled={Boolean(team.lockedReason)}
              />
            )}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => { setStartsOn(e.target.value); setEdited(true) }} />}
          </Field>
          <Field label="Ends">
            {(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => { setEndsOn(e.target.value); setEdited(true) }} />}
          </Field>
        </div>
        <Field label="Goal" optional hint={<span className="text-[12px] text-faint">What this sprint should get done, in a sentence.</span>}>
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
