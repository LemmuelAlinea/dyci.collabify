import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { formatDue, isOverdue } from '../../lib/general/dates'
import { TASK_STATUSES, formatMinutes, taskStatusLabel } from '../../lib/types'
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
  /** Opens the task over this page; without it the task opens on its project. */
  onOpen?: () => void
  href?: string
  /** The next stage, for tasks this page can move. */
  next?: { label: string; icon: IconName; run: () => void }
}

const COLUMN_TONE: Record<TaskStatus, string> = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
}

const STATUS_TONE: Record<TaskStatus, string> = {
  todo: 'bg-pending-soft text-pending-ink',
  in_progress: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  done: 'bg-success-500/15 text-success-700 dark:text-success-300',
}

const byDue = (a: MyTaskItem, b: MyTaskItem) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')

function Title({ item, className }: { item: MyTaskItem; className: string }) {
  const tone = item.status === 'done' ? 'text-muted line-through' : 'text-ink'
  if (item.onOpen) {
    return (
      <button
        type="button"
        onClick={item.onOpen}
        className={`${className} ${tone} text-left hover:underline`}
      >
        {item.title}
      </button>
    )
  }
  return (
    <Link to={item.href ?? '#'} className={`${className} ${tone} hover:underline`}>
      {item.title}
    </Link>
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
}: {
  items: MyTaskItem[]
  showDone: boolean
  now: number
}) {
  const stages = TASK_STATUSES.filter((s) => showDone || s.value !== 'done')
  return (
    <div className={`grid gap-4 ${stages.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2'}`}>
      {stages.map((s) => {
        const column = items.filter((t) => t.status === s.value).sort(byDue)
        return (
          <section key={s.value} className="min-w-0 space-y-3">
            <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
              <h2 className={`text-[15px] font-semibold ${COLUMN_TONE[s.value]}`}>{s.label}</h2>
              <span className="font-mono text-[12px] text-faint">{column.length}</span>
            </header>
            {column.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-faint">
                Nothing here
              </p>
            ) : (
              column.map((t) => {
                const late = isOverdue(t.due_at, t.status, now)
                return (
                  <article
                    key={t.key}
                    className="rounded-xl border border-line surface p-3.5 shadow-card transition-colors hover:border-line-strong"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Title item={t} className="block min-w-0 text-[14px] leading-snug font-medium" />
                      <KindTag kind={t.kind} />
                    </div>
                    <p className="mt-1 truncate text-[12px] text-muted">{t.where}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-faint">
                        <span className={`font-mono ${late ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                          {late ? 'Overdue' : t.due_at ? formatDue(t.due_at) : 'No due date'}
                        </span>
                        <Counts item={t} />
                      </span>
                      {t.next && <NextButton next={t.next} />}
                    </div>
                  </article>
                )
              })
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Every task in one table, soonest due first. */
export function MyTaskList({ items, now }: { items: MyTaskItem[]; now: number }) {
  const rows = [...items].sort(byDue)
  return (
    <>
      {/* Phones get a row per task; the table's columns would scroll out of sight. */}
      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-card border border-line surface shadow-card sm:hidden">
        {rows.map((t) => {
          const late = isOverdue(t.due_at, t.status, now)
          return (
            <li key={t.key} className="px-4 py-3.5">
              <Title item={t} className="block w-full truncate text-[14px] font-medium" />
              <p className="mt-0.5 truncate text-[12px] text-muted">{t.where}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12px] text-faint">
                <span className={`rounded-lg px-2 py-0.5 font-mono ${STATUS_TONE[t.status]}`}>
                  {taskStatusLabel(t.status)}
                </span>
                <span className={`font-mono ${late ? 'text-danger-600 dark:text-danger-400' : ''}`}>
                  {t.due_at ? formatDue(t.due_at) : 'No due date'}
                </span>
                <KindTag kind={t.kind} />
                <Counts item={t} />
                {t.next && (
                  <span className="ml-auto">
                    <NextButton next={t.next} />
                  </span>
                )}
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
                      <Counts item={t} />
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate py-2.5 pr-3 text-[13px] text-muted">{t.where}</td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`rounded-lg px-2 py-0.5 font-mono text-[12px] whitespace-nowrap ${STATUS_TONE[t.status]}`}
                    >
                      {taskStatusLabel(t.status)}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 pr-3 font-mono text-[12px] whitespace-nowrap ${
                      late ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
                    }`}
                  >
                    {t.due_at ? formatDue(t.due_at) : '—'}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="flex justify-end">{t.next && <NextButton next={t.next} />}</span>
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
