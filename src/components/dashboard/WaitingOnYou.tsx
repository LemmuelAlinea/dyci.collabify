import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

type Item = { icon: IconName; label: string; to: string; count: number }

/** Things that sit still until somebody acts. Nothing to do means nothing shown. */
export function WaitingOnYou({
  unclaimed,
  unread,
  openSets,
  stacked = false,
}: {
  unclaimed: number
  unread: number
  openSets: number
  /** One per row, for the narrow column beside a dashboard's main content. */
  stacked?: boolean
}) {
  const items: Item[] = ([
    {
      icon: 'check',
      label: unclaimed === 1 ? 'task nobody has taken' : 'tasks nobody has taken',
      to: '/student/tasks',
      count: unclaimed,
    },
    {
      icon: 'message',
      label: unread === 1 ? 'unread message' : 'unread messages',
      to: '/student/messages',
      count: unread,
    },
    {
      icon: 'users',
      label: openSets === 1 ? 'group set open to join' : 'group sets open to join',
      to: '/student/groups',
      count: openSets,
    },
  ] as Item[]).filter((i) => i.count > 0)

  if (items.length === 0) return null

  return (
    <div className={`grid gap-3 ${stacked ? '' : 'sm:grid-cols-3'}`}>
      {items.map((i) => (
        <Link
          key={i.label}
          to={i.to}
          className="surface flex items-center gap-3 rounded-card border border-amber-300 px-4 py-3.5 shadow-card transition-colors duration-250 hover:border-line-strong dark:border-amber-400/40"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-400/18 text-amber-700 dark:text-amber-300">
            <Icon name={i.icon} size={17} />
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-[17px] leading-none text-ink">{i.count}</span>
            <span className="mt-1 block text-[12px] leading-snug text-muted">{i.label}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
