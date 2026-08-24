import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Alert, Field } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { boardResult, recordResult } from '../../lib/api/results'
import { authErrorMessage } from '../../lib/authError'
import { resultLabel } from '../../lib/types'
import type { BoardResult, BoardSummary, Role } from '../../lib/types'

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The end of the line the work has been travelling: set, done, handed in, and
 * now answered.
 *
 * Returning is not a second kind of state — it un-submits the board, so "fix
 * this and hand it in again" is expressed with the machinery the group already
 * understands.
 */
export function BoardVerdict({
  board,
  role,
  onChanged,
}: {
  board: BoardSummary
  role: Role
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [result, setResult] = useState<BoardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [returning, setReturning] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setResult(await boardResult(board.id))
    } catch {
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [board.id])

  useEffect(() => {
    void load()
  }, [load])

  const isProfessor = role === 'professor'
  const submitted = Boolean(board.submitted_at)

  async function answer(verdict: 'accepted' | 'returned') {
    if (verdict === 'returned' && !feedback.trim()) {
      setError('Say what needs fixing. The group only sees this.')
      return
    }
    setBusy(true)
    try {
      await recordResult({ boardId: board.id, verdict, feedback })
      show(verdict === 'accepted' ? 'Marked as accepted' : 'Returned to the group')
      setReturning(false)
      setFeedback('')
      setError(null)
      await Promise.all([load(), onChanged()])
    } catch (err) {
      setError(authErrorMessage(err, 'Could not record that.'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-4 text-[13.5px] text-muted">
        <Spinner size={15} />
        Loading the answer…
      </div>
    )
  }

  // Nothing to say about work nobody has handed in, and no answer to show.
  if (!submitted && !result) return null

  const accepted = result?.verdict === 'accepted'

  return (
    <>
      <section
        className={`surface rounded-card border p-4 sm:p-5 shadow-card ${
          accepted
            ? 'border-emerald-300 dark:border-emerald-500/40'
            : result
              ? 'border-amber-300 dark:border-amber-400/40'
              : 'border-line'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[16px]">
              {result && (
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full ${
                    accepted
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-400/20 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <Icon name={accepted ? 'check' : 'refresh'} size={15} />
                </span>
              )}
              {result ? resultLabel(result.verdict) : 'Waiting on your answer'}
            </h3>

            {result ? (
              <p className="mt-1 text-[12.5px] text-faint">
                {result.decided_by_name ?? 'Your professor'} · {when(result.decided_at)}
                {result.answer_count > 1 && ` · answered ${result.answer_count} times`}
              </p>
            ) : (
              <p className="mt-1 max-w-[58ch] text-[13.5px] leading-relaxed text-muted">
                {isProfessor
                  ? 'Handed in and waiting. Accepting leaves it frozen; returning it gives the group their board back so they can fix it.'
                  : 'Handed in. Your professor has not answered yet.'}
              </p>
            )}
          </div>

          {isProfessor && submitted && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setReturning(true)}
              >
                <Icon name="refresh" size={15} />
                Return it
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void answer('accepted')}>
                <Icon name="check" size={15} />
                Accept
              </Button>
            </div>
          )}
        </div>

        {result?.feedback && (
          <blockquote className="mt-3.5 rounded-xl surface-sunken px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-ink">
            {result.feedback}
          </blockquote>
        )}

        {error && !returning && (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </section>

      <Modal
        open={returning}
        onClose={() => setReturning(false)}
        title="Return this for another look"
        description={board.group_name ?? board.student_name ?? undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturning(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void answer('returned')} disabled={busy}>
              {busy ? 'Sending…' : 'Return it'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-[13.5px] leading-relaxed text-muted">
            This hands the board back, so the group can change their tasks and files again
            and hand in a second time.
          </p>
          <Field label="What needs fixing">
            {(id) => (
              <Textarea
                id={id}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                placeholder="What is missing, and what would make it acceptable."
              />
            )}
          </Field>
        </div>
      </Modal>
    </>
  )
}
