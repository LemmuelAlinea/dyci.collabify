import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import type {
  ActivityRow,
  CommitRow,
  PeopleRow,
  ReviewRow,
  ScopeRow,
  TaskRow,
  TimeLogRow,
} from '../../../lib/api/generalReports'
import type { ReportConfig } from '../../../lib/general/reportConfig'
import { describeActivity } from '../../../lib/general/history'
import type { Totals } from '../../../lib/general/reportData'
import { contributionScores, SCORE_PARTS, scoreFormula } from '../../../lib/general/reportScore'
import type { Forecast } from '../../../lib/general/forecast'
import { DonutChart } from './charts/DonutChart'
import { REVIEW, STATUS, day, hours, moment, time } from './format'
import { LineChart } from './charts/LineChart'
import type { LinePoint } from './charts/LineChart'
import { ProgressBar } from './charts/ProgressBar'
import { StackedBar } from './charts/StackedBar'

/* ---------------------------------------------------------------- shared */


/** A report section: anchor, heading on a hairline, and its state. */
export function Section({
  id,
  title,
  loading,
  error,
  onRetry,
  empty,
  emptyText,
  children,
  aside,
}: {
  id: string
  title: string
  loading?: boolean
  error?: string
  onRetry?: () => void
  empty?: boolean
  emptyText: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section id={id} className="report-section scroll-mt-24 border-t border-line pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[20px] leading-7 font-semibold text-ink print:text-[14pt]">{title}</h2>
        {aside && <div className="print:hidden">{aside}</div>}
      </div>
      {error ? (
        <Alert tone="error" onRetry={onRetry}>
          Could not load {title.toLowerCase()}. {error}
        </Alert>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`}>
          <div className="h-4 w-2/3 rounded surface-sunken motion-safe:animate-pulse" />
          <div className="h-4 w-1/2 rounded surface-sunken motion-safe:animate-pulse" />
          <div className="h-24 rounded surface-sunken motion-safe:animate-pulse" />
        </div>
      ) : empty ? (
        <p className="text-[14px] text-muted">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  )
}

/** A header cell that sorts on screen and prints as plain text. */
function SortHead({
  label,
  active,
  dir,
  onSort,
}: {
  label: string
  active: boolean
  dir: 1 | -1
  onSort: () => void
}) {
  return (
    <>
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 hover:text-ink print:hidden"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active && <span aria-hidden>{dir === 1 ? '▲' : '▼'}</span>}
      </button>
      <span className="hidden print:inline">{label}</span>
    </>
  )
}

type Col<T> = { key: string; label: string; value: (r: T) => string | number; render?: (r: T) => ReactNode; numeric?: boolean }

/** A sortable table in the report's table style. */
function SortTable<T>({ cols, rows, initial, rowKey }: { cols: Col<T>[]; rows: T[]; initial: string; rowKey: (r: T) => string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 })
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]
    return [...rows].sort((a, b) => {
      const x = col.value(a)
      const y = col.value(b)
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return cmp * sort.dir
    })
  }, [rows, cols, sort])
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] print:text-[9pt]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                className={`eyebrow border-b border-line-strong pr-3 pb-1.5 text-[11px] !tracking-[0.04em] font-medium whitespace-nowrap text-muted last:pr-0 print:text-[8pt] ${c.numeric ? 'text-right' : 'text-left'}`}
              >
                <SortHead
                  label={c.label}
                  active={sort.key === c.key}
                  dir={sort.dir}
                  onSort={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="align-top">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`border-b border-line py-1.5 pr-3 text-ink last:pr-0 ${c.numeric ? 'text-right font-mono tabular-nums' : ''}`}
                >
                  {c.render ? c.render(r) : c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --------------------------------------------------------------- summary */

function Delta({ now, before, invert = false }: { now: number; before?: number; invert?: boolean }) {
  if (before === undefined) return null
  const d = Math.round((now - before) * 10) / 10
  if (d === 0) return <span className="font-mono text-[12px] text-faint">= same</span>
  const good = invert ? d < 0 : d > 0
  return (
    <span className={`font-mono text-[12px] ${good ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d)}
      <span className="sr-only"> compared with the previous period</span>
    </span>
  )
}

export function Kpis({ totals, previous }: { totals: Totals; previous?: Totals }) {
  const pct = (t: Totals) => (t.tasks_total ? Math.round((t.done / t.tasks_total) * 100) : 0)
  const items: { label: string; value: string; now: number; before?: number; invert?: boolean }[] = [
    { label: 'Tasks done', value: `${totals.done} of ${totals.tasks_total}`, now: totals.done, before: previous?.done },
    { label: 'Progress', value: `${pct(totals)}%`, now: pct(totals), before: previous ? pct(previous) : undefined },
    { label: 'Finished in range', value: `${totals.done_in_range}`, now: totals.done_in_range, before: previous?.done_in_range },
    { label: 'Overdue', value: `${totals.overdue_now}`, now: totals.overdue_now, before: previous?.overdue_now, invert: true },
    { label: 'Hours logged', value: hours(totals.minutes_in_range), now: Number(hours(totals.minutes_in_range)), before: previous ? Number(hours(previous.minutes_in_range)) : undefined },
    { label: 'Commits', value: `${totals.commits_in_range}`, now: totals.commits_in_range, before: previous?.commits_in_range },
    { label: 'Reviews merged', value: `${totals.reviews_applied}`, now: totals.reviews_applied, before: previous?.reviews_applied },
  ]
  return (
    <dl className="report-kpis grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="border-l-2 border-line pl-3">
          <dt className="text-[12px] text-muted">{k.label}</dt>
          <dd className="font-display text-[28px] leading-tight text-ink tabular-nums print:text-[18pt]">{k.value}</dd>
          <dd>
            <Delta now={k.now} before={k.before} invert={k.invert} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Narrative({ lines, note, noteBy }: { lines: string[]; note?: string; noteBy: string }) {
  return (
    <div className="max-w-[72ch] space-y-3 text-[14px] leading-[22px] text-ink print:text-[10pt]">
      <p>{lines.join(' ')}</p>
      {note && (
        <blockquote className="border-l-2 border-amber-400 pl-4 whitespace-pre-wrap text-ink">
          {note}
          <footer className="mt-1 text-[12px] text-muted">— {noteBy}</footer>
        </blockquote>
      )}
    </div>
  )
}

export function Progress({
  points,
  previous,
  todayDay,
  endDay,
  usingPoints,
}: {
  points: LinePoint[]
  previous?: LinePoint[]
  todayDay: string
  endDay: string | null
  usingPoints: boolean
}) {
  return (
    <div>
      <LineChart points={points} previous={previous} todayDay={todayDay} endDay={endDay} title="Share of work done, per day" />
      <p className="mt-2 text-[12px] text-faint print:text-[8pt]">
        Per cent of {usingPoints ? 'points' : 'tasks'} done at the end of each day.
        {previous && previous.length > 0 ? ' The dashed line is the previous period over the same number of days.' : ''}
      </p>
    </div>
  )
}

export function Status({ totals }: { totals: Totals }) {
  return (
    <div>
      <DonutChart
        title="Tasks by status"
        slices={[
          { label: 'Done', value: totals.done, className: 'stroke-emerald-500', dot: 'bg-emerald-500' },
          { label: 'In progress', value: totals.in_progress, className: 'stroke-amber-400', dot: 'bg-amber-400' },
          { label: 'To do', value: totals.todo, className: 'stroke-[var(--line-strong)]', dot: 'bg-[var(--line-strong)]' },
        ]}
      />
      <p className="mt-3 text-[13px] text-ink">
        <span className="font-medium text-red-600 dark:text-red-400">Overdue: {totals.overdue_now}</span>
        <span className="text-muted"> — open tasks past their due date, counted within To do and In progress.</span>
      </p>
    </div>
  )
}

const FORECAST_TEXT = (f: Forecast) => {
  const d = (iso: string | null) => (iso ? day(iso) : '')
  switch (f.state) {
    case 'no_tasks':
      return 'There are no tasks to forecast.'
    case 'not_started':
      return 'No task has been finished yet, so there is no pace to forecast from.'
    case 'finished':
      return 'Every task is done.'
    case 'no_end_date':
      return `At ${f.rate} tasks a week, the open work finishes by ${d(f.finishesOn)}. There is no end date to compare with.`
    case 'on_track':
      return `At ${f.rate} tasks a week, the open work finishes by ${d(f.finishesOn)}, before the end date.`
    case 'overrunning':
      return `At ${f.rate} tasks a week, the open work runs ${f.overrunDays} days past the end date, finishing ${d(f.finishesOn)}.`
  }
}

export function ForecastBlock({ forecast }: { forecast: Forecast | null }) {
  return (
    <p className="max-w-[72ch] text-[14px] leading-[22px] text-ink">
      {forecast ? FORECAST_TEXT(forecast) : 'No tasks were finished in this range, so there is no pace to forecast from.'}
      <span className="mt-1 block text-[12px] text-faint">Measured from this range&apos;s pace. It is a projection, not a promise.</span>
    </p>
  )
}

/* ---------------------------------------------------------- comparison */

export type ComparisonRow = {
  project: ScopeRow
  totals: Totals
  lastActivity: string | null
}

export function ProjectComparison({ rows }: { rows: ComparisonRow[] }) {
  return (
    <SortTable
      rowKey={(r) => r.project.project_id}
      initial="progress"
      rows={rows}
      cols={[
        { key: 'name', label: 'Project', value: (r) => r.project.name, render: (r) => (
          <span>
            {r.project.name}
            {r.project.archived && <span className="ml-1.5 text-[11px] text-faint">(archived)</span>}
          </span>
        ) },
        {
          key: 'progress',
          label: 'Progress',
          value: (r) => (r.totals.tasks_total ? r.totals.done / r.totals.tasks_total : 0),
          render: (r) => <ProgressBar value={r.totals.tasks_total ? (r.totals.done / r.totals.tasks_total) * 100 : 0} />,
        },
        { key: 'done', label: 'Done', numeric: true, value: (r) => r.totals.done, render: (r) => `${r.totals.done}/${r.totals.tasks_total}` },
        { key: 'overdue', label: 'Overdue', numeric: true, value: (r) => r.totals.overdue_now },
        { key: 'hours', label: 'Hours', numeric: true, value: (r) => Number(hours(r.totals.minutes_in_range)) },
        { key: 'people', label: 'Active', numeric: true, value: (r) => r.totals.members_active },
        { key: 'commits', label: 'Commits', numeric: true, value: (r) => r.totals.commits_in_range },
        { key: 'last', label: 'Last activity', value: (r) => r.lastActivity ?? '', render: (r) => day(r.lastActivity) || '—' },
      ]}
    />
  )
}

/* -------------------------------------------------------------- people */

export function People({
  rows,
  withPoints,
  score,
}: {
  rows: PeopleRow[]
  withPoints: boolean
  score: ReportConfig['score'] | null
}) {
  const scored = useMemo(
    () =>
      score
        ? contributionScores(
            rows.map((r) => ({
              user_id: r.user_id,
              name: r.name,
              points_finished: Number(r.points_finished),
              minutes_logged: r.minutes_logged,
              commits: r.commits,
              reviews_done: r.reviews_done,
              comments: r.comments,
            })),
            score.weights,
          )
        : null,
    [rows, score],
  )
  const scoreOf = new Map(scored?.rows.map((r) => [r.user_id, r]) ?? [])
  const max = Math.max(1, ...rows.map((r) => r.tasks_finished_in_range + r.tasks_held_now))
  const name = (r: PeopleRow) => r.name ?? 'Somebody'

  const cols: Col<PeopleRow>[] = [
    { key: 'name', label: 'Person', value: name, render: (r) => (
      <span className="block min-w-[9rem]">
        <span className="font-medium whitespace-nowrap">{name(r)}</span>
        {r.level && <span className="block text-[11px] text-faint">{r.level[0].toUpperCase() + r.level.slice(1)}{r.teams.length ? ` · ${r.teams.join(', ')}` : ''}</span>}
        <span className="mt-1.5 block">
          <StackedBar
            max={max}
            parts={[
              { label: 'finished on time', value: r.tasks_finished_in_range - r.tasks_finished_late, tone: 'done' },
              { label: 'finished late', value: r.tasks_finished_late, tone: 'late' },
              { label: 'still open', value: r.tasks_held_now, tone: 'progress' },
            ]}
          />
        </span>
      </span>
    ) },
    { key: 'held', label: 'Held', numeric: true, value: (r) => r.tasks_held_now },
    { key: 'finished', label: 'Finished', numeric: true, value: (r) => r.tasks_finished_in_range },
    { key: 'late', label: 'Late', numeric: true, value: (r) => r.tasks_finished_late },
    ...(withPoints ? [{ key: 'points', label: 'Points', numeric: true, value: (r: PeopleRow) => Number(r.points_finished) }] : []),
    { key: 'hours', label: 'Hours', numeric: true, value: (r) => Number(hours(r.minutes_logged)) },
    { key: 'comments', label: 'Comments', numeric: true, value: (r) => r.comments },
    { key: 'commits', label: 'Commits', numeric: true, value: (r) => r.commits },
    { key: 'reviews', label: 'Reviews', numeric: true, value: (r) => r.reviews_done },
    ...(scored
      ? [{
          key: 'score',
          label: 'Score',
          numeric: true,
          value: (r: PeopleRow) => scoreOf.get(r.user_id)?.score ?? 0,
          render: (r: PeopleRow) => {
            const s = scoreOf.get(r.user_id)
            if (!s) return '—'
            return (
              <span title={SCORE_PARTS.map((p) => `${p.label} ${Math.round(s.shares[p.id] * 100)}%`).join(', ')}>
                {s.score}
                <span className="block text-[11px] text-faint">
                  {SCORE_PARTS.filter((p) => scored.applied[p.id] > 0).map((p) => `${Math.round(s.shares[p.id] * 100)}`).join(' · ')}
                </span>
              </span>
            )
          },
        }]
      : []),
  ]

  return (
    <div>
      <SortTable rows={rows} cols={cols} initial={scored ? 'score' : 'finished'} rowKey={(r) => r.user_id} />
      <p className="mt-2 text-[12px] text-faint print:text-[8pt]">
        The bar under each name: finished on time, finished late (after the due date), still open. First and last activity are in the CSV. “Finished” counts tasks a person holds that were completed in this range.
      </p>
      {scored && (
        <p className="mt-1 text-[12px] text-faint print:text-[8pt]">
          {scoreFormula(scored.applied)} The small figures under each score are that person&apos;s shares, in per cent, in the same order.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ activity */

export function Activity({
  rows,
  total,
  groupBy,
  projectName,
  onMore,
  moreLoading,
}: {
  rows: ActivityRow[]
  total: number
  groupBy: ReportConfig['groupActivityBy']
  projectName: (id: string) => string
  onMore?: () => void
  moreLoading?: boolean
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ActivityRow[]>()
    for (const r of rows) {
      const key =
        groupBy === 'person' ? r.actor_name ?? 'Somebody' : groupBy === 'project' ? projectName(r.project_id) : day(r.at)
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return [...map.entries()]
  }, [rows, groupBy, projectName])

  return (
    <div className="space-y-5">
      {groups.map(([label, items]) => (
        <div key={label} className="break-inside-avoid">
          <h3 className="mb-2 text-[15px] font-medium text-ink print:text-[11pt]">{label}</h3>
          <ol className="space-y-1.5">
            {items.map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-start gap-3 text-[13px] print:text-[9pt]">
                <span className="w-16 shrink-0 pt-0.5 font-mono text-[12px] text-faint tabular-nums">
                  {groupBy === 'day' ? time(r.at) : day(r.at)}
                </span>
                <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full surface-sunken text-[10px] font-semibold text-muted">
                  {(r.actor_name ?? '?')[0]}
                </span>
                <span className="min-w-0 flex-1 text-ink">{describeActivity(r)}</span>
                {groupBy !== 'project' && (
                  <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">{projectName(r.project_id)}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <p className="text-[12px] text-faint">
        Showing the latest {rows.length} of {total} {total === 1 ? 'event' : 'events'}.
      </p>
      {onMore && rows.length < total && (
        <Button variant="outline" size="sm" loading={moreLoading} onClick={onMore} className="print:hidden">
          Load more
        </Button>
      )}
    </div>
  )
}

/** The report's plain table: eyebrow headers, numbers right-aligned in mono. */
function ReportTable({ headers, rows, align = [] }: { headers: string[]; rows: ReactNode[][]; align?: number[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] print:text-[9pt]">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={`eyebrow border-b border-line-strong pr-3 pb-1.5 text-[11px] !tracking-[0.04em] font-medium whitespace-nowrap text-muted last:pr-0 print:text-[8pt] ${align.includes(i) ? 'text-right' : 'text-left'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className={`border-b border-line py-1.5 pr-3 text-ink last:pr-0 ${align.includes(j) ? 'text-right font-mono tabular-nums' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------- details */

export function Tasks({ rows, withPoints }: { rows: TaskRow[]; withPoints: boolean }) {
  const truncated = rows.some((r) => r.truncated)
  return (
    <div>
      <ReportTable
        headers={['Task', 'Status', 'Held by', 'Due', 'Finished', ...(withPoints ? ['Points'] : []), 'Hours', 'Comments', 'Files']}
        align={withPoints ? [5, 6, 7, 8] : [5, 6, 7]}
        rows={rows.map((r) => [
          <span key="t">
            {r.title}
            {r.late && <span className="ml-1.5 font-medium text-red-600 dark:text-red-400">Late</span>}
            {r.archived && <span className="ml-1.5 text-[11px] text-faint">(archived)</span>}
            {r.team && <span className="block text-[11px] text-faint">{r.team}</span>}
          </span>,
          STATUS[r.status] ?? r.status,
          r.holders.length ? r.holders.join(', ') + (r.holder_count > r.holders.length ? ` and ${r.holder_count - r.holders.length} more` : '') : r.holder_count ? `${r.holder_count} ${r.holder_count === 1 ? 'person' : 'people'}` : 'Nobody',
          day(r.due_at) || '—',
          day(r.completed_at) || '—',
          ...(withPoints ? [String(r.weight)] : []),
          hours(r.minutes_in_range),
          String(r.comments),
          String(r.files),
        ])}
      />
      {truncated && <p className="mt-2 text-[12px] text-faint">Showing the first 2,000 tasks. Narrow the range or the projects to see the rest.</p>}
    </div>
  )
}

export function TimeLogs({ rows }: { rows: TimeLogRow[] }) {
  const total = rows.reduce((s, r) => s + r.minutes, 0)
  return (
    <div>
      <ReportTable
        headers={['Day', 'Person', 'Task', 'Hours', 'Note']}
        align={[3]}
        rows={rows.map((r) => [day(r.logged_on + 'T12:00:00'), r.user_name ?? 'Somebody', r.task_title, hours(r.minutes), r.note])}
      />
      <p className="mt-2 text-right font-mono text-[12px] text-muted">Total {hours(total)} hours</p>
    </div>
  )
}

export function Commits({ rows }: { rows: CommitRow[] }) {
  return (
    <ReportTable
      headers={['#', 'When', 'Author', 'Message', 'Added', 'Changed', 'Removed', 'From review']}
      align={[0, 4, 5, 6]}
      rows={rows.map((r) => [
        String(r.seq),
        <span key="w" className="whitespace-nowrap">{moment(r.at)}</span>,
        r.author ?? 'Somebody',
        r.message,
        String(r.added),
        String(r.changed),
        String(r.removed),
        r.change_title ? `${r.change_title}${r.reviewer ? ` (${r.reviewer})` : ''}` : '—',
      ])}
    />
  )
}

export function Reviews({ rows }: { rows: ReviewRow[] }) {
  return (
    <ReportTable
      headers={['Request', 'Author', 'Reviewer', 'Status', 'Opened', 'Decided', 'Files', 'Comments', 'Hours open']}
      align={[6, 7, 8]}
      rows={rows.map((r) => [
        r.title,
        r.author ?? 'Somebody',
        r.reviewer ?? '—',
        REVIEW[r.status] ?? r.status,
        day(r.opened_at),
        r.decided_at ? `${day(r.decided_at)}${r.decided_by ? ` · ${r.decided_by}` : ''}` : '—',
        String(r.files),
        String(r.comments),
        String(r.hours_open),
      ])}
    />
  )
}
