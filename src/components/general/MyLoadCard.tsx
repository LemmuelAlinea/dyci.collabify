import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BentoTile } from '../dashboard/Bento'
import {
  estimateAccuracy,
  myTimer,
  spacePeopleHours,
  spacePeopleLoad,
  type RunningTimer,
} from '../../lib/api/workload'
import { paths } from '../../lib/paths'
import { plural } from '../../lib/plural'
import { formatDayLabel, formatHours, workWeek } from '../../lib/work/hours'
import { LOAD_BAR, loadTone } from '../../lib/work/loadTone'

const WEEKS = 4
const DAY = 86_400_000

type Week = { from: string; to: string }
type WeekLoad = { load: number; available: number | null; weekly: number | null; own: number | null; unestimated: number }
type SpaceLoad = { weeks: WeekLoad[]; ratio: number | null }

function shift(week: Week, weeks: number): Week {
  const move = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + weeks * 7 * DAY).toISOString().slice(0, 10)
  return { from: move(week.from), to: move(week.to) }
}

const bare = (minutes: number) => formatHours(minutes).replace(/ h$/, '')

async function readSpace(spaceId: string, userId: string, weeks: Week[]): Promise<SpaceLoad> {
  const [rows, accuracy] = await Promise.all([
    Promise.all(weeks.map(async (w) => {
      const [load, hours] = await Promise.all([
        spacePeopleLoad(spaceId, w.from, w.to, [userId]),
        spacePeopleHours(spaceId, w.from, w.to, [userId]),
      ])
      const mine = load.filter((l) => l.user_id === userId)
      const h = hours.find((x) => x.user_id === userId)
      return {
        load: mine.reduce((n, l) => n + l.load_minutes, 0),
        unestimated: mine.reduce((n, l) => n + l.unestimated, 0),
        available: h?.available_minutes ?? null,
        weekly: h?.weekly_minutes ?? null,
        own: h?.own_weekly_minutes ?? null,
      }
    })),
    // Accuracy is extra: a failed read only hides its line.
    estimateAccuracy(spaceId, [userId]).catch(() => []),
  ])
  return { weeks: rows, ratio: accuracy.find((a) => a.user_id === userId)?.ratio ?? null }
}

function Bar({ week, tall }: { week: WeekLoad; tall?: boolean }) {
  const tone = loadTone(week.load, week.available)
  const used = week.available == null ? 0 : Math.min(week.load / Math.max(week.available, 1), 1) * 100
  return (
    <div className={`relative overflow-hidden rounded-full surface-sunken ${tall ? 'h-2.5' : 'h-1.5'}`}>
      <div
        data-tone={tone}
        className={`absolute inset-y-0 left-0 rounded-full ${LOAD_BAR[tone]} motion-safe:transition-[width]`}
        style={{ width: week.available == null ? '100%' : `${used}%` }}
      />
    </div>
  )
}

function SpaceBlock({
  space,
  weeks,
  data,
}: {
  space: { id: string; name: string }
  weeks: Week[]
  data: SpaceLoad | 'error' | undefined
}) {
  const now = data && data !== 'error' ? data.weeks[0] : null
  return (
    <div data-load-space={space.id} className="min-w-0 space-y-3 rounded-xl border border-line p-3.5">
      <Link to={paths.spaceWorkload(space.id)} className="block truncate text-[14px] font-medium text-ink hover:text-navy-600">
        {space.name}
      </Link>
      {data === 'error' ? (
        <p className="text-[13px] text-muted">Could not load your hours here. Reload the page to try again.</p>
      ) : !data || !now ? (
        <p className="text-[13px] text-faint">Loading your hours…</p>
      ) : (
        <>
          <div data-load-week="0" className="space-y-1">
            <Bar week={now} tall />
            <p className={`font-mono text-[12px] ${loadTone(now.load, now.available) === 'danger' ? 'text-danger-700 dark:text-danger-300' : 'text-muted'}`}>
              {bare(now.load)} / {bare(now.available ?? 0)} h this week
            </p>
            {now.own == null && now.weekly != null && (
              <p className="text-[12px] text-muted">Weekly hours: {formatHours(now.weekly)} · space default</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {data.weeks.slice(1).map((w, i) => (
              <div key={weeks[i + 1].from} data-load-week={i + 1} className="min-w-0 space-y-1">
                <Bar week={w} />
                <p className="truncate font-mono text-[11px] text-faint">{formatDayLabel(weeks[i + 1].from).replace(/^\w+ /, '')}</p>
              </div>
            ))}
          </div>
          {now.unestimated > 0 && (
            <p className="text-[12px] text-muted">
              {now.unestimated} {plural(now.unestimated, 'task this week has', 'tasks this week have')} no estimate
            </p>
          )}
          {data.ratio != null && (
            <p className="text-[12px] text-muted">Your tasks usually take about {data.ratio}× the estimate.</p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Home's My load: for each work space the person is in, this week's load against
 * their available hours and the next three weeks (noting when they are on the
 * space's default hours), and a way to add time off. Reads once per space per visit.
 */
export function MyLoadCard({ spaces, userId }: { spaces: { id: string; name: string }[]; userId: string }) {
  const weeks = useMemo(() => {
    const first = workWeek()
    return Array.from({ length: WEEKS }, (_, i) => shift(first, i))
  }, [])
  const [data, setData] = useState<Map<string, SpaceLoad | 'error'>>(new Map())
  const [timer, setTimer] = useState<RunningTimer | null>(null)
  const key = spaces.map((s) => s.id).join(',')

  const loadSpace = useCallback((spaceId: string) => {
    readSpace(spaceId, userId, weeks)
      .then((d) => setData((prev) => new Map(prev).set(spaceId, d)))
      .catch(() => setData((prev) => new Map(prev).set(spaceId, 'error')))
  }, [userId, weeks])

  useEffect(() => {
    if (!key) return
    for (const id of key.split(',')) loadSpace(id)
    myTimer().then(setTimer).catch(() => setTimer(null))
  }, [key, loadSpace])

  if (spaces.length === 0) return null

  return (
    <BentoTile icon="clock" title="My load">
      <div className="mt-3 space-y-3">
        {timer && (
          <Link
            to={`${paths.project(timer.project_id)}?task=${timer.task_id}`}
            className="block truncate text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
          >
            Timer running on {timer.title}
          </Link>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {spaces.map((s) => (
            <SpaceBlock key={s.id} space={s} weeks={weeks} data={data.get(s.id)} />
          ))}
        </div>
        <Link to={`${paths.settings}#time-off`} className="inline-block text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200">
          Add time off
        </Link>
      </div>
    </BentoTile>
  )
}
