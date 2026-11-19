import { describe, expect, it } from 'vitest'
import { isActiveNow, seenLabel } from './presence'

const NOW = Date.parse('2026-11-20T10:00:00Z')
const ago = (secs: number) => new Date(NOW - secs * 1000).toISOString()

describe('isActiveNow', () => {
  it('is active up to two minutes after the last beat', () => {
    expect(isActiveNow(ago(0), NOW)).toBe(true)
    expect(isActiveNow(ago(119), NOW)).toBe(true)
    expect(isActiveNow(ago(121), NOW)).toBe(false)
  })
})

describe('seenLabel', () => {
  it('has no label while active now', () => {
    expect(seenLabel(ago(60), NOW)).toBeNull()
  })

  it('counts whole minutes once past two minutes', () => {
    expect(seenLabel(ago(121), NOW)).toBe('2m')
    expect(seenLabel(ago(12 * 60 + 30), NOW)).toBe('12m')
  })

  it('stops at 59 minutes', () => {
    expect(seenLabel(ago(59 * 60), NOW)).toBe('59m')
    expect(seenLabel(ago(75 * 60), NOW)).toBe('59m')
  })
})
