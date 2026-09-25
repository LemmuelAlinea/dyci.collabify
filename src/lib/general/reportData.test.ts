import { describe, expect, it } from 'vitest'
import { mergePeople, rangeForecast, reportCsvName, seriesPercent, sumSummary } from './reportData'

describe('report shaping', () => {
  it('sums projects into one set of totals', () => {
    const row = (id: string, done: number, total: number) => ({
      project_id: id, tasks_total: total, todo: 0, in_progress: 0, done, done_in_range: 0,
      created_in_range: 0, overdue_now: 0, due_in_range: 0, points_total: 0, points_done: 0,
      minutes_in_range: 30, comments_in_range: 0, files_in_range: 0, commits_in_range: 0,
      reviews_opened: 0, reviews_applied: 0, reviews_declined: 0, members_active: 1,
    })
    const t = sumSummary([row('a', 2, 4), row('b', 1, 6)])
    expect([t.done, t.tasks_total, t.minutes_in_range]).toEqual([3, 10, 60])
  })

  it('turns per-project days into one percentage per day', () => {
    const s = seriesPercent([
      { project_id: 'a', day: '2026-09-01', done_count: 1, total_count: 2, done_points: 0, total_points: 0 },
      { project_id: 'b', day: '2026-09-01', done_count: 0, total_count: 2, done_points: 0, total_points: 0 },
    ])
    expect(s).toEqual([{ day: '2026-09-01', value: 25, done: 1, total: 4 }])
  })

  it('merges a person across projects', () => {
    const p = (project: string, minutes: number, last: string) => ({
      project_id: project, user_id: 'u', name: 'Ana', level: 'member', teams: [project],
      tasks_held_now: 1, tasks_finished_in_range: 1, tasks_finished_late: 0, points_finished: 1,
      minutes_logged: minutes, comments: 0, files_uploaded: 0, commits: 0, files_changed: 0,
      reviews_requested: 0, reviews_done: 0, reviews_applied_as_author: 0,
      first_activity: last, last_activity: last,
    })
    const [m] = mergePeople([p('a', 30, '2026-09-02'), p('b', 45, '2026-09-05')])
    expect(m.minutes_logged).toBe(75)
    expect(m.teams).toEqual(['a', 'b'])
    expect([m.first_activity, m.last_activity]).toEqual(['2026-09-02', '2026-09-05'])
  })

  it('forecasts from the range pace', () => {
    const now = new Date(2026, 8, 10).getTime()
    const series = [
      { day: '2026-09-01', done: 0, total: 10 },
      { day: '2026-09-10', done: 9, total: 10 },
    ]
    expect(rangeForecast(series, '2026-12-31', now)?.state).toBe('on_track')
    expect(rangeForecast(series, '2026-09-09', now)?.state).toBe('overrunning')
    expect(rangeForecast([{ day: '2026-09-01', done: 10, total: 10 }], null, now)?.state).toBe('finished')
  })

  it('names CSV files the documented way', () => {
    expect(reportCsvName('Student Council', 'Café Week', 'Who did what', '2026-09-01', '2026-09-30')).toBe(
      'collabify-student-council-cafe-week-who-did-what-2026-09-01_2026-09-30.csv',
    )
  })
})
