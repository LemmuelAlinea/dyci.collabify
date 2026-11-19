import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { Linkify } from '../ui/Linkify'
import type { ResolvedMention } from '../../lib/api/mentions'
import { isTaskKind, mentionKey, parseMentions } from '../../lib/mentions'

/**
 * A message's text, with its web links clickable and each task or project
 * mention as a chip. A mention this reader can't open is a locked chip with no
 * name; one not looked up yet is a plain "Task" or "Project" chip.
 */
export function MessageText({
  body,
  titles,
  onDark = false,
}: {
  body: string
  titles: Map<string, ResolvedMention>
  /** The sender's own bubble, on the navy fill. */
  onDark?: boolean
}) {
  return (
    <>
      {parseMentions(body).map((seg, i) => {
        if (seg.type === 'text') return <Linkify key={i} text={seg.text} tone="inherit" />
        const task = isTaskKind(seg.ref.kind)
        const found = titles.get(mentionKey(seg.ref))
        if (found?.state === 'open') {
          return (
            <Link
              key={i}
              to={found.href}
              className={`mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[13px] font-medium no-underline transition-colors ${
                onDark
                  ? 'bg-white/15 text-white hover:bg-white/25'
                  : 'bg-navy-50 text-navy-700 hover:bg-navy-100 dark:bg-navy-500/20 dark:text-navy-100 dark:hover:bg-navy-500/30'
              }`}
            >
              <Icon name={task ? 'check' : 'kanban'} size={13} className="shrink-0" />
              <span className="max-w-[40ch] truncate">{found.title}</span>
              {found.archived && <span className={onDark ? 'text-white/70' : 'text-faint'}>· archived</span>}
            </Link>
          )
        }
        // Not looked up yet (or its read failed): a plain chip, neither a title nor a lock.
        if (!found) {
          return (
            <span
              key={i}
              className={`mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[13px] ${
                onDark ? 'bg-white/10 text-white/80' : 'bg-[var(--surface-sunken)] text-muted'
              }`}
            >
              <Icon name={task ? 'check' : 'kanban'} size={12} className="shrink-0" />
              {task ? 'Task' : 'Project'}
            </span>
          )
        }
        const label = task ? "Task you can't open" : "Project you can't open"
        return (
          <span
            key={i}
            aria-label={label}
            className={`mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 align-baseline text-[13px] ${
              onDark ? 'bg-white/10 text-white/80' : 'bg-[var(--surface-sunken)] text-muted'
            }`}
          >
            <Icon name="lock" size={12} className="shrink-0" />
            {label}
          </span>
        )
      })}
    </>
  )
}
