import { Avatar } from '../app/Avatar'
import { Spinner } from '../ui/Icon'
import { useNow } from '../../hooks/useNow'
import type { ActiveContact } from '../../lib/api/presence'
import { isActiveNow, seenLabel } from '../../lib/presence'
import { fullName } from '../../lib/types'

/**
 * The people you share a class, space or project with who are online, newest
 * first. A dot means active now; "12m" means seen that long ago.
 */
export function ActiveNowStrip({
  contacts,
  onOpen,
  busyId,
}: {
  contacts: ActiveContact[]
  onOpen: (id: string) => void
  busyId: string | null
}) {
  const now = useNow()
  if (contacts.length === 0) return null

  return (
    <section className="border-b border-line px-4 pt-3 pb-2.5">
      <p className="eyebrow text-faint">Active now</p>
      <ul className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-1">
        {contacts.map((c) => {
          const label = seenLabel(c.last_seen_at, now)
          const name = fullName(c)
          const busy = busyId === c.id
          return (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                disabled={busy}
                aria-label={`${name}, ${label ? `active ${label} ago` : 'active now'}`}
                title={name}
                className="flex w-[60px] flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-70"
              >
                <span className="relative">
                  <Avatar profile={c} size={44} />
                  {busy && (
                    <span className="absolute inset-0 grid place-items-center rounded-full bg-[var(--surface)]/70">
                      <Spinner size={16} />
                    </span>
                  )}
                  {isActiveNow(c.last_seen_at, now) && (
                    <span
                      data-presence-dot
                      aria-hidden
                      className="absolute right-0 bottom-0 h-3 w-3 rounded-full bg-presence ring-2 ring-[var(--surface)]"
                    />
                  )}
                </span>
                <span className="w-full truncate text-center text-[12px] text-muted">{c.first_name}</span>
                {label && <span className="-mt-1 font-mono text-[10px] text-faint">{label}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
