import { GapList } from '../../../../components/analytics/GapList'
import { PaceCard } from '../../../../components/analytics/PaceCard'
import { PressureChart } from '../../../../components/analytics/PressureChart'
import { UnmeasuredList } from '../../../../components/analytics/UnmeasuredList'
import { Burnup } from '../../../../components/charts/Burnup'
import { Sparkline } from '../../../../components/charts/Sparkline'
import { WeekBars } from '../../../../components/charts/WeekBars'
import { EmptyState } from '../../../../components/ui/EmptyState'
import {
  activeByWeek,
  burnupSeries,
  completionByWeek,
  lastWeeks,
  manilaDay,
  onTimeByWeek,
  weeklyActivity,
} from '../../../../lib/analyticsMath'
import type { AnalyticsData } from '../useAnalytics'
import { classWindow, termsOf } from '../window'
import { Section } from './Section'

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 100))

function Kpi({
  label,
  value,
  trend,
  trendLabel,
}: {
  label: string
  value: string
  trend?: (number | null)[]
  trendLabel?: string
}) {
  return (
    <div className="card flex items-end justify-between gap-3 px-4 py-3 shadow-card">
      <div className="min-w-0">
        <p className="font-mono text-[22px] leading-none text-ink">{value}</p>
        <p className="mt-1.5 text-[12px] text-muted">{label}</p>
      </div>
      {trend && trendLabel && <Sparkline values={trend} label={trendLabel} />}
    </div>
  )
}

export function ClassView({ data }: { data: AnalyticsData }) {
  const today = manilaDay(new Date())
  const { from, to, end } = classWindow(data, today)
  const tasks = data.shownTasks
  const weeks = lastWeeks(today, 8)
  const students = new Set(data.shownRoster.map((r) => r.student_id))

  const completion = completionByWeek(tasks, weeks)
  const onTime = onTimeByWeek(tasks, weeks)
  const active = activeByWeek(data.shownActivity, students, weeks)

  const done = tasks.filter((t) => t.status === 'done')
  const onTimeNow = pct(done.filter((t) => !t.late).length, done.length)
  const completionNow = pct(done.length, tasks.length)

  const hasTerm = termsOf(data).size > 0
  const burn = burnupSeries(tasks, from, to)
  const weekly = weeklyActivity(data.shownActivity, from, to)
  const hasActivity = weekly.some((w) => w.work + w.talk > 0)
  const span = (xs: (number | null)[]) => {
    const n = xs.filter((x): x is number => x !== null)
    return n.length ? `from ${n[0]} to ${n[n.length - 1]}` : 'no data yet'
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Tasks done"
          value={completionNow === null ? '—' : `${completionNow}%`}
          trend={completion}
          trendLabel={`Per cent done over the last 8 weeks, ${span(completion)}`}
        />
        <Kpi
          label="Finished on time"
          value={onTimeNow === null ? '—' : `${onTimeNow}%`}
          trend={onTime}
          trendLabel={`Per cent finished on time each week, ${span(onTime)}`}
        />
        <Kpi
          label="Students active this week"
          value={`${active[active.length - 1]} of ${students.size}`}
          trend={active}
          trendLabel={`Active students per week, ${span(active)}`}
        />
        <Kpi label="Need attention" value={String(data.actions.length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Work against time"
          subtitle={
            hasTerm
              ? "All tasks and finished tasks each day. The dashed line is the even pace that finishes today's tasks by the end of term."
              : 'All tasks and finished tasks each day. Set term dates on the class to see the pace that finishes on time.'
          }
        >
          {burn.length > 1 && tasks.length > 0 ? (
            <Burnup points={burn} endDay={hasTerm ? end : null} title="Tasks and finished tasks over the term" />
          ) : (
            <EmptyState icon="chart" title="No history yet" body="This fills in day by day once the term starts and tasks are added." />
          )}
        </Section>

        <Section
          title="Weekly activity"
          subtitle="Claims, starts and finishes, with comments and files on top. A quiet week shows here before it shows in the grades."
        >
          {hasActivity ? (
            <WeekBars rows={weekly} title="Activity per week" />
          ) : (
            <EmptyState icon="chart" title="No activity recorded yet" body="Charts fill in as students claim and finish tasks." />
          )}
        </Section>
      </div>

      {!data.narrowedBelowClass && data.shownPace.length > 0 && (
        <Section title="Syllabus pace" subtitle="Weeks with a project set against them, beside the weeks that have gone by.">
          <div className="space-y-5">
            {data.shownPace.map((p) => (
              <div key={p.class_id} className="space-y-3">
                <div className="space-y-1.5">
                  {[
                    { label: 'Covered', value: p.weeks_covered, of: Math.max(1, p.weeks_total), cls: 'bg-navy-600 dark:bg-navy-300' },
                    { label: 'Elapsed', value: p.weeks_elapsed, of: Math.max(1, p.weeks_in_term), cls: 'bg-amber-400' },
                  ].map((b) => (
                    <div key={b.label} className="flex items-center gap-3 text-[12px]">
                      <span className="w-16 shrink-0 text-muted">{b.label}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full surface-sunken">
                        <span
                          className={`block h-full rounded-full ${b.cls}`}
                          style={{ width: `${Math.min(100, (b.value / b.of) * 100)}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-faint">
                        {b.value} of {b.of}
                      </span>
                    </div>
                  ))}
                </div>
                <PaceCard pace={p} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {!data.narrowedBelowClass && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="What falls due next" subtitle="Open work by the week it is due, for the next four weeks.">
            <PressureChart rows={data.shownPressure} />
          </Section>
          <Section title="Weeks with nothing set" subtitle="Syllabus weeks that ask for an assessment but have no project against them.">
            <GapList gaps={data.shownGaps} />
          </Section>
        </div>
      )}

      {!data.narrowedBelowClass && <UnmeasuredList rows={data.shownUnmeasured} />}
    </div>
  )
}
