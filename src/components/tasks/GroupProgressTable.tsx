import { useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { boardOwnerName } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'

type SortId = 'attention' | 'progress' | 'name'

function sortOptions(solo: boolean): { value: SortId; label: string }[] {
  return [
    { value: 'attention', label: 'Needs attention' },
    { value: 'progress', label: 'Furthest along' },
    { value: 'name', label: solo ? 'Student name' : 'Group name' },
  ]
}

const PREVIEW = 8

/** Nothing on the board, or work nobody has taken — the two things to look at. */
function needsAttention(b: BoardSummary) {
  return b.task_count === 0 || b.unclaimed_count > 0
}

function sortBoards(boards: BoardSummary[], sort: SortId) {
  const byName = (a: BoardSummary, b: BoardSummary) =>
    boardOwnerName(a).localeCompare(boardOwnerName(b), 'en', { numeric: true })

  if (sort === 'name') return [...boards].sort(byName)
  if (sort === 'progress')
    return [...boards].sort((a, b) => Number(b.done_pct) - Number(a.done_pct) || byName(a, b))

  // Empty boards first, then the most unclaimed, then the least finished.
  return [...boards].sort(
    (a, b) =>
      Number(a.task_count > 0) - Number(b.task_count > 0) ||
      b.unclaimed_count - a.unclaimed_count ||
      Number(a.done_pct) - Number(b.done_pct) ||
      byName(a, b),
  )
}

/**
 * One tile per board rather than one table row. A class of twenty groups is a
 * wall of rows; as tiles it is five short lines, folded to two until asked.
 *
 * An individual project fills the same grid with one tile per student, since a
 * board is a board — only the words around it change.
 */
export function GroupProgressTable({
  boards,
  activeId,
  solo = false,
  onOpen,
}: {
  boards: BoardSummary[]
  /** The board currently open below, so the tile can say so. */
  activeId?: string | null
  /** An individual project: these are students, not groups. */
  solo?: boolean
  onOpen: (board: BoardSummary) => void
}) {
  const [sort, setSort] = useState<SortId>('attention')
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)

  const sorted = useMemo(() => sortBoards(boards, sort), [boards, sort])
  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sorted.filter((b) => boardOwnerName(b).toLowerCase().includes(q)) : sorted
  }, [sorted, query])

  const shown = all || matched.length <= PREVIEW ? matched : matched.slice(0, PREVIEW)

  const started = boards.filter((b) => b.task_count > 0).length
  const attention = boards.filter(needsAttention).length
  const average = boards.length
    ? Math.round((boards.reduce((n, b) => n + Number(b.done_pct), 0) / boards.length) * 10) / 10
    : 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-[13px] text-muted">
          <strong className="text-ink">{started}</strong> of {boards.length} started ·{' '}
          <strong className="text-ink">{average}%</strong> average
          {attention > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {' · '}
              {attention} need{attention === 1 ? 's' : ''} a look
            </span>
          )}
        </p>

        {boards.length > 4 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={solo ? 'Find a student' : 'Find a group'}
                className="h-9 w-[160px] rounded-lg border border-[var(--line)] bg-[var(--surface)] pr-3 pl-8 text-[13px] text-ink placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:outline-none"
              />
            </div>
            <Select
              aria-label={solo ? 'Sort the students' : 'Sort the groups'}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortId)}
              options={sortOptions(solo)}
              className="!h-9 !w-[170px] !text-[13px]"
            />
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
          {solo ? 'No student matches that.' : 'No group matches that.'}
        </p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => {
            const pct = Number(b.done_pct)
            const open = b.id === activeId
            const empty = b.task_count === 0
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  className={`surface w-full rounded-xl border px-3.5 py-3 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 ${
                    open
                      ? 'border-navy-400 dark:border-navy-300'
                      : empty || b.unclaimed_count > 0
                        ? 'border-amber-300 dark:border-amber-400/40'
                        : 'border-line hover:border-line-strong'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                      {boardOwnerName(b)}
                    </span>
                    <span className="shrink-0 font-mono text-[12px] text-muted">{pct}%</span>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full surface-sunken">
                    <span
                      className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-faint">
                    {empty ? (
                      <span className="text-amber-700 dark:text-amber-300">No tasks yet</span>
                    ) : (
                      <>
                        <span>
                          {b.done_count}/{b.task_count} done
                        </span>
                        {b.doing_count > 0 && <span>{b.doing_count} doing</span>}
                        {b.unclaimed_count > 0 && (
                          <span className="text-amber-700 dark:text-amber-300">
                            {b.unclaimed_count} unclaimed
                          </span>
                        )}
                        {b.late_count > 0 && (
                          <span className="text-red-600 dark:text-red-400">
                            {b.late_count} late
                          </span>
                        )}
                      </>
                    )}
                    {!solo && <span className="ml-auto">{b.member_count} members</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {matched.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          <Icon name={all ? 'chevronDown' : 'chevronRight'} size={14} />
          {all
            ? 'Show fewer'
            : `Show all ${matched.length} ${solo ? 'students' : 'groups'}`}
        </button>
      )}
    </div>
  )
}
