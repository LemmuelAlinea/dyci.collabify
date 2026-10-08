import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { formatDue, isOverdue } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import {
  COLUMN_WIDTH,
  SCALE_LABEL,
  buildChart,
  dataRange,
  defaultMonth,
  defaultScale,
  groupRows,
  monthKey,
  monthLabel,
  monthsIn,
  nowMarker,
  placeBand,
  placeMark,
  placeTask,
} from '../../lib/work/timeline'
import type { Band, Mark, Scale, TimelineTask } from '../../lib/work/timeline'

const BAR = {
  todo: 'bg-navy-500/40',
  in_progress: 'bg-warning-400/75',
  done: 'bg-success-500/65',
} as const

const SCALES: Scale[] = ['month', 'week', 'day']
const SCALE_KEY = 'collabify:timeline-scale'

function storedScale(): Scale | null {
  try {
    const v = localStorage.getItem(SCALE_KEY)
    return v === 'month' || v === 'week' || v === 'day' ? v : null
  } catch {
    return null
  }
}

function storeScale(scale: Scale) {
  try {
    localStorage.setItem(SCALE_KEY, scale)
  } catch {
    // A blocked store only means the choice is not remembered.
  }
}

const stageLabel = (status: TimelineTask['status']) =>
  (TASK_STATUSES.find((s) => s.value === status)?.label ?? status).toLowerCase()

/** What a tooltip and a screen reader both get for a task, in words. */
function taskLabel(task: TimelineTask) {
  const when =
    task.starts_at && task.due_at
      ? `${formatDue(task.starts_at)} to ${formatDue(task.due_at)}`
      : task.starts_at
        ? `starts ${formatDue(task.starts_at)}`
        : task.due_at
          ? `due ${formatDue(task.due_at)}`
          : 'no date set'
  const overdue = isOverdue(task.due_at, task.status) ? ', overdue' : ''
  return `${task.title}, ${stageLabel(task.status)}, ${when}${overdue}`
}

