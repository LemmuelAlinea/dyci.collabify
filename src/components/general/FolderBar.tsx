import type { ReactNode } from 'react'
import { crumbs } from '../../lib/general/files'
import { Icon } from '../ui/Icon'

export function FolderBar({
  rootLabel,
  path,
  onNavigate,
  actions,
}: {
  rootLabel: string
  path: string
  onNavigate: (path: string) => void
  actions?: ReactNode
}) {
  const trail = crumbs(path)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
        <button
          type="button"
          onClick={() => onNavigate('')}
          aria-current={trail.length === 0 ? 'page' : undefined}
          className={trail.length === 0 ? 'font-medium text-ink' : 'text-muted hover:text-ink hover:underline'}
        >
          {rootLabel}
        </button>
        {trail.map((c, i) => (
          <span key={c.path} className="flex min-w-0 items-center gap-1">
            <Icon name="chevronRight" size={13} className="shrink-0 text-faint" />
            {i === trail.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-ink">{c.name}</span>
            ) : (
              <button type="button" onClick={() => onNavigate(c.path)} className="truncate text-muted hover:text-ink hover:underline">
                {c.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}
