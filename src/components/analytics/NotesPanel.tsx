import { useId, useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { useNow } from '../../hooks/useNow'
import { manilaDay } from '../../lib/analyticsMath'
import { addClassNote, resolveClassNote } from '../../lib/api/notes'
import { authErrorMessage } from '../../lib/authError'
import { ADDABLE_KINDS, NOTE_KIND_META } from '../../lib/notes'
import type { AddableNoteKind } from '../../lib/notes'
import type { ClassNote } from '../../lib/types'

const stampFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const dayFmt = (day: string) => stampFmt.format(new Date(`${day}T00:00:00+08:00`))
const field = 'rounded-lg border border-line surface px-2.5 text-[13px] text-ink'

/**
 * What the teaching staff noted and did about one student or one group, and a
 * place to add the next note. Only teaching staff ever see this.
 */
export function NotesPanel({
  classId,
  studentId = null,
  boardId = null,
  notes,
  onChanged,
}: {
  classId: string
  studentId?: string | null
  boardId?: string | null
  notes: ClassNote[]
  onChanged: () => Promise<void>
}) {
  const { show } = useToast()
  const ids = useId()
  const now = useNow()
  const today = manilaDay(new Date(now))
  const [kind, setKind] = useState<AddableNoteKind>('note')
  const [body, setBody] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [outcome, setOutcome] = useState('')

  const needsDate = kind === 'follow_up' && !followUp

  const add = async () => {
    setBusy(true)
    try {
      await addClassNote({ classId, studentId, boardId, kind, body: body.trim(), followUpOn: followUp || null })
      await onChanged()
      setBody('')
      setFollowUp('')
      show('Note added')
    } catch (err) {
      show(authErrorMessage(err, 'Could not add the note. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (id: string) => {
    setBusy(true)
    try {
      await resolveClassNote(id, outcome.trim())
      await onChanged()
      setResolving(null)
      setOutcome('')
      show('Note resolved')
    } catch (err) {
      show(authErrorMessage(err, 'Could not resolve the note. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-[13px] text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const meta = NOTE_KIND_META[n.kind]
            const due = !n.resolved_at && n.follow_up_on !== null && n.follow_up_on <= today
            return (
              <li key={n.id} className="space-y-1.5 rounded-xl border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[meta.tone]}`}>{meta.label}</span>
                  {stampFmt.format(new Date(n.created_at))}
                  {n.follow_up_on && (
                    <span className={due ? 'text-warning-700 dark:text-warning-300' : ''}>
                      · Follow up by {dayFmt(n.follow_up_on)}
                    </span>
                  )}
                  {n.resolved_at && <span>· Resolved {stampFmt.format(new Date(n.resolved_at))}</span>}
                </p>
                <p className="whitespace-pre-wrap text-[13px] text-ink">{n.body}</p>
                {n.resolved_at && n.outcome && <p className="text-[13px] text-muted">Outcome: {n.outcome}</p>}
                {!n.resolved_at &&
                  n.kind !== 'nudge' &&
                  n.kind !== 'peer_reminder' &&
                  (resolving === n.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${ids}-outcome-${n.id}`} className="sr-only">
                        Outcome
                      </label>
                      <input
                        id={`${ids}-outcome-${n.id}`}
                        value={outcome}
                        maxLength={1000}
                        placeholder="What came of it (optional)"
                        onChange={(e) => setOutcome(e.target.value)}
                        className={`${field} h-9 min-w-0 flex-1`}
                      />
                      <Button size="sm" disabled={busy} onClick={() => resolve(n.id)}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResolving(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResolving(n.id)
                        setOutcome('')
                      }}
                    >
                      Resolve…
                    </Button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="space-y-2 rounded-xl surface-sunken p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim() && !needsDate) void add()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AddableNoteKind)}
              className={`${field} h-9`}
            >
              {ADDABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">{kind === 'follow_up' ? 'Follow up by' : 'Follow up by (optional)'}</span>
            <input
              type="date"
              value={followUp}
              min={today}
              onChange={(e) => setFollowUp(e.target.value)}
              className={`${field} h-9`}
            />
            {needsDate && <span className="block text-[12px] text-faint">Pick the day to follow up.</span>}
          </label>
        </div>
        <label className="block space-y-1 text-[12px] text-muted">
          <span className="block">Note</span>
          <textarea
            value={body}
            maxLength={2000}
            rows={2}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What you saw, said or agreed"
            className={`${field} w-full py-2`}
          />
        </label>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy || !body.trim() || needsDate}>
            Add note
          </Button>
        </div>
      </form>
    </div>
  )
}
