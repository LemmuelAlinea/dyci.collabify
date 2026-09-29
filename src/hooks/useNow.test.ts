import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readNow, subscribeNow } from './useNow'

describe('the shared clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the time afresh when the first component subscribes', () => {
    vi.setSystemTime(new Date('2026-09-29T09:30:00Z'))
    const stop = subscribeNow(() => {})
    expect(readNow()).toBe(new Date('2026-09-29T09:30:00Z').getTime())
    stop()
  })

  it('ticks once a minute and tells every subscriber', () => {
    const a = vi.fn()
    const b = vi.fn()
    const stopA = subscribeNow(a)
    const stopB = subscribeNow(b)
    const start = readNow()
    vi.advanceTimersByTime(59_000)
    expect(a).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(readNow()).toBe(start + 60_000)
    stopA()
    stopB()
  })

  it('stops ticking once nobody is listening', () => {
    const a = vi.fn()
    subscribeNow(a)()
    vi.advanceTimersByTime(5 * 60_000)
    expect(a).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
