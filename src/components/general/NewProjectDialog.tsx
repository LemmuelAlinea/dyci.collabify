import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { createGeneralProject, createSpaceTeam, listSpaceTeams } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { LIMIT } from '../../lib/limits'
import { presetById, presetPayload } from '../../lib/general/presets'
import type { PresetAudience } from '../../lib/general/presets'
import { PresetPicker } from './PresetPicker'
import type { GeneralSpaceTeam } from '../../lib/general/types'

type TeamMode = 'none' | 'existing' | 'new'

/**
 * Four things and a starting shape, all changeable later. A preset writes the
 * fields, teams, positions and tasks its kind of project usually needs, so
 * nobody types out a research timeline from memory — but people are still
 * added on the project itself, where they can be seen in context.
 */
export function NewProjectDialog({
  open,
  onClose,
  spaceId,
}: {
  open: boolean
  onClose: () => void
  /** The space it goes into. Left out, the database uses your own. */
  spaceId?: string | null
}) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [preset, setPreset] = useState('blank')
  const [audience, setAudience] = useState<PresetAudience | ''>('')
  const [teams, setTeams] = useState<GeneralSpaceTeam[]>([])
  const [teamMode, setTeamMode] = useState<TeamMode>('none')
  const [teamId, setTeamId] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !spaceId) {
      setTeams([])
      setTeamMode('none')
      setTeamId('')
      return
    }
    let alive = true
    listSpaceTeams(spaceId)
      .then((rows) => {
        if (!alive) return
        setTeams(rows)
      })
      .catch(() => {
        if (!alive) return
        setTeams([])
      })
    return () => {
      alive = false
    }
  }, [open, spaceId])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Give the project a name.')
    if (startsOn && endsOn && endsOn < startsOn) return setError('The end date is before the start date.')
    if (teamMode === 'existing' && !teamId) return setError('Choose the team to use.')
    if (teamMode === 'new' && !newTeamName.trim()) return setError('Give the new team a name.')
    setBusy(true)
    try {
      const chosen = presetById(preset)
      let chosenTeamId: string | null = null
      if (teamMode === 'existing') {
        chosenTeamId = teamId
      } else if (teamMode === 'new' && spaceId) {
        const team = await createSpaceTeam({
          spaceId,
          name: newTeamName,
          description: newTeamDescription,
        })
        chosenTeamId = team.id
      }
      const project = await createGeneralProject({
        name,
        description,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        preset: chosen && chosen.id !== 'blank' ? chosen.id : null,
        content: chosen && chosen.id !== 'blank' ? presetPayload(chosen) : null,
        spaceId,
        spaceTeamId: chosenTeamId,
      })
      onClose()
      navigate(`/general/projects/${project.id}`)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      description="You become its Owner. You can change all of this later."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="new-general-project" loading={busy}>
            Create project
          </Button>
        </>
      }
    >
      <form id="new-general-project" onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              required
              maxLength={LIMIT.generalName}
              placeholder="Intramurals 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="What it is for" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              placeholder="The goal, who it is for, and what done looks like."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" optional>
            {(id) => (
              <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            )}
          </Field>
          <Field label="Ends" optional>
            {(id) => (
              <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            )}
          </Field>
        </div>
        {spaceId && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <div>
              <p className="text-[13px] font-medium text-ink">Team</p>
              <p className="mt-0.5 text-[12px] text-muted">
                Optional. Teams are reusable only inside this Space.
              </p>
            </div>
            <Select
              value={teamMode}
              onChange={(e) => {
                setTeamMode(e.target.value as TeamMode)
                setTeamId('')
              }}
              options={[
                { value: 'none', label: 'No team for now' },
                ...(teams.length ? [{ value: 'existing', label: 'Use an existing Space team' }] : []),
                { value: 'new', label: 'Create a new Space team' },
              ]}
              className="!h-10 !text-[13px]"
            />
            {teamMode === 'existing' && (
              <Field label="Existing team">
                {(id) => (
                  <Select
                    id={id}
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    placeholder="Choose a team"
                    options={teams.map((team) => ({
                      value: team.id,
                      label: `${team.name} · ${team.member_count} ${team.member_count === 1 ? 'member' : 'members'}`,
                    }))}
                    className="!h-10 !text-[13px]"
                  />
                )}
              </Field>
            )}
            {teamMode === 'new' && (
              <div className="grid gap-3">
                <Field label="New team name">
                  {(id) => (
                    <Input
                      id={id}
                      maxLength={LIMIT.generalName}
                      placeholder="Design team"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Description" optional>
                  {(id) => (
                    <Textarea
                      id={id}
                      rows={2}
                      maxLength={500}
                      placeholder="What this team handles."
                      value={newTeamDescription}
                      onChange={(e) => setNewTeamDescription(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}
          </div>
        )}
        <PresetPicker
          value={preset}
          onChange={setPreset}
          audience={audience}
          onAudienceChange={setAudience}
        />
      </form>
    </Modal>
  )
}
