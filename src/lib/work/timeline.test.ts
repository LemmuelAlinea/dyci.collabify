import { describe, expect, it } from 'vitest'
import {
  buildChart,
  dataRange,
  defaultMonth,
  defaultScale,
  groupRows,
  milestoneMarks,
  monthsIn,
  nowMarker,
  placeBand,
  placeMark,
  placeTask,
  sprintBands,
  xOf,
} from './timeline'
import type { TimelineTask } from './timeline'

/** Local time, the way the chart reads dates. */
const at = (s: string, h = 0, min = 0) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, h, min).getTime()
}
const iso = (s: string, h = 0, min = 0) => new Date(at(s, h, min)).toISOString()

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 't',
    title: 'A task',
    status: 'todo',
    due_at: null,
    starts_at: null,
    group_id: null,
    ...over,
  }
}

const range = (from: string, to: string) => ({ start: at(from), end: at(to) })

describe('dataRange', () => {
  it('spans every task date and extra instant', () => {
    const r = dataRange(
      [task({ starts_at: iso('2026-10-12'), due_at: iso('2026-10-13', 23, 59) }), task({ due_at: iso('2026-12-04', 23, 59) })],
      [at('2026-10-05')],
    )
    expect(r).toEqual({ start: at('2026-10-05'), end: at('2026-12-04', 23, 59) })
  })

  it('follows the work, not the project dates, when the work has dates', () => {
    const r = dataRange([task({ due_at: iso('2026-12-01') })], [], { starts_on: '2026-01-01', ends_on: '2026-02-01' })
    expect(r?.start).toBe(at('2026-12-01'))
  })

  it('falls back to the project dates, then to nothing', () => {
    expect(dataRange([task()], [], { starts_on: '2026-10-01', ends_on: '2026-10-31' })).toEqual(
      range('2026-10-01', '2026-11-01'),
    )
    expect(dataRange([task()])).toBeNull()
  })
})

describe('defaultScale and months', () => {
  it('picks days inside one month, weeks up to about six months, months beyond', () => {
    expect(defaultScale(range('2026-10-05', '2026-10-20'))).toBe('day')
    expect(defaultScale(range('2026-10-25', '2026-11-05'))).toBe('week')
    expect(defaultScale(range('2026-10-12', '2026-12-05'))).toBe('week')
    expect(defaultScale(range('2026-01-01', '2026-12-31'))).toBe('month')
  })

  it('lists the months a range touches and opens on this month when it is in them', () => {
    const r = range('2026-10-12', '2026-12-05')
    expect(monthsIn(r)).toEqual(['2026-10', '2026-11', '2026-12'])
    expect(defaultMonth(r, at('2026-11-20'))).toBe('2026-11')
    expect(defaultMonth(r, at('2027-03-01'))).toBe('2026-10')
  })
})

describe('buildChart', () => {
  it('lays out every day of the chosen month, weekends marked, today flagged', () => {
    const c = buildChart('day', range('2026-10-12', '2026-12-05'), '2026-11', at('2026-11-03', 9))
    expect(c.columns).toHaveLength(30)
    expect(c.columns[0]).toMatchObject({ start: at('2026-11-01'), label: '1', weekend: true })
    expect(c.columns[2].today).toBe(true)
    expect(c.groups).toEqual([{ label: 'November 2026', span: 30 }])
    expect(c.end).toBe(at('2026-12-01'))
  })

  it('starts weeks on Monday and groups them by month', () => {
    const c = buildChart('week', range('2026-10-14', '2026-11-05'))
    expect(c.columns.map((x) => x.label)).toEqual(['Oct 12', 'Oct 19', 'Oct 26', 'Nov 2'])
    expect(c.columns[0].sub).toBe('to Oct 18')
    expect(c.groups).toEqual([
      { label: 'October 2026', span: 3 },
      { label: 'November 2026', span: 1 },
    ])
  })

  it('covers whole months and groups them by year', () => {
    const c = buildChart('month', range('2026-11-20', '2027-01-10'))
    expect(c.columns.map((x) => x.label)).toEqual(['Nov', 'Dec', 'Jan'])
    expect(c.groups).toEqual([
      { label: '2026', span: 2 },
      { label: '2027', span: 1 },
    ])
  })
})

describe('xOf', () => {
  it('counts inside the column, so February and March are the same width', () => {
    const c = buildChart('month', range('2026-02-01', '2026-03-31'))
    expect(xOf(c, at('2026-03-01'))).toBeCloseTo(50, 5)
    expect(xOf(c, at('2026-02-15'))).toBeCloseTo(25, 5)
    expect(xOf(c, at('2026-03-16', 12))).toBeCloseTo(75, 5)
  })
})

