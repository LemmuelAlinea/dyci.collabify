import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { NudgeButton } from '../projects/NudgeButton'
import { paths } from '../../lib/paths'
import type { StalledBoard } from '../../lib/api/dashboard'

/** Cards in view at once; the rest scroll inside the list. */
const VISIBLE = 3

/**
 * The groups a professor cannot spot without opening every board: nothing put
 * on the board at all, or nothing touched in a week.
 */
export function StalledGroups({ boards }: { boards: StalledBoard[] }) {
  const listRef = useRef<HTMLUListElement>(null)
  const [maxHeight, setMaxHeight] = useState<number>()

  // Measured rather than fixed, since a card grows when Remind wraps under it.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || boards.length <= VISIBLE) {
      setMaxHeight(undefined)
      return
    }
    const measure = () => {
      const last = list.children[VISIBLE - 1] as HTMLElement
      const padding = parseFloat(getComputedStyle(list).paddingBottom)
      setMaxHeight(last.offsetTop + last.offsetHeight + padding)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [boards.length])

  if (boards.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        Every group has moved something in the last seven days.
      </p>
    )
  }

  return (
    // Padded so the cards' shadows and focus rings are not clipped by the scroll.
    <ul
      ref={listRef}
      style={{ maxHeight }}
      className="relative -m-1 space-y-2 overflow-y-auto overscroll-contain p-1"
    >
      {boards.map((b) => (
        <li
          key={b.id}
          className="surface relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-warning-300 px-4 py-3 shadow-card transition-colors hover:border-warning-500 dark:border-warning-400/40"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning-400/18 text-warning-700 dark:text-warning-300">
            <Icon name={b.reason === 'empty' ? 'alert' : 'clock'} size={15} />
          </span>

          <span className="min-w-0 flex-1">
            {/* Stretched over the card, so the card stays one click target
                and Remind can sit on top of it. */}
            <Link
              to={paths.classProject(b.project_id)}
              className="block truncate text-[14px] font-medium text-ink after:absolute after:inset-0 after:rounded-xl hover:underline"
            >
              {b.group_name ?? 'One student'}
            </Link>
            <span className="block truncate text-[12px] text-muted">
              {b.project_title}
            </span>
          </span>

          <span className="shrink-0 text-right">
            <span className="block text-[12px] text-warning-700 dark:text-warning-300">
              {b.reason === 'empty'
                ? 'No tasks at all'
                : `Quiet for ${b.days} day${b.days === 1 ? '' : 's'}`}
            </span>
            <span className="block font-mono text-[12px] text-faint">
              {b.done_count}/{b.task_count} done · {Number(b.done_pct)}%
            </span>
          </span>

          <NudgeButton boardId={b.id} name={b.group_name ?? 'this student'} />
        </li>
      ))}
    </ul>
  )
}
