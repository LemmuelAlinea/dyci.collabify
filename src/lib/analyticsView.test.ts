import { describe, expect, it } from 'vitest'
import { evidenceFor, readAnalyticsView } from './analyticsView'
import type { ActionKind } from './insight'

describe('readAnalyticsView', () => {
  it('reads a known view', () => {
    expect(readAnalyticsView('students')).toBe('students')
  })
  it('falls back to the class view for anything else', () => {
    expect(readAnalyticsView(null)).toBe('class')
    expect(readAnalyticsView('reports')).toBe('class')
  })
})

describe('evidenceFor', () => {
  const groupBoard = () => null
  const card = (kind: ActionKind, extra: Record<string, unknown> = {}) => ({
    kind,
    classId: 'c1',
    boardId: null,
    studentId: null,
    ...extra,
  })

  it("lands a board problem on that group's health row", () => {
    expect(evidenceFor(card('stalled_board', { boardId: 'b1' }), groupBoard)).toEqual({
      view: 'groups',
      ids: ['attn-board-b1', 'attn-health'],
    })
  })
  it("lands an individual board on its student's roster row", () => {
    expect(evidenceFor(card('overdue_work', { boardId: 'b2' }), () => 's1')).toEqual({
      view: 'students',
      ids: ['attn-student-c1:s1', 'attn-students'],
    })
  })
  it('lands carrying and forecasts on their own sections', () => {
    expect(evidenceFor(card('carrying_alone', { boardId: 'b1' }), groupBoard).ids[0]).toBe('attn-share-b1')
    expect(evidenceFor(card('will_miss_deadline', { boardId: 'b1' }), groupBoard).ids[0]).toBe('attn-burn-b1')
  })
  it('lands one student on their row, and many on the roster', () => {
    expect(evidenceFor(card('holding_nothing', { studentId: 's1' }), groupBoard).ids).toEqual([
      'attn-student-c1:s1',
      'attn-students',
    ])
    expect(evidenceFor(card('not_in_a_group', { names: ['A', 'B'] }), groupBoard)).toEqual({
      view: 'students',
      ids: ['attn-students'],
    })
  })
  it('lands a pile-up on its week and a gap on its syllabus week', () => {
    expect(
      evidenceFor(card('deadline_pile_up', { at: '2026-10-19T00:00:00+00:00' }), groupBoard),
    ).toEqual({ view: 'class', ids: ['attn-week-2026-10-19', 'attn-pressure'] })
    expect(evidenceFor(card('syllabus_gap', { n: 7 }), groupBoard).ids[0]).toBe('attn-gap-c1-7')
  })
})
