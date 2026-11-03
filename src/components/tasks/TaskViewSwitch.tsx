import { Icon } from '../ui/Icon'
import { ActionMenu } from '../ui/ActionMenu'
import { TaskFilters } from './TaskFilters'
import type { TaskFilterState } from './taskFilterState'
import type { ProjectTaskRow } from '../../lib/api/tasks'
import type { BoardSummary } from '../../lib/types'
import { TASK_LAYOUTS } from '../../lib/work/nav'
import type { TaskLayout } from '../../lib/work/nav'

export type TaskView = TaskLayout

const ICON = { board: 'kanban', list: 'board', timeline: 'clock', calendar: 'calendar' } as const

/**
 * The four ways of looking at the same tasks, and the count beside them.
 *
 * The count is what keeps the filter honest: a filtered list that says nothing
 * about being filtered reads as "there is no work here" rather than "you are
 * hiding some of it".
 */
export function TaskViewSwitch({
  view,
  onView,
  shown,
  total,
}: {
  view: TaskView
  onView: (v: TaskView) => void
  shown: number
  total: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="surface-sunken flex max-w-full gap-1 overflow-x-auto rounded-lg p-0.5">
        {TASK_LAYOUTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => onView(v)}
            className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
              view === v ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon name={ICON[v]} size={15} />
            {v}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-faint">
        {shown === total
          ? `${total} ${total === 1 ? 'task' : 'tasks'}`
          : `${shown} of ${total} tasks`}
      </p>
    </div>
  )
}

/** The same four views folded into one icon, for a toolbar that has no room for the tabs. */
export function TaskViewMenu({ view, onView }: { view: TaskView; onView: (v: TaskView) => void }) {
  return (
    <ActionMenu
      label={`View: ${view[0].toUpperCase()}${view.slice(1)}`}
      icon="layoutGrid"
      align="start"
      triggerClassName="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line surface text-muted transition-colors hover:border-line-strong hover:text-ink"
      items={TASK_LAYOUTS.map((v) => ({
        label: `${v[0].toUpperCase()}${v.slice(1)}`,
        icon: ICON[v],
        checked: view === v,
        onSelect: () => onView(v),
      }))}
    />
  )
}

/** The filter row, which is nothing at all when there is nothing to filter. */
export function TaskFilterBar({
  filters,
  onChange,
  scope,
  boards,
  showBoards,
}: {
  filters: TaskFilterState
  onChange: (f: TaskFilterState) => void
  scope: ProjectTaskRow[]
  boards: BoardSummary[]
  showBoards: boolean
}) {
  if (scope.length === 0) return null
  return (
    <TaskFilters
      value={filters}
      onChange={onChange}
      rows={scope}
      boards={boards}
      showBoards={showBoards}
    />
  )
}
