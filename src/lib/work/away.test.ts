import { describe, expect, it } from 'vitest'
import { awayText } from './away'

const r = (first_day: string, last_day: string, part_day = false) =>
  ({ user_id: 'u', first_day, last_day, part_day, added_by: null })

describe('awayText', () => {
  it('away labels', () => {
    const today = '2026-11-26'
    expect(awayText([r('2026-11-26', '2026-11-26', true)], today, 'holder')).toBe('Away today')
    expect(awayText([r('2026-11-25', '2026-11-28')], today, 'holder')).toBe('Away until Sat 28 Nov')
    expect(awayText([r('2026-11-25', '2026-11-28')], today, 'picker')).toBe('Away until Sat 28 Nov')
    expect(awayText([r('2026-12-01', '2026-12-03')], today, 'picker')).toBe('Away 1–3 Dec')
    expect(awayText([r('2026-12-01', '2026-12-03')], today, 'holder')).toBeNull()
    expect(awayText([r('2026-11-20', '2026-11-21')], today, 'picker')).toBeNull()
    expect(awayText([], today, 'picker')).toBeNull()
  })
  it('a part-day leave longer than today reads until its end', () => {
    expect(awayText([r('2026-11-26', '2026-11-27', true)], '2026-11-26', 'holder')).toBe('Away until Fri 27 Nov')
  })
})
