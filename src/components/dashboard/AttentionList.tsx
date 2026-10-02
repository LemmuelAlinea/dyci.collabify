import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { TileEmpty } from './Bento'
import type { Attention } from '../../lib/api/dashboard'

/** Setup and release gaps — things only the professor can clear. Flat rows, for a bento tile. */
export function AttentionList({ items }: { items: Attention[] }) {
  if (items.length === 0) return <TileEmpty>Nothing is waiting on you.</TileEmpty>

  return (
    <ul className="-mx-2 divide-y divide-[var(--line)]">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            to={i.to}
            className="flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
              <Icon name={i.icon} size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{i.title}</span>
              <span className="block text-[12px] leading-snug text-muted">{i.body}</span>
            </span>
            <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
