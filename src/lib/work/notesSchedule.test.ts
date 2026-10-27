import { describe, expect, it } from 'vitest'
import { completeNotesDates } from '../../../supabase/functions/_shared/notesSchedule'

const task = (title: string, extra: { start?: string; due?: string; sprint?: string; milestone?: string } = {}) => ({
  title, start: '', due: '', sprint: '', milestone: '', ...extra,
})

describe('completeNotesDates', () => {
  it('anchors an undated sprint plan to an upcoming project start and dates every task', () => {
    const result = completeNotesDates(
      [task('Plan', { sprint: 'Sprint 1' }), task('Design', { sprint: 'Sprint 1' }), task('Build', { sprint: 'Sprint 2' })],
      [{ name: 'Sprint 1', starts_on: '', ends_on: '' }, { name: 'Sprint 2', starts_on: '', ends_on: '' }],
      [{ name: 'Design ready', due: '', sprints: ['Sprint 1'] }],
      { today: '2026-10-27', projectStart: '2026-11-02' },
    )
    expect(result.sprints).toMatchObject([
      { starts_on: '2026-11-02', ends_on: '2026-11-15' },
      { starts_on: '2026-11-16', ends_on: '2026-11-29' },
    ])
    expect(result.tasks.every((t) => t.start && t.due && t.start <= t.due)).toBe(true)
    expect(result.tasks[0].start).toBe('2026-11-02')
    expect(result.tasks[2].start).toBe('2026-11-16')
    expect(result.milestones[0].due).toBe('2026-11-15')
  })

  it('preserves stated dates and fills only missing endpoints', () => {
    const result = completeNotesDates(
      [task('A', { start: '2026-11-04', due: '2026-11-06' }), task('B', { due: '2026-11-12' }), task('C', { start: '2026-11-13' })],
      [], [], { today: '2026-10-27' },
    )
    expect(result.tasks[0]).toMatchObject({ start: '2026-11-04', due: '2026-11-06' })
    expect(result.tasks[1].due).toBe('2026-11-12')
    expect(result.tasks[1].start <= '2026-11-12').toBe(true)
    expect(result.tasks[2].start).toBe('2026-11-13')
    expect(result.tasks[2].due >= '2026-11-13').toBe(true)
  })

  it('starts today if the project start passed and fits undated tasks before a future end', () => {
    const result = completeNotesDates(
      [task('A'), task('B'), task('C')], [], [],
      { today: '2026-10-27', projectStart: '2026-09-01', projectEnd: '2026-10-30' },
    )
    expect(result.tasks[0].start).toBe('2026-10-27')
    expect(result.tasks.every((t) => t.due <= '2026-10-30')).toBe(true)
  })

  it('dates a named milestone from its tasks when no sprint is named', () => {
    const result = completeNotesDates(
      [task('Approve prototype', { due: '2026-11-06', milestone: 'Prototype ready' })],
      [], [{ name: 'Prototype ready', due: '', sprints: [] }], { today: '2026-10-27' },
    )
    expect(result.milestones[0].due).toBe('2026-11-06')
  })

  it('ignores impossible model dates and still returns valid task dates', () => {
    const result = completeNotesDates(
      [task('A', { start: '2026-02-30', due: 'bad' }), task('B', { start: '2026-11-09', due: '2026-11-02' })],
      [], [], { today: '2026-10-27' },
    )
    expect(result.tasks.every((t) => t.start && t.due && t.start <= t.due)).toBe(true)
    expect(result.tasks[1].due).toBe('2026-11-02')
  })
})
