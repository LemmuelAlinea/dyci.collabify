import { useEffect, useMemo, useState } from 'react'
import { createMeeting, updateMeeting } from '../../lib/api/meetings'
import { authErrorMessage } from '../../lib/authError'
import { fromLocalInput, toLocalInput } from '../../lib/general/dates'
import { PLATFORM_LABEL, audienceText, detectPlatform } from '../../lib/meetings'
import type { Meeting, MeetingAudience, MeetingScope } from '../../lib/meetings'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input, Toggle } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'

const DURATIONS = [15, 30, 45, 60, 90, 120, 180].map((n) => ({
  value: String(n),
  label: n < 60 ? `${n} minutes` : n === 60 ? '1 hour' : `${n / 60} hours`,
}))

/** Classes and spaces are where; the audiences inside them are who. */
const whereKey = (a: Pick<MeetingAudience, 'scope' | 'class_id' | 'space_id'>) =>
  a.scope === 'class' || a.scope === 'group' ? `c:${a.class_id}` : `s:${a.space_id}`

function whoLabel(a: MeetingAudience) {
  switch (a.scope) {
    case 'class':
      return 'Whole class'
    case 'group':
      return `${a.label} · ${a.context.split(' · ').slice(1).join(' · ') || 'Group'}`
    case 'space':
      return 'Whole space'
    case 'project':
      return `Project · ${a.label}`
    case 'space_team':
      return `Team · ${a.label}`
    case 'project_team':
      return `Project team · ${a.label} (${a.context})`
  }
}

/** The next whole hour, the time people actually pick. */
function nextHour() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return toLocalInput(d.toISOString())
}

/**
 * Schedule a meeting, start one now, or change one that exists.
 *
 * The audience comes in two steps — a class or space, then who in it — because
 * a teacher of four classes with six groups each would otherwise scroll through
 * a list of thirty. Only audiences the reader may schedule for are offered; the
 * database checks again either way.
 */
