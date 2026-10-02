import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Input } from '../../ui/Field'
import { useToast } from '../../ui/Toast'
import { deleteWorkLog, logTime } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { LIMIT } from '../../../lib/limits'
import { formatMinutes, fullName } from '../../../lib/types'
import type { TaskDetail, WorkLogEntry } from '../../../lib/types'

function today() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Time spent, with what it went on, as the work task dialog lists it. Evidence
 * of effort behind a task somebody marked done themselves — it never moves a
 * mark. The total sits in the section's heading.
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
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [when, setWhen] = useState(today())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canLog = isAssignee && task.status !== 'todo'

  async function save() {
    const m = Number(minutes)
    // The database takes 1 to 1440 minutes an entry.
    if (!Number.isInteger(m) || m < 1 || m > 1440) {
      setError('Log between 1 and 1440 minutes at a time.')
      return
    }
    if (!viewerId) return
    setError(null)
    setBusy(true)
    try {
      await logTime({ taskId: task.id, studentId: viewerId, minutes: m, note, workedOn: when })
      setMinutes('')
      setNote('')
      setWhen(today())
      show('Time logged')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not log that time.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <ul className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2 text-[13px]">
            <span className="w-14 shrink-0 font-mono text-ink">{formatMinutes(e.minutes)}</span>
            <span className="min-w-0 flex-1 truncate text-muted">
              {e.student ? fullName(e.student) : 'Somebody'}
              {` · ${new Date(e.worked_on).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              {e.note ? ` · ${e.note}` : ''}
            </span>
            {e.student_id === viewerId && (
              <button
                type="button"
                aria-label="Remove time entry"
                onClick={async () => {
                  try {
                    await deleteWorkLog(e.id)
                    await onChanged()
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not remove that entry.'), 'error')
                  }
                }}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:text-destructive-600 dark:hover:text-destructive-400"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-[13px] text-faint">
            {canLog
              ? 'No time logged yet. It is a record of effort, not a mark.'
              : task.status === 'todo'
                ? 'Start the task before logging time on it.'
                : 'No time logged yet.'}
          </li>
        )}
      </ul>

      {canLog && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[5.5rem_9rem_minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Input
            aria-label="Minutes"
            type="number"
            min={1}
            max={1440}
            placeholder="Minutes"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="!h-9 !text-[13px]"
          />
          <Input
            aria-label="Day worked"
            type="date"
            value={when}
            max={today()}
            onChange={(e) => setWhen(e.target.value)}
            className="!h-9 !text-[13px]"
          />
          <Input
            aria-label="What you did"
            maxLength={LIMIT.worklogNote}
            placeholder="What you did"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="!h-9 !text-[13px]"
          />
          <Button type="submit" size="sm" variant="outline" className="!h-9" loading={busy}>
            Log
          </Button>
          {error && (
            <p className="text-[12px] text-danger-600 sm:col-span-4 dark:text-danger-400">{error}</p>
          )}
        </form>
      )}
    </div>
  )
}
