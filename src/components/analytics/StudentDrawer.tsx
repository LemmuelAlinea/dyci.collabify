import { NudgeButton } from '../projects/NudgeButton'
import { LaneTimeline } from '../charts/LaneTimeline'
import type { Lane } from '../charts/LaneTimeline'
import { TONE_CELL } from '../charts/format'
import { WeekBars } from '../charts/WeekBars'
import { Modal } from '../ui/Modal'
import { useNow } from '../../hooks/useNow'
import { addDays, manilaDay, weeklyActivity } from '../../lib/analyticsMath'
import { classWindow } from '../../pages/app/analytics/window'
import type { AnalyticsData } from '../../pages/app/analytics/useAnalytics'
import { FLAG_META } from './flags'
import type { RosterEntry } from './flags'

const SHOWN_TASKS = 12

/** One student, all the evidence, one click from a reminder. */
export function StudentDrawer({
  entry,
  data,
  onClose,
  onOpenTask,
}: {
  entry: RosterEntry | null
  data: AnalyticsData
  onClose: () => void
  onOpenTask: (id: string) => void
}) {
  const now = useNow()
  if (!entry) return null
  const today = manilaDay(new Date(now))
  const { from } = classWindow(data, today)
  const mine = data.shownActivity.filter((a) => a.actor_id === entry.student_id)
  const weekly = weeklyActivity(mine, from, today)
  const tasks = data.shownTasks
    .filter((t) => t.assignee_ids.includes(entry.student_id))
    .sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))
    .slice(0, SHOWN_TASKS)
  const mainBoard = data.shownMembers
    .filter((m) => m.student_id === entry.student_id)
    .sort((a, b) => b.task_count - a.task_count)[0]

  const lanes: Lane[] = tasks.map((t) => {
    const start = manilaDay(t.started_at ?? t.created_at)
    const end = t.done_at && t.status === 'done' ? manilaDay(t.done_at) : today
    const due = t.due_at ? manilaDay(t.due_at) : null
    const overdue = t.status !== 'done' && due !== null && due < today
    return {
      key: t.task_id,
      label: t.title,
      sub: t.group_name ?? t.project_title,
      bar: { from: start, to: end < start ? start : end, tone: t.late || overdue ? 'late' : t.status === 'done' ? 'done' : 'open' },
      marks: due
        ? [{ key: 'due', day: due, label: 'Due', state: t.late || overdue ? 'late' : t.status === 'done' ? 'met' : 'upcoming' }]
        : [],
    }
  })
  const laneFrom = lanes.reduce((min, l) => (l.bar && l.bar.from < min ? l.bar.from : min), today)
  const laneTo = [today, ...lanes.flatMap((l) => l.marks.map((m) => m.day))].sort().at(-1) ?? today

  return (
    <Modal open onClose={onClose} title={entry.student_name} size="lg">
      <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Finished', `${entry.done} of ${entry.held}`],
            ['Late', String(entry.late)],
            ['Logged', `${(entry.worklog_minutes / 60).toFixed(1)}h`],
            ['Comments', String(entry.comments)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl surface-sunken px-3 py-2">
              <dt className="text-[12px] text-muted">{k}</dt>
              <dd className="font-mono text-[18px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        {entry.flags.length > 0 && (
          <p className="flex flex-wrap gap-1.5">
            {entry.flags.map((f) => (
              <span key={f} className={`rounded-md px-2 py-0.5 text-[12px] ${TONE_CELL[FLAG_META[f].tone]}`}>
                {FLAG_META[f].word(entry)}
              </span>
            ))}
          </p>
        )}

        <section className="space-y-2">
          <h4 className="text-ink">Activity by week</h4>
          {weekly.some((w) => w.work + w.talk > 0) ? (
            <WeekBars rows={weekly} title={`${entry.student_name}: activity per week`} />
          ) : (
            <p className="text-[13px] text-muted">No activity recorded for this student yet.</p>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-ink">Recent tasks</h4>
          {lanes.length === 0 ? (
            <p className="text-[13px] text-muted">Holds no tasks.</p>
          ) : (
            <>
              <LaneTimeline lanes={lanes} from={addDays(laneFrom, -1)} to={addDays(laneTo, 1)} today={today} title={`${entry.student_name}: tasks from start to finish`} />
              <ul className="flex flex-wrap gap-1.5">
                {tasks.map((t) => (
                  <li key={t.task_id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(t.task_id)}
                      className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {mainBoard && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[13px] text-muted">
              Send a reminder to {mainBoard.group_name ?? 'their board'} on {mainBoard.project_title}.
            </p>
            <NudgeButton boardId={mainBoard.board_id} name={mainBoard.group_name ?? 'this board'} />
          </div>
        )}
      </div>
    </Modal>
  )
}
