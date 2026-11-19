import { Icon, Spinner } from '../ui/Icon'
import type { Mentionable } from '../../lib/api/mentions'
import { isTaskKind } from '../../lib/mentions'

/**
 * The list `#` opens above the message box: tasks and projects the writer is
 * on, the chat's own place first. The composer owns the keys (↑ ↓ Enter Tab
 * Esc); a row picks on mousedown so the box keeps its focus and caret.
 */
export function MentionPicker({
  items,
  active,
  loading,
  onPick,
  onHover,
}: {
  items: Mentionable[]
  active: number
  loading: boolean
  onPick: (item: Mentionable) => void
  onHover: (index: number) => void
}) {
  return (
    <div className="surface absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border border-line shadow-lg">
      <p className="eyebrow border-b border-line px-3 py-2 text-faint">Mention a task or project</p>
      {items.length === 0 ? (
        loading ? (
          <div role="status" className="flex items-center gap-2 px-3 py-3 text-[13px] text-muted">
            <Spinner size={14} />
            Searching…
          </div>
        ) : (
          <p className="px-3 py-3 text-[13px] text-muted">No tasks or projects match</p>
        )
      ) : (
        <ul role="listbox" aria-label="Tasks and projects" className="max-h-72 overflow-y-auto py-1">
          {items.map((m, i) => (
            <li
              key={`${m.kind}:${m.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(m)
              }}
              onMouseEnter={() => onHover(i)}
              className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 ${
                i === active ? 'bg-navy-50 dark:bg-navy-500/20' : ''
              }`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--surface-sunken)] text-muted">
                <Icon name={isTaskKind(m.kind) ? 'check' : 'kanban'} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{m.title}</span>
                {isTaskKind(m.kind) && (
                  <span className="block truncate text-[12px] text-muted">{m.project_title}</span>
                )}
              </span>
              <span className="shrink-0 text-[11px] text-faint">{isTaskKind(m.kind) ? 'Task' : 'Project'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
