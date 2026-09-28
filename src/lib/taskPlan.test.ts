import { describe, expect, it } from 'vitest'
import { endOfDay, shareOut, spreadDueDates } from './taskPlan'

describe('spreadDueDates', () => {
  const from = new Date(2026, 8, 1, 9, 0)
  const deadline = new Date(2026, 8, 11, 23, 59)

  it('follows the weight and ends on the deadline day', () => {
    const dates = spreadDueDates([1, 1, 2], from, deadline)
    expect(dates).toHaveLength(3)
    expect(dates[2]).toBe('2026-09-11')
    expect(dates[0] < dates[1] && dates[1] < dates[2]).toBe(true)
  })

  it('gives nothing when there is no window', () => {
    expect(spreadDueDates([1, 2], from, null)).toEqual(['', ''])
    expect(spreadDueDates([1], deadline, from)).toEqual([''])
  })
})

describe('endOfDay', () => {
  it('is 11:59 pm local', () => {
    const d = new Date(endOfDay('2026-09-11')!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 8, 11, 23, 59,
    ])
  })
  it('refuses anything that is not a day', () => {
    expect(endOfDay('')).toBeNull()
  })
})

describe('shareOut', () => {
  it('evens out the weight, counting what people already hold', () => {
    const who = shareOut([10, 5, 5, 4], [
      { id: 'a', held: 0 },
      { id: 'b', held: 6 },
    ])
    // a takes 10; b (6) takes 5 → 11; a (10) takes 5 → 15; b (11) takes 4 → 15.
    expect(who).toEqual(['a', 'b', 'a', 'b'])
  })

  it('leaves everything open with nobody to give it to', () => {
    expect(shareOut([1, 2], [])).toEqual([null, null])
  })
})
