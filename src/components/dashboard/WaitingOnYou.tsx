import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { TileEmpty } from './Bento'
import { paths } from '../../lib/paths'

type Item = { icon: IconName; label: string; to: string; count: number }

/**
 * Things that sit still until somebody acts. Always a tile, so the bento stays
 * square; with nothing waiting it says so in one line.
 */
export function WaitingOnYou({
  unclaimed,
  unread,
  openSets,
}: {
  unclaimed: number
  unread: number
  openSets: number
}) {
  const items: Item[] = ([
    {
      icon: 'check',
      label: unclaimed === 1 ? 'task nobody has taken' : 'tasks nobody has taken',
      to: paths.tasks,
      count: unclaimed,
    },
    {
      icon: 'message',
      label: unread === 1 ? 'unread message' : 'unread messages',
      to: paths.inbox,
      count: unread,
    },
    {
      icon: 'users',
      label: openSets === 1 ? 'group set open to join' : 'group sets open to join',
      to: paths.groups,
      count: openSets,
    },
  ] as Item[]).filter((i) => i.count > 0)

  if (items.length === 0) return <TileEmpty>Nothing is waiting on you.</TileEmpty>

  return (
    <ul className="-mx-2 divide-y divide-[var(--line)]">
      {items.map((i) => (
        <li key={i.label}>
          <Link
            to={i.to}
            className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-warning-400/18 text-warning-700 dark:text-warning-300">
              <Icon name={i.icon} size={14} />
            </span>
            <span className="font-mono text-[17px] leading-none text-ink">{i.count}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{i.label}</span>
            <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
