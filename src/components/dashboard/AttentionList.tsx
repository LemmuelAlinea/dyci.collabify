import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { Attention } from '../../lib/api/dashboard'

/** Setup and release gaps — things only the professor can clear. */
export function AttentionList({ items }: { items: Attention[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
        Nothing is waiting on you.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.id}>
          <Link
            to={i.to}
            className="surface flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 shadow-card transition-colors hover:border-line-strong sm:gap-3 sm:px-4 sm:py-3"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
              <Icon name={i.icon} size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink sm:text-[14.5px]">
                {i.title}
              </span>
              <span className="block text-[12.5px] leading-snug text-muted">{i.body}</span>
            </span>
            <Icon name="chevronRight" size={15} className="mt-1 shrink-0 text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
