import { useState } from 'react'
import { Avatar } from '../../app/Avatar'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Input } from '../../ui/Field'
import { Textarea } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { deleteWorkLog, logTime } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { formatMinutes, fullName } from '../../../lib/types'
import type { TaskDetail, WorkLogEntry } from '../../../lib/types'

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Time spent, with what it went on. Evidence of effort behind a task somebody
 * marked done themselves — it never moves a mark.
 */
export function WorkLogList({
  task,
  entries,
  viewerId,
  isAssignee,
  onChanged,
}: {
  task: TaskDetail
  entries: WorkLogEntry[]
  viewerId: string | undefined
  isAssignee: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState(1)
  const [minutes, setMinutes] = useState(0)
  const [note, setNote] = useState('')
  const [when, setWhen] = useState(today())
  const [busy, setBusy] = useState(false)

  const total = entries.reduce((n, e) => n + e.minutes, 0)
  const perPerson = new Map<string, { name: string; minutes: number }>()
  for (const e of entries) {
    const row = perPerson.get(e.student_id) ?? {
      name: e.student ? fullName(e.student) : 'Somebody',
      minutes: 0,
    }
    row.minutes += e.minutes
    perPerson.set(e.student_id, row)
  }

  const canLog = isAssignee && task.status !== 'todo'

  async function save() {
    const mins = hours * 60 + minutes
    if (!viewerId || mins < 1) return
    setBusy(true)
    try {
      await logTime({
        taskId: task.id,
        studentId: viewerId,
        minutes: mins,
        note,
        workedOn: when,
      })
      setOpen(false)
      setHours(1)
      setMinutes(0)
      setNote('')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not log that time.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {entries.length > 0 && (
        <div className="surface rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] text-muted">Logged on this task</p>
            <p className="font-mono text-[18px] text-ink">{formatMinutes(total)}</p>
          </div>
          <ul className="mt-2.5 space-y-1">
            {[...perPerson.values()].map((p) => (
              <li key={p.name} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-muted">{p.name}</span>
                <span className="font-mono text-[12.5px] text-faint">
                  {formatMinutes(p.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-[13.5px] text-muted">
          {canLog
            ? 'No time logged yet. It is a record of effort, not a mark — nothing here changes your points.'
            : task.status === 'todo'
              ? 'Start the task before logging time on it.'
              : 'Nobody on this task has logged time.'}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-2.5">
              {e.student ? (
                <Avatar profile={e.student} size={28} />
              ) : (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full surface-sunken text-faint">
                  <Icon name="user" size={14} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
                  <span className="font-medium text-ink">
                    {e.student ? fullName(e.student) : 'Somebody'}
                  </span>
                  <span className="font-mono text-[12.5px] text-amber-700 dark:text-amber-300">
                    {formatMinutes(e.minutes)}
                  </span>
                  <span className="font-mono text-[11.5px] text-faint">
                    {new Date(e.worked_on).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </p>
                {e.note && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{e.note}</p>
                )}
              </div>
              {e.student_id === viewerId && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await deleteWorkLog(e.id)
                      await onChanged()
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not remove that entry.'), 'error')
                    }
                  }}
                  aria-label="Remove this entry"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canLog &&
        (open ? (
          <div className="surface space-y-3 rounded-xl border border-line p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="block text-[12.5px] text-faint">Hours</span>
                <Input
                  type="number"
                  min={0}
                  max={24}
                  value={hours}
                  onChange={(e) => setHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                  className="!h-10"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[12.5px] text-faint">Minutes</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) =>
                    setMinutes(Math.max(0, Math.min(59, Number(e.target.value) || 0)))
                  }
                  className="!h-10"
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[12.5px] text-faint">Date</span>
                <Input
                  type="date"
                  value={when}
                  max={today()}
                  onChange={(e) => setWhen(e.target.value)}
                  className="!h-10"
                />
              </label>
            </div>

            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What the time went on."
              aria-label="What you did"
              className="!text-[13.5px]"
            />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="!rounded-lg"
                loading={busy}
                disabled={hours * 60 + minutes < 1}
                onClick={save}
              >
                Log {formatMinutes(hours * 60 + minutes)}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="!rounded-lg" onClick={() => setOpen(true)}>
            <Icon name="clock" size={15} />
            Log time
          </Button>
        ))}
    </div>
  )
}
