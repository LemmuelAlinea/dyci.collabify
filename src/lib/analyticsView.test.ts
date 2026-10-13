import { describe, expect, it } from 'vitest'
import { readAnalyticsView, viewForAction } from './analyticsView'

describe('readAnalyticsView', () => {
  it('reads a known view', () => {
    expect(readAnalyticsView('students')).toBe('students')
  })
  it('falls back to the class view for anything else', () => {
    expect(readAnalyticsView(null)).toBe('class')
    expect(readAnalyticsView('reports')).toBe('class')
  })
})

describe('viewForAction', () => {
  it('sends a follow-up to Students', () => {
    expect(viewForAction('follow_up_due')).toBe('students')
  })
  it('sends board problems to Groups', () => {
    expect(viewForAction('carrying_alone')).toBe('groups')
    expect(viewForAction('stalled_board')).toBe('groups')
  })
  it('sends people problems to Students', () => {
    expect(viewForAction('not_in_a_group')).toBe('students')
    expect(viewForAction('holding_nothing')).toBe('students')
  })
  it('sends syllabus and calendar problems to Class', () => {
    expect(viewForAction('syllabus_gap')).toBe('class')
    expect(viewForAction('deadline_pile_up')).toBe('class')
  })
})
