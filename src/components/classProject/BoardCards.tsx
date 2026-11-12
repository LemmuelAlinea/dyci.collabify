import { useMemo } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { ProjectTaskRow } from '../../lib/api/tasks'
import { boardStage } from '../../lib/classProjectNav'
import { paths } from '../../lib/paths'
import { boardOwnerName } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'

/**
 * One card per group (or per student on an individual project): how far it is,
 * the stage its open work sits in, and what needs a look. Each card links to
 * that board's page; a plain click goes through `onOpen`, so the page decides
 * how to get there, and a modified click still opens a new tab.
 */
export function BoardCards({
  boards,
  rows,
  stages,
  solo,
  onOpen,
}: {
  boards: BoardSummary[]
  rows: ProjectTaskRow[]
  stages: readonly string[]
  /** An individual project: these are students, not groups. */
  solo: boolean
  onOpen: (b: BoardSummary) => void
}) {
  const byBoard = useMemo(() => {
    const map = new Map<string, ProjectTaskRow[]>()
    for (const r of rows) {
      const list = map.get(r.board_id)
      if (list) list.push(r)
      else map.set(r.board_id, [r])
    }
    return map
  }, [rows])

  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {boards.map((b) => {
        const pct = Number(b.done_pct)
        const stage = boardStage(byBoard.get(b.id) ?? [], stages)
        const open = (e: MouseEvent) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          onOpen(b)
        }
        return (
          <li key={b.id}>
            <Link
              to={paths.classProjectBoard(b.project_id, b.id)}
              onClick={open}
              className="surface hover-safe block h-full rounded-xl border border-line px-4 py-3.5 transition-[border-color,transform] duration-200 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-400"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                  {boardOwnerName(b)}
                </span>
                {!solo && (
                  <span className="shrink-0 text-[12px] text-faint">{b.member_count} members</span>
                )}
              </div>

              <div
                className="mt-2.5 h-1.5 overflow-hidden rounded-full surface-sunken"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={`${boardOwnerName(b)} is ${pct}% done`}
              >
                <span
                  className="block h-full rounded-full bg-progress transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-2 text-[12px] text-muted">
                <span className="font-mono">{pct}%</span> · {stage ?? 'No tasks yet'}
              </p>

              <BoardFlags board={b} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function BoardFlags({ board }: { board: BoardSummary }) {
  const handedIn = Boolean(board.submitted_at) && !board.result_verdict
  const accepted = board.result_verdict === 'accepted'
  const returned = board.result_verdict === 'returned'
  const late = board.late_count > 0
  if (!handedIn && !accepted && !returned && !late) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {handedIn && (
        <Chip className="bg-warning-400/18 text-warning-700 dark:text-warning-300">Handed in</Chip>
      )}
      {accepted && (
        <Chip className="bg-success-500/15 text-success-700 dark:text-success-300">Accepted</Chip>
      )}
      {returned && (
        <Chip className="bg-danger-500/12 text-danger-600 dark:text-danger-400">Returned</Chip>
      )}
      {late && (
        <Chip className="bg-danger-500/12 text-danger-600 dark:text-danger-400">
          {board.late_count} late
        </Chip>
      )}
    </div>
  )
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>
  )
}
