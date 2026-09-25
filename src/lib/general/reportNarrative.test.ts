import { describe, expect, it } from 'vitest'
import { reportNarrative } from './reportNarrative'

const totals = {
  tasks_total: 20,
  done: 12,
  done_in_range: 7,
  overdue_now: 3,
  minutes_in_range: 150,
  reviews_opened: 2,
  reviews_applied: 1,
  reviews_declined: 0,
}

describe('reportNarrative', () => {
  it('reads a lead report', () => {
    expect(
      reportNarrative({
        totals,
        previous: { ...totals, done_in_range: 3 },
        top: { name: 'Ana Cruz', finished: 5 },
        self: false,
        reviewsWaiting: 1,
      }),
    ).toEqual([
      '12 of 20 tasks are done (60%).',
      '7 tasks were finished in this range, 4 more than the previous period.',
      '3 tasks are overdue.',
      'Ana Cruz finished the most, with 5 tasks.',
      '2.5 hours were logged.',
      '1 review request is still waiting for an answer.',
    ])
  })

  it('speaks to a member and never names anybody else', () => {
    const lines = reportNarrative({ totals: { ...totals, overdue_now: 0 }, self: true, top: { name: 'Ana Cruz', finished: 5 } })
    expect(lines).toContain('You finished 7 tasks in this range.')
    expect(lines).toContain('You logged 2.5 hours.')
    expect(lines).toContain('Nothing is overdue.')
    expect(lines.join(' ')).not.toContain('Ana')
  })

  it('follows the house style', () => {
    const text = reportNarrative({ totals, self: false }).join(' ')
    expect(text).not.toMatch(/!|successfully|please/i)
  })

  it('says so when there is nothing to report', () => {
    expect(reportNarrative({ totals: { ...totals, tasks_total: 0, done: 0 }, self: false })[0]).toBe(
      'There are no tasks in this report yet.',
    )
  })
})
