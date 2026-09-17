import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { recordResult } from '../../lib/api/results'
import { authErrorMessage } from '../../lib/authError'
import { awaitingDecision, boardOwnerName } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'

/**
 * Work that has been handed in and not yet answered.
 *
 * This is the only thing on the project page that is genuinely *waiting on the
 * professor*, and until now it had nowhere of its own: a handed-in board was a
 * small "In" chip on one tile among twenty, and answering it meant finding the
 * tile, opening the board, scrolling past its progress and its members, and
 * arriving at the verdict panel at the bottom. Everything else on the page is
 * something to read; this is the part to act on, so it goes first and it is
 * answerable without opening anything.
 *
 * A board belongs here when it was submitted **more recently than the last
 * decision on it** — `awaitingDecision`. A board that was returned and handed
 * back in is waiting again, which the simpler test ("handed in and has no
 * verdict") missed.
 */
export function HandInQueue({
  boards,
  solo,
  onOpen,
  onChanged,
}: {
  boards: BoardSummary[]
  /** An individual project: these are students, not groups. */
  solo: boolean
  /** Open the board underneath, for a professor who wants to look before answering. */
  onOpen: (board: BoardSummary) => void
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [returning, setReturning] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const waiting = boards.filter(awaitingDecision)
  if (waiting.length === 0) return null

  async function answer(board: BoardSummary, verdict: 'accepted' | 'returned') {
    // Returning without saying why leaves a group guessing, so the note is
    // required here exactly as it is in the full verdict panel.
    if (verdict === 'returned' && !note.trim()) {
      setError('Say what needs fixing. The group only sees this.')
      return
    }
    setBusy(board.id)
    setError(null)
    try {
      await recordResult({ boardId: board.id, verdict, feedback: note })
      show(
        verdict === 'accepted'
          ? `${boardOwnerName(board)} accepted`
          : `Returned to ${boardOwnerName(board)}`,
      )
      setReturning(null)
      setNote('')
      await onChanged()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not record that.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-panel border border-amber-300 bg-amber-400/6 dark:border-amber-400/40 dark:bg-amber-400/8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300/60 px-4 py-3.5 sm:px-5 dark:border-amber-400/25">
        <div className="flex items-center gap-2.5">
          <Icon name="checkCircle" size={17} className="text-amber-600 dark:text-amber-300" />
          <div>
            <h3 className="text-ink">Waiting on you</h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Handed in, and not yet answered.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-400/25 px-2.5 py-1 font-mono text-[12px] font-medium text-amber-800 dark:text-amber-200">
          {waiting.length}
        </span>
      </header>

      {error && (
        <div className="px-4 pt-4 sm:px-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <ul className="divide-y divide-amber-300/50 dark:divide-amber-400/20">
        {waiting.map((b) => {
          const pct = Number(b.done_pct)
          const open = returning === b.id
          return (
            <li key={b.id} className="px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  // A floor on the width, so on a phone the buttons wrap under
                  // the text instead of squeezing it into a column.
                  className="min-w-[14rem] flex-1 text-left"
                >
                  <span className="block text-[14px] font-medium text-ink hover:underline">
                    {boardOwnerName(b)}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    Handed in {since(b.submitted_at)}
                    {b.submitted_by_name ? ` by ${b.submitted_by_name}` : ''} ·{' '}
                    {b.done_count}/{b.task_count} done
                    {/* The number a professor actually weighs before answering:
                        a board handed in at 60% is a different decision from one
                        handed in finished. */}
                    {pct < 100 && (
                      <span className="text-amber-700 dark:text-amber-300">
                        {' '}
                        · {pct}% of the work
                      </span>
                    )}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === b.id}
                    onClick={() => {
                      setReturning(open ? null : b.id)
                      setNote('')
                      setError(null)
                    }}
                  >
                    <Icon name="refresh" size={14} />
                    Return
                  </Button>
                  <Button
                    size="sm"
                    loading={busy === b.id && !open}
                    onClick={() => void answer(b, 'accepted')}
                  >
                    <Icon name="check" size={14} />
                    Accept
                  </Button>
                </div>
              </div>

              {/* Inline rather than a dialog: the professor is working down a
                  list, and a modal per row would hide the rest of the queue
                  they are working through. */}
              {open && (
                <div className="mt-3 space-y-2.5">
                  <Textarea
                    autoFocus
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What is missing, and what would make it acceptable."
                    aria-label={`What ${boardOwnerName(b)} needs to fix`}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] text-muted">
                      Returning gives the work back — {solo ? 'the student' : 'the group'} can
                      change it and hand in again.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setReturning(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        loading={busy === b.id}
                        onClick={() => void answer(b, 'returned')}
                      >
                        Return it
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function since(iso: string | null) {
  if (!iso) return 'recently'
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return ago(Math.floor(secs / 60), 'minute')
  if (secs < 172800) return ago(Math.floor(secs / 3600), 'hour')
  return ago(Math.floor(secs / 86400), 'day')
}

function ago(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}
