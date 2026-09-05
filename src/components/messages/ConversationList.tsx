import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import type { ConversationCard, ConversationKind } from '../../lib/types'

const SECTIONS: { kind: ConversationKind; label: string }[] = [
  { kind: 'class', label: 'Classes' },
  { kind: 'group', label: 'Groups' },
  { kind: 'direct', label: 'Direct' },
]

function ago(iso: string | null) {
  if (!iso) return ''
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ConversationList({
  conversations,
  activeId,
  linkBase,
  action,
}: {
  conversations: ConversationCard[]
  activeId?: string
  linkBase: string
  /** "New message" button for professors. */
  action?: React.ReactNode
}) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.subtitle.toLowerCase().includes(q) ||
        (c.last_body ?? '').toLowerCase().includes(q),
    )
  }, [conversations, query])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2>Inbox</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {conversations.length}{' '}
              {conversations.length === 1 ? 'conversation' : 'conversations'}
            </p>
          </div>
          {action}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="h-10 w-full rounded-xl border border-[var(--control-line)] bg-[var(--surface)] pr-3 pl-9 text-[14px] text-ink placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {conversations.length === 0
              ? 'Chats appear here as you join classes and groups.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          SECTIONS.map(({ kind, label }) => {
            const rows = filtered.filter((c) => c.kind === kind)
            if (rows.length === 0) return null
            return (
              <section key={kind}>
                <p className="px-4 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
                  {label}
                </p>
                <ul className="space-y-1 px-2">
                  {rows.map((c) => {
                    const active = c.id === activeId
                    return (
                      <li key={c.id}>
                        <Link
                          to={`${linkBase}/${c.id}`}
                          className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                            active
                              ? 'bg-navy-50 text-navy-800 dark:bg-navy-500/20 dark:text-navy-100'
                              : 'hover:bg-[var(--surface-sunken)]'
                          }`}
                        >
                          {c.counterpart ? (
                            <Avatar profile={c.counterpart} size={38} />
                          ) : (
                            <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-400 dark:bg-navy-500">
                              <Icon name={kind === 'class' ? 'board' : 'users'} size={18} />
                            </span>
                          )}

                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span
                                className={`truncate text-[14px] ${
                                  c.unread_count > 0 ? 'font-semibold text-ink' : 'text-ink'
                                }`}
                              >
                                {c.title}
                              </span>
                              <span className="shrink-0 text-[12px] text-faint">{ago(c.last_at)}</span>
                            </span>
                            <span className="mt-0.5 flex items-center justify-between gap-2">
                              <span className="truncate text-[12px] text-muted">
                                {c.last_body || c.subtitle}
                              </span>
                              {c.unread_count > 0 && (
                                <Badge tone="accent" numeric className="shrink-0">
                                  {c.unread_count > 99 ? '99+' : c.unread_count}
                                </Badge>
                              )}
                            </span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
