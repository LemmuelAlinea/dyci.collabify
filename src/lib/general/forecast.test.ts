import { describe, expect, it } from 'vitest'
import { projectForecast } from './forecast'
import type { ForecastTask } from './forecast'

const DAY = 86_400_000
const NOW = new Date('2026-10-29T00:00:00Z').getTime()
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

const done = (days: number): ForecastTask => ({ status: 'done', completed_at: ago(days) })
const open = (): ForecastTask => ({ status: 'todo', completed_at: null })

describe('projectForecast', () => {
  it('has nothing to say about a project with no tasks', () => {
    const f = projectForecast([], '2026-12-01', NOW)
    expect(f.state).toBe('no_tasks')
    expect(f.total).toBe(0)
  })

  it('calls a project nobody has started its own thing, not a rate of zero', () => {
    const f = projectForecast([open(), open()], '2026-12-01', NOW)
    expect(f.state).toBe('not_started')
    expect(f.rate).toBe(0)
    expect(f.finishesOn).toBeNull()
  })

  it('knows when everything is done', () => {
    const f = projectForecast([done(3), done(1)], '2026-12-01', NOW)
    expect(f.state).toBe('finished')
    expect(f.done).toBe(2)
    expect(f.total).toBe(2)
  })

  it('still projects a finish with no end date, and says the date is missing', () => {
    const f = projectForecast([done(14), done(7), open(), open()], null, NOW)
    expect(f.state).toBe('no_end_date')
    expect(f.rate).toBeGreaterThan(0)
    expect(f.finishesOn).not.toBeNull()
    expect(f.overrunDays).toBe(0)
  })

  it('says a project is on track when the work fits', () => {
    // Two finished in the last fortnight, two left: about two more weeks.
    const f = projectForecast([done(14), done(7), open(), open()], '2026-12-31', NOW)
    expect(f.state).toBe('on_track')
    expect(f.overrunDays).toBe(0)
    expect(f.daysLeft).toBeGreaterThan(0)
  })

  it('says by how many days a project will overrun', () => {
    const f = projectForecast([done(14), done(7), open(), open()], '2026-11-01', NOW)
    expect(f.state).toBe('overrunning')
    expect(f.overrunDays).toBeGreaterThan(0)
  })

  it('does not divide by zero when the only task finished today', () => {
    const f = projectForecast([done(0), open()], '2026-12-01', NOW)
    expect(Number.isFinite(f.rate)).toBe(true)
    expect(f.rate).toBeGreaterThan(0)
    expect(f.finishesOn).not.toBeNull()
  })

  it('treats a done task with no completion date as done, not as progress', () => {
    const f = projectForecast(
      [{ status: 'done', completed_at: null }, open()],
      '2026-12-01',
      NOW,
    )
    expect(f.done).toBe(2 - 1)
    expect(f.state).toBe('not_started')
  })

  it('reports an end date already past as an overrun', () => {
    const f = projectForecast([done(14), open()], '2026-10-01', NOW)
    expect(f.state).toBe('overrunning')
    expect(f.overrunDays).toBeGreaterThan(0)
  })

  it('counts every done task, whatever its completion date', () => {
    const f = projectForecast([done(20), done(2), open()], '2026-12-01', NOW)
    expect(f.done).toBe(2)
    expect(f.total).toBe(3)
  })

  it('rounds the rate to one decimal so it reads as a sentence', () => {
    const f = projectForecast([done(7), done(7), done(7), open()], '2026-12-01', NOW)
    expect(f.rate).toBe(Math.round(f.rate * 10) / 10)
  })
})
