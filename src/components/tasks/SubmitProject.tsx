import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { setBoardSubmitted } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary } from '../../lib/types'

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Handing in the whole project rather than one more task.
 *
 * Reversible on purpose: the group can take it back while the project is open,
 * so pressing this by mistake costs nothing. Once the professor closes the
 * project, neither the submission nor anything under it moves.
 */
export function SubmitProject({
  board,
  /** The professor has closed the project, so nothing here can change. */
  locked,
  onChanged,
}: {
  board: BoardSummary
  locked: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const submitted = Boolean(board.submitted_at)
  const unfinished = board.task_count - board.done_count
  const group = Boolean(board.group_id)

  async function set(next: boolean) {
    setBusy(true)
    try {
      await setBoardSubmitted(board.id, next)
      show(next ? 'Project handed in' : 'Submission taken back')
      await onChanged()
    } catch (err) {
      // Rethrown so ConfirmDialog shows it inline and stays open; the toast is
      // for the take-it-back button, which has no dialog around it.
      show(authErrorMessage(err, 'Could not change that.'), 'error')
      throw err
    } finally {
      setBusy(false)
    }
  }

  if (submitted) {
    return (
      <section className="surface rounded-card border border-emerald-300 p-4 sm:p-5 shadow-card dark:border-emerald-500/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <Icon name="check" size={15} />
              </span>
              Handed in
            </h3>
            <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">
              {board.submitted_by_name
                ? `${board.submitted_by_name} handed this in on ${when(board.submitted_at as string)}.`
                : `Handed in on ${when(board.submitted_at as string)}.`}{' '}
              The tasks are fixed now. You can still comment on them, and your professor can
              see everything.
            </p>
          </div>

          {!locked && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void set(false)}
            >
              <Icon name="refresh" size={15} />
              Take it back
            </Button>
          )}
        </div>

        {locked && (
          <p className="mt-3 text-[12px] text-faint">
            Your professor has closed this project, so the submission cannot be taken back.
          </p>
        )}
      </section>
    )
  }

  if (locked) return null

  return (
    <>
      <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="">Ready to hand in?</h3>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-muted">
              {unfinished > 0
                ? `${unfinished} ${unfinished === 1 ? 'task is' : 'tasks are'} still unfinished. You can hand in anyway — your professor sees where the work got to.`
                : 'Every task is done. Handing in fixes them so nothing changes after the fact.'}
            </p>
          </div>
          <Button size="sm" onClick={() => setConfirm(true)}>
            <Icon name="check" size={15} />
            Hand in the project
          </Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => set(true)}
        tone="primary"
        title="Hand in this project?"
        confirmLabel="Hand it in"
        body={
          <>
            {unfinished > 0 && (
              <p className="mb-2 font-medium text-ink">
                {unfinished} of {board.task_count}{' '}
                {unfinished === 1 ? 'task is' : 'tasks are'} not finished.
              </p>
            )}
            <p>
              {group ? 'Your group' : 'You'} will not be able to move, edit or attach anything
              after this. Comments stay open, and {group ? 'any member' : 'you'} can take the
              submission back while the project is still open.
            </p>
          </>
        }
      />
    </>
  )
}
