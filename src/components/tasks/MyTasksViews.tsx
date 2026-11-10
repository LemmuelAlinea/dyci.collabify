import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { formatDue, isOverdue } from '../../lib/general/dates'
import type { PrioritySort } from '../../lib/general/taskFilters'
import { comparePriority } from '../../lib/general/taskRules'
import type { TaskPriority } from '../../lib/general/types'
import { PriorityBadge } from '../general/PriorityBadge'
import { BoardColumn, MoveToStage } from './BoardColumn'
import { StageBadge, StageSelect } from './StageSelect'
import { useBoardDrag } from './useBoardDrag'
import { DEFAULT_STAGES } from '../../lib/stages'
import { landingIndex } from '../../lib/work/boardDrop'
import { QA_PASSES } from '../../lib/work/qa'
import { TASK_STATUSES, formatMinutes } from '../../lib/types'
import type { TaskStatus } from '../../lib/types'
import type { MyTasksView } from '../../lib/myTasksView'

const VIEWS: { value: MyTasksView; label: string; icon: IconName }[] = [
  { value: 'urgency', label: 'Urgency', icon: 'clock' },
  { value: 'board', label: 'Board', icon: 'kanban' },
  { value: 'list', label: 'List', icon: 'board' },
]

export function MyTasksViewSwitch({
  value,
  onChange,
}: {
  value: MyTasksView
  onChange: (view: MyTasksView) => void
}) {
  return (
    <div role="group" aria-label="View" className="flex gap-1 rounded-lg surface-sunken p-1">
      {VIEWS.map((v) => (
        <button
          key={v.value}
          type="button"
          aria-pressed={value === v.value}
          onClick={() => onChange(v.value)}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors duration-150 ${
            value === v.value
              ? 'surface font-medium text-ink ring-1 ring-[var(--line)]'
              : 'text-muted hover:text-ink'
          }`}
        >
          <Icon name={v.icon} size={15} />
          {v.label}
        </button>
      ))}
    </div>
  )
}

/** Class and work tasks in one shape, so Board and List treat them the same. */
export type MyTaskItem = {
  key: string
  kind: 'class' | 'work'
  title: string
  where: string
  status: TaskStatus
  due_at: string | null
  /** Share of the grade, class tasks only. */
  share: number
  files: number
  comments: number
  minutes: number
  /** Work tasks only; a class task has none. */
  priority?: TaskPriority
  /** "Part of {parent}", or "Subtask" when the parent is not among the open tasks. */
  partOf?: string
  /** Opens the task over this page. */
  onOpen: () => void
  /** The next stage, for tasks this page can move. */
  next?: { label: string; icon: IconName; run: () => void }
  /** Any stage, for the List's dropdown. */
  onStage?: (to: TaskStatus) => Promise<void>
  /** Done is not offered: getting there crosses the project's QA stage, and QA passes its tasks. */
  noDone?: boolean
  /** The Board's drag: moves the task and says whether it went through. */
  onDrop?: (to: TaskStatus) => Promise<boolean>
  /** Why the database would refuse this task reaching Done, or null. */
  doneRefusal?: string | null
}

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
}

const byDue = (a: MyTaskItem, b: MyTaskItem) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')

/** Soonest due first; with Priority chosen, urgent first and soonest due within each. */
const orderOf = (sort: PrioritySort) =>
  sort === 'priority' ? (a: MyTaskItem, b: MyTaskItem) => comparePriority(a, b) || byDue(a, b) : byDue

/** Where a task sits, with its parent when it is a subtask. */
const whereOf = (t: MyTaskItem) => (t.partOf ? `${t.where} · ${t.partOf}` : t.where)

function Title({ item, className }: { item: MyTaskItem; className: string }) {
  const tone = item.status === 'done' ? 'text-muted line-through' : 'text-ink'
  return (
    <button type="button" data-card-open="" onClick={item.onOpen} className={`${className} ${tone} text-left hover:underline`}>
      {item.title}
    </button>
  )
}

function Counts({ item }: { item: MyTaskItem }) {
  return (
    <>
      {item.share > 0 && <span className="font-mono">{item.share}%</span>}
      {item.files > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="file" size={11} />
          {item.files}
        </span>
      )}
      {item.comments > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="message" size={11} />
          {item.comments}
        </span>
      )}
      {item.minutes > 0 && (
        <span className="flex items-center gap-1">
          <Icon name="clock" size={11} />
          {formatMinutes(item.minutes)}
        </span>
      )}
    </>
  )
}

function KindTag({ kind }: { kind: MyTaskItem['kind'] }) {
  return (
    <span className="rounded-md surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-faint uppercase">
      {kind}
    </span>
  )
}

function NextButton({ next }: { next: NonNullable<MyTaskItem['next']> }) {
  return (
    <button
      type="button"
      onClick={next.run}
      className="flex items-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:border-navy-400 hover:text-navy-600 dark:hover:border-navy-300 dark:hover:text-navy-200"
    >
      <Icon name={next.icon} size={13} />
      {next.label}
    </button>
  )
}

/**
 * A column per stage. Work tasks leave this page once done, so the Done column
 * only shows when class tasks are in view — otherwise it would always be empty.
 */
export function MyTaskBoard({
  items,
  showDone,
  now,
  sort = '',
  onRefused,
}: {
  items: MyTaskItem[]
  showDone: boolean
  now: number
  sort?: PrioritySort
  /** Says why a drop was refused. */
  onRefused?: (reason: string) => void
}) {
  const stages = TASK_STATUSES.filter((s) => showDone || s.value !== 'done')
  const statusAt = (column: number) => TASK_STATUSES[column].value
  const refusalOf = (t: MyTaskItem, column: number) =>
    statusAt(column) === 'done' ? (t.doneRefusal ?? (t.noDone ? QA_PASSES : null)) : null

  const { attach, ...drag } = useBoardDrag({
    refusal: (key, column) => {
      const t = items.find((x) => x.key === key)
      return t ? refusalOf(t, column) : 'That task is no longer on this board.'
    },
    commit: async (key, column) => {
      const t = items.find((x) => x.key === key)
      return t?.onDrop ? t.onDrop(statusAt(column)) : false
    },
    onRefused: (reason) => onRefused?.(reason),
  })

  // While its move is on the way a card reads as already being where it landed.
  const placed = items.map((t) => {
    const column = drag.pendingColumn(t.key)
    return column === undefined ? t : { ...t, status: statusAt(column) }
  })
  const order = [...placed].sort(orderOf(sort)).map((t) => t.key)

  return (
    <div ref={attach} className={`grid gap-4 ${stages.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}>
      {stages.map((s) => {
        const index = TASK_STATUSES.indexOf(s)
        const column = placed.filter((t) => t.status === s.value).sort(orderOf(sort))
        return (
          <BoardColumn
            key={s.value}
            drag={drag}
            column={index}
            slotAt={drag.active ? landingIndex(order, column.map((t) => t.key), drag.active.id) : 0}
            header={
              <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                <h2 className={`text-[15px] font-semibold ${COLUMN_TONE[s.value]}`}>{s.label}</h2>
                <span className="font-mono text-[12px] text-faint">{column.length}</span>
              </header>
            }
            empty={
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-faint">
                Nothing here
              </p>
            }
            cards={column.map((t) => {
              const late = isOverdue(t.due_at, t.status, now)
              const movable = Boolean(t.onDrop) && drag.pendingColumn(t.key) === undefined
              return (
                <article
                  key={t.key}
                  {...drag.cardProps(t.key, index, movable)}
                  className={`relative rounded-xl border border-line surface p-3.5 shadow-card transition-[border-color,opacity] duration-200 hover:border-line-strong ${drag.cardClass(t.key)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Title item={t} className="block min-w-0 text-[14px] leading-snug font-medium" />
                    <span className="flex shrink-0 items-center gap-1">
                      <PriorityBadge priority={t.priority} />
                      <KindTag kind={t.kind} />
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-muted">{whereOf(t)}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-faint">
                      <span className={`font-mono ${late ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                        {late ? 'Overdue' : t.due_at ? formatDue(t.due_at) : 'No due date'}
                      </span>
                      <Counts item={t} />
                    </span>
                    <span className="flex items-center gap-1">
                      {movable && (
                        <MoveToStage
                          title={t.title}
                          options={stages.flatMap((o) => {
                            const value = TASK_STATUSES.indexOf(o)
                            return value !== index && !refusalOf(t, value) ? [{ value, label: o.label }] : []
                          })}
                          onMove={(to) => drag.moveTo(t.key, to)}
                        />
                      )}
                      {t.next && <NextButton next={t.next} />}
                    </span>
                  </div>
                </article>
              )
            })}
          />
        )
      })}
      {drag.layer}
    </div>
  )
}

function Stage({ item }: { item: MyTaskItem }) {
  return item.onStage ? (
    <StageSelect
      status={item.status}
      title={item.title}
      onChange={item.onStage}
      blocked={item.noDone ? (to) => to === DEFAULT_STAGES.length - 1 : undefined}
      blockedReason={QA_PASSES}
    />
  ) : (
    <StageBadge status={item.status} />
  )
}

/** Every task in one table, soonest due first. */
export function MyTaskList({ items, now, sort = '' }: { items: MyTaskItem[]; now: number; sort?: PrioritySort }) {
  const rows = [...items].sort(orderOf(sort))
  return (
    <>
      {/* Phones get a row per task; the table's columns would scroll out of sight. */}
      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-card border border-line surface shadow-card sm:hidden">
        {rows.map((t) => {
          const late = isOverdue(t.due_at, t.status, now)
          return (
            <li key={t.key} className="px-4 py-3.5">
              <Title item={t} className="block w-full truncate text-[14px] font-medium" />
              <p className="mt-0.5 truncate text-[12px] text-muted">{whereOf(t)}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12px] text-faint">
                <Stage item={t} />
                <span className={`font-mono ${late ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                  {t.due_at ? formatDue(t.due_at) : 'No due date'}
                </span>
                <KindTag kind={t.kind} />
                <PriorityBadge priority={t.priority} />
                <Counts item={t} />
              </div>
            </li>
          )
        })}
      </ul>
      <div className="surface hidden overflow-x-auto rounded-card border border-line shadow-card sm:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[12px] tracking-wide text-faint uppercase">
              <th className="py-2.5 pr-3 pl-4 font-medium">Task</th>
              <th className="py-2.5 pr-3 font-medium">Where</th>
              <th className="py-2.5 pr-3 font-medium">Stage</th>
              <th className="py-2.5 pr-3 font-medium">Due</th>
              <th className="py-2.5 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const late = isOverdue(t.due_at, t.status, now)
              return (
                <tr
                  key={t.key}
                  className="border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)]"
                >
                  <td className="py-2.5 pr-3 pl-4">
                    <Title item={t} className="block max-w-[340px] truncate text-[14px] font-medium" />
                    <span className="mt-0.5 flex items-center gap-3 text-[12px] text-faint">
                      <KindTag kind={t.kind} />
                      <PriorityBadge priority={t.priority} />
                      {t.partOf && <span className="max-w-[200px] truncate">{t.partOf}</span>}
                      <Counts item={t} />
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate py-2.5 pr-3 text-[13px] text-muted">{t.where}</td>
                  <td className="py-2.5 pr-3">
                    <Stage item={t} />
                  </td>
                  <td
                    className={`py-2.5 pr-3 font-mono text-[12px] whitespace-nowrap ${
                      late ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
                    }`}
                  >
                    {t.due_at ? formatDue(t.due_at) : '—'}
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <button
                      type="button"
                      onClick={t.onOpen}
                      aria-label={`Open ${t.title}`}
                      className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="chevronRight" size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
