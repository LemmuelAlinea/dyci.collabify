import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { fullName } from '../../lib/types'
import type { GroupMember, MemberProgress, ProjectTask } from '../../lib/types'

/**
 * Who is on a task. Claiming is the group's business — a professor sees the
 * faces but gets no controls, by design and by trigger.
 */
export function AssigneePicker({
  task,
  members,
  progress,
  perPerson,
  viewerId,
  canChange,
  onClaim,
  onRelease,
}: {
  task: ProjectTask
  members: GroupMember[]
  /** Who still has room under their share of the board. */
  progress: MemberProgress[]
  /** What each person on this task earns from it, once it is done. */
  perPerson: number
  viewerId: string | undefined
  canChange: boolean
  onClaim: (studentId: string) => Promise<void> | void
  onRelease: (studentId: string) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const taken = new Set(task.assignees.map((a) => a.student_id))
  const mine = viewerId ? taken.has(viewerId) : false
  // The database refuses a claim past a fair share, so say so before the click.
  const room = (studentId: string) =>
    progress.find((p) => p.student_id === studentId)?.can_claim ?? true
  const viewerFull = viewerId ? !room(viewerId) : false
  const shared = task.assignees.length > 1
  // Handing work back stops the moment somebody starts it.
  const releasable = task.status === 'todo'

  if (task.assignees.length === 0 && !canChange) {
    return <span className="text-[12px] text-faint">Unclaimed</span>
  }

  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <div className="flex">
        {task.assignees.map(
          (a) =>
            a.profile && (
              <span
                key={a.student_id}
                title={`${fullName(a.profile)} — ${perPerson}% from this task`}
                className="-ml-1.5 rounded-full ring-2 ring-[var(--surface)] first:ml-0"
              >
                <Avatar profile={a.profile} size={24} />
              </span>
            ),
        )}
      </div>

      {/* Shared work splits evenly, so say what each person actually earns. */}
      {shared && (
        <span
          title={`Split ${task.assignees.length} ways`}
          className="rounded-md bg-amber-400/18 px-1.5 py-0.5 font-mono text-[10.5px] text-amber-700 dark:text-amber-300"
        >
          {perPerson}% each
        </span>
      )}

      {canChange &&
        (task.assignees.length === 0 ? (
          <button
            type="button"
            disabled={viewerFull}
            title={
              viewerFull
                ? 'You already carry a full share of this project'
                : undefined
            }
            onClick={() => viewerId && void onClaim(viewerId)}
            className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-navy-400 hover:text-ink disabled:pointer-events-none disabled:opacity-45"
          >
            {viewerFull ? 'Your share is full' : 'Claim it'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Change who is on this"
            aria-expanded={open}
            className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="plus" size={14} />
          </button>
        ))}

      {open && canChange && (
        <div className="surface absolute top-8 right-0 z-30 w-[240px] overflow-hidden rounded-xl border border-line shadow-lift">
          <p className="border-b border-line px-3 py-2 text-[12px] text-faint">
            {releasable
              ? `Anyone in the group can take this. Splitting it gives each person ${perPerson}% now, less as more join.`
              : 'Started, so it stays with whoever is on it.'}
          </p>
          <ul className="max-h-[220px] overflow-y-auto py-1">
            {members.map((m) => {
              const on = taken.has(m.student_id)
              const full = !on && !room(m.student_id)
              // Taking someone off is the same rule as walking away yourself.
              const locked = on && !releasable
              return (
                <li key={m.student_id}>
                  <button
                    type="button"
                    disabled={full || locked}
                    title={locked ? 'Already started, so it stays with them' : undefined}
                    onClick={async () => {
                      await (on ? onRelease(m.student_id) : onClaim(m.student_id))
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)] disabled:pointer-events-none disabled:opacity-45"
                  >
                    <Avatar profile={m.profile} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                      {fullName(m.profile)}
                      {m.student_id === viewerId && (
                        <span className="ml-1 text-[12px] text-faint">you</span>
                      )}
                      {full && (
                        <span className="block text-[11.5px] text-faint">share is full</span>
                      )}
                    </span>
                    {on && <Icon name="check" size={15} className="text-amber-500" />}
                  </button>
                </li>
              )
            })}
          </ul>
          {mine && viewerId && releasable && (
            <button
              type="button"
              onClick={async () => {
                await onRelease(viewerId)
                setOpen(false)
              }}
              className="w-full border-t border-line px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              Hand it back to the group
            </button>
          )}
        </div>
      )}
    </div>
  )
}
