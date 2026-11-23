import { describe, expect, it } from 'vitest'
import { moveDueDate } from './leave'

describe('moveDueDate', () => {
  it('keeps the time of day in Manila', () => {
    // 15:30 in Manila on 26 Nov.
    expect(moveDueDate('2026-11-26T07:30:00Z', '2026-12-01')).toBe('2026-12-01T07:30:00.000Z')
  })
  it('uses 17:00 Manila when there was no due date', () => {
    expect(moveDueDate(null, '2026-12-01')).toBe('2026-12-01T09:00:00.000Z')
  })
})
