import { describe, expect, it } from 'vitest'
import {
  axisTicks,
  groupRows,
  nowMarker,
  placeTask,
  timelineWindow,
} from './timeline'
import type { TimelineTask } from './timeline'

const day = (iso: string) => new Date(iso).getTime()

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 't',
    title: 'A task',
    status: 'todo',
    due_at: null,
    starts_at: null,
    team_id: null,
    ...over,
  }
}

const project = (starts_on: string | null, ends_on: string | null) => ({ starts_on, ends_on })

describe('timelineWindow', () => {
  it('uses the project’s own dates when it has them', () => {
    const w = timelineWindow(project('2026-10-01', '2026-12-01'), [])
    expect(w.source).toBe('project')
    expect(new Date(w.start).getMonth()).toBe(9)
    expect(new Date(w.end).getMonth()).toBe(11)
  })

  it('falls back to the tasks when the project has no dates', () => {
    const w = timelineWindow(project(null, null), [
      task({ starts_at: '2026-10-05T00:00:00Z', due_at: '2026-10-09T00:00:00Z' }),
      task({ due_at: '2026-11-20T00:00:00Z' }),
    ])
    expect(w.source).toBe('tasks')
    expect(w.start).toBe(day('2026-10-05T00:00:00Z'))
    expect(w.end).toBe(day('2026-11-20T00:00:00Z'))
  })

  it('falls back when the project has only one of its two dates', () => {
    const w = timelineWindow(project('2026-10-01', null), [task({ due_at: '2026-11-01T00:00:00Z' })])
    expect(w.source).toBe('tasks')
  })

  it('says it has nothing to draw when neither has a date', () => {
    expect(timelineWindow(project(null, null), [task()]).source).toBe('none')
    expect(timelineWindow(project(null, null), []).source).toBe('none')
  })

  it('never returns a window of zero width', () => {
    const w = timelineWindow(project(null, null), [task({ due_at: '2026-10-05T00:00:00Z' })])
    expect(w.end).toBeGreaterThan(w.start)
  })
})

describe('placeTask', () => {
  const w = timelineWindow(project('2026-10-01', '2026-10-11'), [])

  it('draws a bar for a task with both dates', () => {
    const p = placeTask(
      task({ starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-06T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(100)
    expect(p.width).toBeGreaterThan(0)
  })

  it('draws a diamond for a task with only a due date', () => {
    const p = placeTask(task({ due_at: '2026-10-06T00:00:00Z' }), w)
    expect(p.shape).toBe('diamond')
  })

  it('draws a diamond for a task with only a start date', () => {
    const p = placeTask(task({ starts_at: '2026-10-06T00:00:00Z' }), w)
    expect(p.shape).toBe('diamond')
  })

  it('draws nothing for a task with no dates at all', () => {
    expect(placeTask(task(), w).shape).toBe('none')
  })

  it('draws nothing when there is no window', () => {
    const none = timelineWindow(project(null, null), [])
    expect(placeTask(task({ due_at: '2026-10-06T00:00:00Z' }), none).shape).toBe('none')
  })

  it('keeps a task that runs past the window inside it', () => {
    const p = placeTask(
      task({ starts_at: '2026-09-01T00:00:00Z', due_at: '2026-12-01T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBe(0)
    expect(p.width).toBe(100)
  })

  it('gives a one-day bar a width somebody can see', () => {
    const p = placeTask(
      task({ starts_at: '2026-10-05T00:00:00Z', due_at: '2026-10-05T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.width).toBeGreaterThanOrEqual(1)
  })

  it('keeps a task entirely after the window inside it', () => {
    const p = placeTask(
      task({ starts_at: '2026-11-01T00:00:00Z', due_at: '2026-11-05T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.width).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(100)
  })

  it('keeps a task entirely before the window inside it', () => {
    const p = placeTask(
      task({ starts_at: '2026-09-01T00:00:00Z', due_at: '2026-09-05T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.width).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(100)
  })
})

describe('axisTicks', () => {
  it('ticks by week over a short project', () => {
    const ticks = axisTicks(timelineWindow(project('2026-10-01', '2026-11-01'), []))
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks[0].left).toBeGreaterThanOrEqual(0)
    expect(ticks[ticks.length - 1].left).toBeLessThanOrEqual(100)
  })

  it('ticks by month over a long one', () => {
    const ticks = axisTicks(timelineWindow(project('2026-01-01', '2026-12-31'), []))
    expect(ticks.length).toBeLessThanOrEqual(13)
    expect(ticks.some((t) => /Jan|Feb|Mar/.test(t.label))).toBe(true)
  })

  it('has nothing to tick with no window', () => {
    expect(axisTicks(timelineWindow(project(null, null), []))).toEqual([])
  })

  it('always has a tick for a tasks-sourced window that does not start at midnight', () => {
    const w = timelineWindow(project(null, null), [
      task({ due_at: '2026-10-05T15:30:00Z' }),
    ])
    const ticks = axisTicks(w)
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    for (const t of ticks) {
      expect(t.left).toBeGreaterThanOrEqual(0)
      expect(t.left).toBeLessThanOrEqual(100)
    }
  })
})

describe('groupRows', () => {
  const teams = [
    { id: 'a', name: 'Development' },
    { id: 'b', name: 'Testing' },
  ]

  it('puts project-wide work first, then teams by name', () => {
    const rows = groupRows(
      [
        task({ id: '1', team_id: 'b' }),
        task({ id: '2', team_id: null }),
        task({ id: '3', team_id: 'a' }),
      ],
      teams,
    )
    expect(rows.map((r) => r.teamName)).toEqual(['Whole project', 'Development', 'Testing'])
  })

  it('leaves out a team with no tasks', () => {
    const rows = groupRows([task({ team_id: 'a' })], teams)
    expect(rows.map((r) => r.teamName)).toEqual(['Development'])
  })

  it('orders tasks by start, then due, then title', () => {
    const rows = groupRows(
      [
        task({ id: 'late', title: 'B', due_at: '2026-10-09T00:00:00Z' }),
        task({ id: 'early', title: 'A', starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-09T00:00:00Z' }),
        task({ id: 'none', title: 'C' }),
      ],
      [],
    )
    expect(rows[0].tasks.map((t) => t.id)).toEqual(['early', 'late', 'none'])
  })

  it('returns nothing for a project with no tasks', () => {
    expect(groupRows([], teams)).toEqual([])
  })

  it('keeps a task whose team no longer exists in the whole-project row', () => {
    const rows = groupRows([task({ team_id: 'missing' })], teams)
    expect(rows.map((r) => r.teamName)).toEqual(['Whole project'])
  })
})

describe('nowMarker', () => {
  const w = timelineWindow(project('2026-10-01', '2026-10-11'), [])

  it('places today inside the window', () => {
    const at = nowMarker(w, day('2026-10-06T00:00:00Z'))
    expect(at).not.toBeNull()
    expect(at as number).toBeGreaterThan(0)
    expect(at as number).toBeLessThan(100)
  })

  it('says nothing when today is outside the window', () => {
    expect(nowMarker(w, day('2026-09-01T00:00:00Z'))).toBeNull()
    expect(nowMarker(w, day('2026-12-01T00:00:00Z'))).toBeNull()
  })
})