export function ScheduleMeetingModal({
  open,
  onClose,
  audiences,
  editing,
  startNow = false,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  audiences: MeetingAudience[]
  /** A meeting to change. Its audience is fixed. */
  editing?: Meeting | null
  /** Open with "Start now" on. */
  startNow?: boolean
  onSaved: (id: string) => void
}) {
  const { show } = useToast()
  const creatable = useMemo(() => audiences.filter((a) => a.can_create), [audiences])

  const places = useMemo(() => {
    // Name each class or space from the clearest row that mentions it.
    const names = new Map<string, string>()
    for (const a of audiences) {
      const key = whereKey(a)
      if (a.scope === 'class') names.set(key, `${a.label} · ${a.context}`)
      else if (a.scope === 'space') names.set(key, a.label)
      else if (!names.has(key) && (a.scope === 'group' || a.scope === 'project' || a.scope === 'space_team')) {
        names.set(key, a.scope === 'group' ? a.context.split(' · ')[0] : a.context)
      }
    }
    const seen = new Set<string>()
    const out: { value: string; label: string }[] = []
    for (const a of creatable) {
      const key = whereKey(a)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ value: key, label: names.get(key) ?? 'A space' })
    }
    return out
  }, [audiences, creatable])

  const [where, setWhere] = useState('')
  const [who, setWho] = useState('')
  const [title, setTitle] = useState('')
  const [now, setNow] = useState(startNow)
  const [starts, setStarts] = useState('')
  const [duration, setDuration] = useState('60')
  const [link, setLink] = useState('')
  const [agenda, setAgenda] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset each time it opens, from the meeting being changed or from scratch.
  useEffect(() => {
    if (!open) return
    setError(null)
    if (editing) {
      setTitle(editing.title)
      setNow(false)
      setStarts(toLocalInput(editing.starts_at))
      setDuration(String(editing.duration_min))
      setLink(editing.join_url)
      setAgenda(editing.agenda)
      return
    }
    const first = places.length === 1 ? places[0].value : ''
    setWhere(first)
    setWho('')
    setTitle('')
    setNow(startNow)
    setStarts(nextHour())
    setDuration('60')
    setLink('')
    setAgenda('')
  }, [open, editing, startNow]) // eslint-disable-line react-hooks/exhaustive-deps

  const whoOptions = creatable
    .filter((a) => whereKey(a) === where)
    .map((a) => ({ value: `${a.scope}:${a.audience_id}`, label: whoLabel(a) }))

  // A place with one audience in it needs no second choice.
  useEffect(() => {
    if (!editing && whoOptions.length === 1) setWho(whoOptions[0].value)
  }, [where]) // eslint-disable-line react-hooks/exhaustive-deps

  const platform = detectPlatform(link)
  // "Everyone in Trial Space", "Everyone in Group A": the whole of a class or
  // space is named by the place, anything smaller by itself.
  const chosen = creatable.find((a) => `${a.scope}:${a.audience_id}` === who)
  const placeName = places.find((p) => p.value === where)?.label
  const audienceName = editing
    ? audienceText(editing)
    : chosen && (chosen.scope === 'class' || chosen.scope === 'space' ? placeName : chosen.label)

  async function save() {
    setError(null)
    if (!editing && !who) return setError('Choose who the meeting is for.')
    if (!title.trim()) return setError('Give the meeting a title.')
    if (!platform) return setError('Paste a Zoom or Google Meet link. It starts with https://zoom.us/ or https://meet.google.com/.')
    const startsAt = now ? new Date().toISOString() : fromLocalInput(starts)
    if (!startsAt) return setError('Pick when the meeting starts.')
    const input = { title: title.trim(), agenda, joinUrl: link.trim(), startsAt, durationMin: Number(duration) }
    setBusy(true)
    try {
      if (editing) {
        await updateMeeting(editing.id, input)
        show('Meeting updated. Everyone in it was notified of any new time or link.')
        onSaved(editing.id)
      } else {
        const [scope, id] = who.split(':') as [MeetingScope, string]
        const m = await createMeeting(scope, id, input)
        show(now ? 'Meeting started. Everyone in it was notified.' : 'Meeting scheduled. Everyone in it was notified.')
        onSaved(m.id)
      }
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the meeting.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit meeting' : now ? 'Start a meeting now' : 'Schedule a meeting'}
      description="Make the meeting in Zoom or Google Meet, then paste its link here."
      size="lg"
      focusField
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-muted">
            {audienceName ? `Everyone in ${audienceName} is notified when you save.` : 'Everyone you invite is notified when you save.'}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy}>
              {editing ? 'Save changes' : now ? 'Start meeting' : 'Schedule meeting'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {editing ? (
          <p className="rounded-xl surface-sunken px-3.5 py-2.5 text-[13px] text-muted">
            For <span className="font-medium text-ink">{audienceText(editing)}</span>
          </p>
        ) : creatable.length === 0 ? (
          <Alert tone="info">
            You are not in a class, group, space, project or team you can schedule for yet.
          </Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where">
              {(id) => (
                <Select
                  id={id}
                  value={where}
                  onChange={(e) => {
                    setWhere(e.target.value)
                    setWho('')
                  }}
                  placeholder="Pick a class or space"
                  options={places}
                />
              )}
            </Field>
            <Field label="Who">
              {(id) => (
                <Select
                  id={id}
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  placeholder={where ? 'Pick who it is for' : 'Pick where first'}
                  options={whoOptions}
                  disabled={!where}
                />
              )}
            </Field>
          </div>
        )}

        <Field label="Title">
          {(id) => (
            <Input id={id} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly check-in" />
          )}
        </Field>

        {!editing && (
          <label className="flex items-center justify-between gap-3 rounded-xl surface-sunken px-3.5 py-3">
            <span>
              <span className="block text-[14px] font-medium text-ink">Start now</span>
              <span className="block text-[12px] text-muted">Notifies everyone that the meeting has begun.</span>
            </span>
            <Toggle checked={now} onChange={setNow} label="Start now" />
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {!now && (
            <Field label="Starts">
              {(id) => <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />}
            </Field>
          )}
          <Field label="Length">
            {(id) => <Select id={id} value={duration} onChange={(e) => setDuration(e.target.value)} options={DURATIONS} />}
          </Field>
        </div>

        <Field
          label="Meeting link"
          hint={
            link.trim() ? (
              <span className={`text-[12px] ${platform ? 'text-success-700 dark:text-success-300' : 'text-danger-600 dark:text-danger-400'}`}>
                {platform ? PLATFORM_LABEL[platform] : 'Not a Zoom or Meet link'}
              </span>
            ) : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://meet.google.com/… or https://zoom.us/j/…"
            />
          )}
        </Field>
        <p className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <a href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy-600 hover:underline dark:text-navy-200">
            <Icon name="plus" size={12} />
            New Google Meet
          </a>
          <a href="https://zoom.us/meeting/schedule" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy-600 hover:underline dark:text-navy-200">
            <Icon name="plus" size={12} />
            New Zoom meeting
          </a>
          <span>Copy the link it gives you, then paste it above.</span>
        </p>

        <Field label="Agenda" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              maxLength={2000}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="What the meeting is for, and anything to bring."
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
