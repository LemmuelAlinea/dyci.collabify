import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { WORK_SECTIONS } from '../../lib/work/nav'
import type { WorkSection } from '../../lib/work/nav'

const LOOK: Record<WorkSection, { label: string; icon: IconName }> = {
  summary: { label: 'Summary', icon: 'chart' },
  backlog: { label: 'Backlog', icon: 'board' },
  sprints: { label: 'Sprints', icon: 'target' },
  tasks: { label: 'Tasks', icon: 'check' },
  milestones: { label: 'Milestones', icon: 'pin' },
}

/**
 * The sections inside Work. A level above the task layouts, so it is drawn
 * filled navy rather than as another grey pill switch, and it scrolls sideways
 * on a phone instead of wrapping onto a second line.
 */
export function WorkNav({ active, onChange }: { active: WorkSection; onChange: (s: WorkSection) => void }) {
  return (
    <nav aria-label="Work sections" className="-mx-1 overflow-x-auto px-1 pb-1">
      <div className="inline-flex gap-1 rounded-xl border border-line surface p-1 shadow-card">
        {WORK_SECTIONS.map((id) => {
          const on = active === id
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onChange(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] whitespace-nowrap transition-colors ${
                on
                  ? 'bg-navy-600 font-medium text-white dark:bg-navy-500'
                  : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
              }`}
            >
              <Icon name={LOOK[id].icon} size={15} />
              {LOOK[id].label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