describe('placeTask', () => {
  const nov = buildChart('day', range('2026-10-01', '2026-12-31'), '2026-11')

  it('draws a bar from the start of its first day to the end of its last', () => {
    const p = placeTask(task({ starts_at: iso('2026-11-02'), due_at: iso('2026-11-03', 23, 59) }), nov)
    expect(p).toMatchObject({ shape: 'bar', clippedStart: false, clippedEnd: false })
    if (p.shape !== 'bar') throw new Error('bar')
    expect(p.left).toBeCloseTo((1 / 30) * 100, 5)
    expect(p.width).toBeCloseTo((2 / 30) * 100, 5)
  })

  it('clips a bar that runs past the month and says so', () => {
    const p = placeTask(task({ starts_at: iso('2026-10-30'), due_at: iso('2026-11-02', 23, 59) }), nov)
    expect(p).toMatchObject({ shape: 'bar', left: 0, clippedStart: true, clippedEnd: false })
  })

  it('puts a one-date task mid-day as a diamond', () => {
    const p = placeTask(task({ due_at: iso('2026-11-10', 23, 59) }), nov)
    expect(p.shape).toBe('diamond')
    if (p.shape !== 'diamond') throw new Error('diamond')
    expect(p.left).toBeCloseTo((9.5 / 30) * 100, 5)
  })

  it('says which side a task outside the month is on, and when it has no date', () => {
    expect(placeTask(task({ due_at: iso('2026-10-20') }), nov)).toEqual({ shape: 'outside', side: 'before' })
    expect(placeTask(task({ starts_at: iso('2026-12-01'), due_at: iso('2026-12-04') }), nov)).toEqual({
      shape: 'outside',
      side: 'after',
    })
    expect(placeTask(task(), nov)).toEqual({ shape: 'none' })
  })

  it('reads a start after the due as the same span', () => {
    expect(placeTask(task({ starts_at: iso('2026-11-05'), due_at: iso('2026-11-02') }), nov)).toMatchObject({ shape: 'bar' })
  })
})

describe('groupRows', () => {
  const teams = [
    { id: 'a', name: 'Development' },
    { id: 'b', name: 'Testing' },
  ]

  it('puts project-wide work first, then teams by name', () => {
    const rows = groupRows(
      [task({ id: '1', group_id: 'b' }), task({ id: '2', group_id: null }), task({ id: '3', group_id: 'a' })],
      teams,
    )
    expect(rows.map((r) => r.groupName)).toEqual(['Whole project', 'Development', 'Testing'])
  })

  it('leaves out a team with no tasks', () => {
    const rows = groupRows([task({ group_id: 'a' })], teams)
    expect(rows.map((r) => r.groupName)).toEqual(['Development'])
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

  it('breaks a tie on the same start by due date, not by title', () => {
    const rows = groupRows(
      [
        task({ id: 'z-early-due', title: 'Z', starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-03T00:00:00Z' }),
        task({ id: 'a-late-due', title: 'A', starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-09T00:00:00Z' }),
      ],
      [],
    )
    expect(rows[0].tasks.map((t) => t.id)).toEqual(['z-early-due', 'a-late-due'])
  })

  it('returns nothing for a project with no tasks', () => {
    expect(groupRows([], teams)).toEqual([])
  })

  it('keeps a task whose team no longer exists in the whole-project row', () => {
    const rows = groupRows([task({ group_id: 'missing' })], teams)
    expect(rows.map((r) => r.groupName)).toEqual(['Whole project'])
  })

  it('names ungrouped work with the label it is given', () => {
    const rows = groupRows([task({ group_id: null })], [], 'Your group')
    expect(rows.map((r) => r.groupName)).toEqual(['Your group'])
  })
})

describe('nowMarker', () => {
  const c = buildChart('day', range('2026-10-01', '2026-10-31'), '2026-10')

  it('places today inside the chart', () => {
    expect(nowMarker(c, at('2026-10-16', 12))).toBeCloseTo((15.5 / 31) * 100, 5)
  })

  it('says nothing when today is outside it', () => {
    expect(nowMarker(c, at('2026-09-01'))).toBeNull()
    expect(nowMarker(c, at('2026-11-01'))).toBeNull()
  })
})

describe('sprint bands', () => {
  const c = buildChart('day', range('2026-10-01', '2026-10-31'), '2026-10')

  it('spans a sprint from its first day to the end of its last', () => {
    const [band] = sprintBands([{ id: 's', name: 'Sprint 1', starts_on: '2026-10-05', ends_on: '2026-10-18' }])
    expect(band).toEqual({ id: 's', label: 'Sprint 1', start: at('2026-10-05'), end: at('2026-10-19') })
  })

  it('places a band inside the chart and drops one outside', () => {
    const place = placeBand({ id: 's', label: 'S', start: at('2026-10-01'), end: at('2026-10-16') }, c)
    expect(place?.left).toBe(0)
    expect(place?.width).toBeCloseTo((15 / 31) * 100, 5)
    expect(placeBand({ id: 's', label: 'S', start: at('2026-11-02'), end: at('2026-11-09') }, c)).toBeNull()
  })
})

describe('milestone marks', () => {
  const c = buildChart('day', range('2026-10-01', '2026-10-31'), '2026-10')

  it('sits at noon on its day', () => {
    expect(milestoneMarks([{ id: 'm', name: 'Beta', due_on: '2026-10-16' }])).toEqual([
      { id: 'm', label: 'Beta', at: at('2026-10-16', 12) },
    ])
  })

  it('places inside the chart and drops what falls outside', () => {
    expect(placeMark({ id: 'm', label: 'B', at: at('2026-10-01') }, c)).toBe(0)
    expect(placeMark({ id: 'm', label: 'B', at: at('2026-11-05') }, c)).toBeNull()
  })
})