function markLabel(mark: Mark) {
  const due = new Date(mark.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `Milestone: ${mark.label}, due ${due}`
}

/** The day a task outside the shown month points to: its start if it has one, else its due. */
const anchorOf = (task: TimelineTask) => new Date((task.starts_at ?? task.due_at)!).getTime()

/** For a caller with no project dates. */
// eslint-disable-next-line react-refresh/only-export-components -- a constant callers pass as `span`, kept beside the component it feeds
export const NO_SPAN = { starts_on: null, ends_on: null } as const

/** One line of the chart: a name cell on the left and its track on the right, the same height. */
type Line = { key: string; height: string; name: ReactNode; track: ReactNode; tone?: 'head' | 'group' }

/**
 * Tasks laid out across time, as a grid of months, weeks or the days of one
 * month. The range, the first scale and the month to open on all come from
 * the work itself (its tasks, sprints and milestones); the person can switch
 * scale (remembered on this device), pick a month in Days, and jump to today.
 *
 * Drawn with CSS offsets rather than a chart library: bars and diamonds are
 * all it needs.
 */
export function TimelineView({
  tasks,
  groups,
  span,
  looseLabel = 'Whole project',
  onOpen,
  bands = [],
  marks = [],
}: {
  tasks: TimelineTask[]
  groups: readonly { id: string; name: string }[]
  /** The project's own dates: used only when no task, sprint or milestone has one. */
  span: { starts_on: string | null; ends_on: string | null }
  looseLabel?: string
  onOpen?: (taskId: string) => void
  /** Sprints, drawn as a row of their own under the dates. */
  bands?: Band[]
  /** Milestones, as diamonds in a row of their own. */
  marks?: Mark[]
}) {
  const range = useMemo(
    () => dataRange(tasks, [...marks.map((m) => m.at), ...bands.flatMap((b) => [b.start, b.end - 1])], span),
    [tasks, marks, bands, span],
  )
  const [picked, setPicked] = useState<Scale | null>(storedScale)
  const [month, setMonth] = useState<string | null>(null)
  // Read once: the chart is not a clock, and render stays pure.
  const [now] = useState(() => Date.now())
  const scroller = useRef<HTMLDivElement>(null)

  const scale = picked ?? (range ? defaultScale(range) : 'week')
  const months = useMemo(() => {
    if (!range) return []
    const list = monthsIn(range)
    const current = monthKey(now)
    return list.includes(current) ? list : [...list, current].sort()
  }, [range, now])
  const shownMonth = month && months.includes(month) ? month : range ? defaultMonth(range, now) : null
  const chart = useMemo(
    () => (range ? buildChart(scale, range, shownMonth ?? undefined, now) : null),
    [range, scale, shownMonth, now],
  )

  // Open on today when the chart shows it, else on the start of the work.
  const [jump, setJump] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !chart) return
    const track = el.scrollWidth - (el.querySelector<HTMLElement>('[data-names]')?.offsetWidth ?? 0)
    const today = nowMarker(chart, now)
    el.scrollLeft = today === null ? 0 : Math.max(0, (today / 100) * track - el.clientWidth / 3)
  }, [chart, jump, now])

  if (!range || !chart) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        No task has a date yet, so there is nothing to lay out. Give a task a start or a due date
        and it appears here.
      </p>
    )
  }

  const rows = groupRows(tasks, groups, looseLabel)
  const width = chart.columns.length * COLUMN_WIDTH[scale]
  const today = nowMarker(chart, now)
  const placedBands = bands.flatMap((band) => {
    const place = placeBand(band, chart)
    return place ? [{ band, place }] : []
  })
  const pinned = marks.flatMap((mark) => {
    const left = placeMark(mark, chart)
    return left === null ? [] : [{ mark, left }]
  })
  const undated = tasks.filter((t) => !t.starts_at && !t.due_at).length
  const monthIndex = shownMonth ? months.indexOf(shownMonth) : -1

  function choose(next: Scale) {
    setPicked(next)
    storeScale(next)
  }

  function goToday() {
    if (scale === 'day') setMonth(monthKey(now))
    setJump((n) => n + 1)
  }

  const lines: Line[] = [
    {
      key: 'groups',
      height: 'h-7',
      tone: 'head',
      name: null,
      track: chart.groups.reduce<{ at: number; nodes: ReactNode[] }>(
        (acc, g) => {
          acc.nodes.push(
            <span
              key={`${g.label}-${acc.at}`}
              className="absolute top-0 bottom-0 truncate border-l border-line px-2 text-[11px] leading-7 font-semibold text-ink first:border-l-0"
              style={{ left: `${(acc.at / chart.columns.length) * 100}%`, width: `${(g.span / chart.columns.length) * 100}%` }}
            >
              {g.label}
            </span>,
          )
          acc.at += g.span
          return acc
        },
        { at: 0, nodes: [] },
      ).nodes,
    },
    {
      key: 'columns',
      height: 'h-10',
      tone: 'head',
      name: <span className="eyebrow">Task</span>,
      track: chart.columns.map((c, i) => (
        <span
          key={c.start}
          className={`absolute top-0 bottom-0 flex flex-col items-center justify-center border-l border-line leading-tight first:border-l-0 ${
            c.today ? 'text-amber-700 dark:text-amber-300' : c.weekend ? 'text-faint' : 'text-muted'
          }`}
          style={{ left: `${(i / chart.columns.length) * 100}%`, width: `${100 / chart.columns.length}%` }}
        >
          <span className={`font-mono text-[11px] ${c.today ? 'font-semibold' : ''}`}>{c.label}</span>
          {c.sub && <span className="font-mono text-[9.5px] text-faint">{c.sub}</span>}
        </span>
      )),
    },
  ]

  if (placedBands.length > 0) {
    lines.push({
      key: 'sprints',
      height: 'h-8',
      name: <span className="eyebrow">Sprints</span>,
      track: placedBands.map(({ band, place }) => (
        <span
          key={band.id}
          title={band.label}
          className="absolute top-1 bottom-1 truncate rounded-md border border-navy-300/60 bg-navy-500/10 px-1.5 text-[11px] leading-5 text-navy-700 dark:border-navy-400/40 dark:text-navy-100"
          style={{ left: `${place.left}%`, width: `${place.width}%` }}
        >
          {band.label}
        </span>
      )),
    })
  }
  if (pinned.length > 0) {
    lines.push({
      key: 'milestones',
      height: 'h-8',
      name: <span className="eyebrow">Milestones</span>,
      track: pinned.map(({ mark, left }) => (
        <span
          key={mark.id}
          role="img"
          aria-label={markLabel(mark)}
          title={markLabel(mark)}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-amber-400 ring-2 ring-[var(--surface)]"
          style={{ left: `${left}%` }}
        />
      )),
    })
  }

  for (const row of rows) {
    lines.push({
      key: `g-${row.group ?? 'loose'}`,
      height: 'h-7',
      tone: 'group',
      name: <span className="truncate text-[11px] font-medium text-faint uppercase">{row.groupName}</span>,
      track: null,
    })
    for (const task of row.tasks) {
      const place = placeTask(task, chart)
      const overdue = isOverdue(task.due_at, task.status) ? 'ring-2 ring-danger-500 dark:ring-danger-400' : ''
      lines.push({
        key: task.id,
        height: 'h-9',
        name: onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            title={task.title}
            className="w-full truncate text-left text-[13px] text-ink hover:underline"
          >
            {task.title}
          </button>
        ) : (
          <span title={task.title} className="truncate text-[13px] text-ink">
            {task.title}
          </span>
        ),
        track:
          place.shape === 'bar' ? (
            <span
              role="img"
              tabIndex={0}
              aria-label={taskLabel(task)}
              title={taskLabel(task)}
              className={`absolute top-1/2 h-4 -translate-y-1/2 ${BAR[task.status]} ${overdue} ${
                place.clippedStart ? 'rounded-l-none' : 'rounded-l-full'
              } ${place.clippedEnd ? 'rounded-r-none' : 'rounded-r-full'}`}
              style={{ left: `${place.left}%`, width: `${place.width}%` }}
            />
          ) : place.shape === 'diamond' ? (
            <span
              role="img"
              tabIndex={0}
              aria-label={taskLabel(task)}
              title={taskLabel(task)}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 ${BAR[task.status]} ${overdue}`}
              style={{ left: `${place.left}%` }}
            />
          ) : place.shape === 'outside' ? (
            // Pinned to the visible edge, so it reads without scrolling; opens that task's month.
            <div className="flex h-full items-center">
              <button
                type="button"
                onClick={() => setMonth(monthKey(anchorOf(task)))}
                title={`${taskLabel(task)}. Show its month.`}
                className={`sticky flex items-center gap-1 px-2 text-[11px] text-faint hover:text-ink ${
                  place.side === 'before' ? 'left-[calc(var(--name-w)+0.25rem)]' : 'right-1 ml-auto'
                }`}
              >
                {place.side === 'before' && <Icon name="chevronLeft" size={12} />}
                {new Date(anchorOf(task)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {place.side === 'after' && <Icon name="chevronRight" size={12} />}
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center">
              <span className="sticky left-[calc(var(--name-w)+0.5rem)] px-2 text-[11px] text-faint">No date yet</span>
            </div>
          ),
      })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Timeline scale" className="flex rounded-lg border border-line p-0.5">
          {SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scale === s}
              onClick={() => choose(s)}
              className={`rounded-md px-3 py-1 text-[13px] transition-colors ${
                scale === s ? 'bg-banner-end font-medium text-banner-end-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {SCALE_LABEL[s]}
            </button>
          ))}
        </div>

        {scale === 'day' && shownMonth && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth(months[monthIndex - 1])}
              disabled={monthIndex <= 0}
              aria-label="Previous month"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-35"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <Select
              value={shownMonth}
              onChange={(e) => setMonth(e.target.value)}
              aria-label="Month to show"
              options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
              className="!h-8 !w-auto !rounded-lg !pr-9 !pl-3 !text-[13px]"
            />
            <button
              type="button"
              onClick={() => setMonth(months[monthIndex + 1])}
              disabled={monthIndex >= months.length - 1}
              aria-label="Next month"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-35"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={goToday}
          className="rounded-lg border border-line px-3 py-1 text-[13px] text-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          Today
        </button>

        <p className="text-[12px] text-faint sm:ml-auto">
          {new Date(range.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} –{' '}
          {new Date(range.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {undated > 0 && ` · ${undated} ${undated === 1 ? 'task has' : 'tasks have'} no date yet`}
        </p>
      </div>

      <div
        ref={scroller}
        className="overflow-x-auto rounded-panel border border-line surface [--name-w:9.5rem] sm:[--name-w:15rem]"
      >
        <div className="flex min-w-full">
          <div data-names className="sticky left-0 z-20 w-[var(--name-w)] shrink-0 border-r border-line surface">
            {lines.map((l) => (
              <div
                key={l.key}
                className={`flex items-center border-b border-line px-3 ${l.height} ${
                  l.tone === 'group' ? 'surface-sunken' : ''
                }`}
              >
                {l.name}
              </div>
            ))}
          </div>

          <div className="relative flex-1" style={{ minWidth: width }}>
            {/* Column lines, weekends and today, behind every row. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {chart.columns.map((c, i) => (
                <span
                  key={c.start}
                  className={`absolute top-0 bottom-0 border-l border-line/70 first:border-l-0 ${
                    c.weekend ? 'surface-sunken' : ''
                  }`}
                  style={{ left: `${(i / chart.columns.length) * 100}%`, width: `${100 / chart.columns.length}%` }}
                />
              ))}
              {today !== null && (
                <span className="absolute top-0 bottom-0 z-10 w-0.5 -translate-x-1/2 bg-amber-400" style={{ left: `${today}%` }} />
              )}
            </div>
            {lines.map((l) => (
              <div
                key={l.key}
                className={`relative border-b border-line ${l.height} ${l.tone === 'group' ? 'surface-sunken' : ''}`}
              >
                {l.track}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        {TASK_STATUSES.map((s) => (
          <span key={s.value} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-6 rounded-full ${BAR[s.value]}`} />
            {s.label.toLowerCase()}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 bg-navy-500/40" />
          one date only
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-6 rounded-full bg-navy-500/40 ring-2 ring-danger-500 dark:ring-danger-400" />
          overdue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-amber-400" />
          today
        </span>
        {pinned.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 bg-amber-400" />
            milestone
          </span>
        )}
      </p>
    </div>
  )
}
