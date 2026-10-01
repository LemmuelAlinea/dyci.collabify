import { useState } from 'react'
import { TermStrip } from '../dashboard/TermStrip'
import { Icon } from '../ui/Icon'
import type { ClassSummary, ClassWeek } from '../../lib/types'
import { paths } from '../../lib/paths'

const key = (classId: string) => `collabify:this-week:${classId}`

function readOpen(classId: string) {
  try {
    return localStorage.getItem(key(classId)) === 'open'
  } catch {
    return false
  }
}

/**
 * The syllabus week a class is in, on its Overview tab.
 *
 * Closed by default: the announcements are what the tab is for, and the week
 * is a glance somebody opens when they want it. Open, it is the same card the
 * student dashboard shows, with a close button in its corner. Each person's
 * choice is kept per class on their device.
 */
export function ThisWeek({ cls, weeks }: { cls: ClassSummary; weeks: ClassWeek[] }) {
  const [open, setOpen] = useState(() => readOpen(cls.id))
  if (weeks.length === 0) return null

  function toggle(next: boolean) {
    setOpen(next)
    try {
      localStorage.setItem(key(cls.id), next ? 'open' : 'closed')
    } catch {
      // Private windows can refuse storage; the toggle still works for this visit.
    }
  }

  if (!open) {
    const w = weeks[0]
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => toggle(true)}
        className="surface flex max-w-full items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-left text-[13px] shadow-card transition-colors hover:border-line-strong"
      >
        <Icon name="calendar" size={14} className="shrink-0 text-faint" />
        <span className="shrink-0 font-medium text-ink">Week {w.week_no}</span>
        {w.title && <span className="min-w-0 truncate text-muted">{w.title}</span>}
        <Icon name="chevronDown" size={14} className="shrink-0 text-faint" />
      </button>
    )
  }

  return (
    <TermStrip
      weeks={weeks}
      classes={[cls]}
      linkBase={paths.classes}
      hrefFor={(id) => `${paths.class(id)}?tab=syllabus`}
      onClose={() => toggle(false)}
    />
  )
}
