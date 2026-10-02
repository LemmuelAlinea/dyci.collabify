import { describe, expect, it } from 'vitest'
import { clock } from './voice'

describe('clock', () => {
  it('reads a recording length as m:ss', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(5000)).toBe('0:05')
    expect(clock(84000)).toBe('1:24')
    expect(clock(300000)).toBe('5:00')
  })
})
