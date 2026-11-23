import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { useToast } from '../ui/Toast'
import {
  cancelTimer,
  isLongTimerError,
  myTimer,
  startTimer,
  stopTimer,
  type RunningTimer,
} from '../../lib/api/workload'
import { formatHours, formatSpent, parseHours } from '../../lib/work/hours'

/** "Est. 6 h · Spent 7 h 20 m", in warning once spent passes the estimate; "Spent 7 h 20 m" with no estimate. */
export function EstimateSpent({
  estimate,
  spent,
  className = '',
}: {
  estimate: number | null | undefined
  spent: number
  className?: string
}) {
  const over = estimate != null && spent > estimate
  const text = estimate != null ? `Est. ${formatHours(estimate)} · Spent ${formatSpent(spent)}` : `Spent ${formatSpent(spent)}`
  return (
    <span
      data-estimate-spent=""
      className={`font-mono ${over ? 'text-warning-700 dark:text-warning-300' : 'text-ink'} ${className}`}
    >
      {text}
    </span>
  )
}

/** Elapsed time as h:mm. */
function elapsed(startedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60_000))
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

function messageOf(err: unknown, fallback: string): string {
  return err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : fallback
}

/**
 * Start and Stop for the person's one running timer, on a task they hold. The
 * timer lives on the server, so it survives reloads, tabs and devices; refusals
 * reload it so the buttons match what is really running.
 */
export function TaskTimer({ task, onLogged }: { task: { id: string; title: string }; onLogged: () => void }) {
  const { show } = useToast()
  const [timer, setTimer] = useState<RunningTimer | null | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [hours, setHours] = useState('8')

  const load = useCallback(async () => {
    try {
      setTimer(await myTimer())
      setNow(Date.now())
    } catch {
      setTimer(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runningHere = timer?.task_id === task.id
  useEffect(() => {
    if (!runningHere) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [runningHere])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      if (isLongTimerError(err)) {
        setHours('8')
        setConfirming(true)
      } else {
        setError(messageOf(err, 'The timer could not be changed. Try again.'))
      }
    } finally {
      await load()
      setBusy(false)
    }
  }

  async function finish(minutes?: number) {
    const logged = minutes == null ? await stopTimer() : await stopTimer(minutes)
    setConfirming(false)
    if (logged === 0) {
      setError('You no longer hold this task. The timer was cleared and nothing was logged.')
      return
    }
    show(`Logged ${formatSpent(logged)}`)
    onLogged()
  }

  if (timer === undefined) return null

  const confirmMinutes = parseHours(hours)
  const confirmValid = typeof confirmMinutes === 'number' && confirmMinutes <= 1440

  return (
    <div className="space-y-2 text-[13px]">
      {confirming ? (
        <div className="space-y-2 rounded-lg border border-warning-300 p-3 dark:border-warning-400/50">
          <p className="text-ink">This timer ran past 8 hours. How long did you work on it?</p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              step="any"
              min="0"
              aria-label="Hours worked"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-24"
            />
            <span className="text-muted">h</span>
            <Button
              size="sm"
              disabled={busy || !confirmValid}
              onClick={() => void run(() => finish(confirmMinutes as number))}
            >
              Log it
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await cancelTimer(); setConfirming(false) })}>
              Discard
            </Button>
          </div>
          {!confirmValid && <p className="text-[12px] text-danger-600 dark:text-danger-400">Enter between 1 minute and 24 hours.</p>}
        </div>
      ) : runningHere ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Timer</span>
          <span data-timer-elapsed="" className="font-mono text-ink">{elapsed(timer.started_at, now)}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => finish())}>
            Stop
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(cancelTimer)}>
            Discard
          </Button>
        </div>
      ) : timer ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-muted">Timer running on {timer.title}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await startTimer(task.id); onLogged() })}>
            Start here
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { await startTimer(task.id) })}>
          Start timer
        </Button>
      )}
      {error && <p role="alert" className="text-[12px] text-danger-600 dark:text-danger-400">{error}</p>}
    </div>
  )
}
