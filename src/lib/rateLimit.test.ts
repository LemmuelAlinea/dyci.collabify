import { beforeEach, describe, expect, it } from 'vitest'
import {
  attemptsLeft,
  clearFailures,
  recordFailure,
  retryAfter,
  waitLabel,
} from './rateLimit'

/**
 * vitest runs in the node environment here by deliberate project choice, so
 * there is no localStorage. This is the whole surface the module touches, and
 * standing it up is cheaper than pulling in jsdom for three methods.
 */
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

const T0 = 1_700_000_000_000

describe('retryAfter', () => {
  it('lets a first attempt through', () => {
    expect(retryAfter('signIn', 'a@b.com', T0)).toBe(0)
  })

  it('ignores a blank identifier rather than sharing one bucket', () => {
    recordFailure('signIn', '', T0)
    expect(retryAfter('signIn', '', T0)).toBe(0)
  })
})

describe('recordFailure', () => {
  it('allows failures up to the limit without a wait', () => {
    for (let i = 0; i < 4; i++) {
      expect(recordFailure('signIn', 'a@b.com', T0 + i)).toBe(0)
    }
  })

  it('starts the wait on the failure that reaches the limit', () => {
    let wait = 0
    for (let i = 0; i < 5; i++) wait = recordFailure('signIn', 'a@b.com', T0 + i)
    expect(wait).toBe(30_000)
    expect(retryAfter('signIn', 'a@b.com', T0 + 5)).toBeGreaterThan(0)
  })

  it('escalates the wait on each repeat breach', () => {
    const hitLimit = (base: number) => {
      let w = 0
      for (let i = 0; i < 5; i++) w = recordFailure('signIn', 'a@b.com', base + i)
      return w
    }
    expect(hitLimit(T0)).toBe(30_000)
    expect(hitLimit(T0 + 60_000)).toBe(120_000)
    expect(hitLimit(T0 + 600_000)).toBe(300_000)
  })

  it('holds the last rung rather than growing without bound', () => {
    const hitLimit = (base: number) => {
      let w = 0
      for (let i = 0; i < 5; i++) w = recordFailure('signIn', 'a@b.com', base + i)
      return w
    }
    for (let n = 0; n < 4; n++) hitLimit(T0 + n * 3_600_000)
    expect(hitLimit(T0 + 10 * 3_600_000)).toBe(900_000)
  })

  it('forgets failures that fall out of the window', () => {
    for (let i = 0; i < 4; i++) recordFailure('signIn', 'a@b.com', T0 + i)
    // 16 minutes later the first four are outside the 15 minute window.
    expect(recordFailure('signIn', 'a@b.com', T0 + 16 * 60_000)).toBe(0)
  })

  it('keeps separate buckets per identifier', () => {
    for (let i = 0; i < 5; i++) recordFailure('signIn', 'a@b.com', T0 + i)
    expect(retryAfter('signIn', 'other@b.com', T0 + 5)).toBe(0)
  })

  it('keeps separate buckets per action', () => {
    for (let i = 0; i < 5; i++) recordFailure('signIn', 'a@b.com', T0 + i)
    expect(retryAfter('passwordReset', 'a@b.com', T0 + 5)).toBe(0)
  })

  it('treats an address as the same whatever its case or padding', () => {
    for (let i = 0; i < 5; i++) recordFailure('signIn', 'A@B.com', T0 + i)
    expect(retryAfter('signIn', '  a@b.com ', T0 + 5)).toBeGreaterThan(0)
  })

  it('is stricter on the flows that send mail', () => {
    let reset = 0
    for (let i = 0; i < 3; i++) reset = recordFailure('passwordReset', 'a@b.com', T0 + i)
    expect(reset).toBe(60_000)

    let signup = 0
    for (let i = 0; i < 3; i++) signup = recordFailure('signUp', 'c@d.com', T0 + i)
    expect(signup).toBe(60_000)
  })
})

describe('clearFailures', () => {
  it('releases the wait, so a correct attempt costs nothing later', () => {
    for (let i = 0; i < 5; i++) recordFailure('signIn', 'a@b.com', T0 + i)
    clearFailures('signIn', 'a@b.com')
    expect(retryAfter('signIn', 'a@b.com', T0 + 5)).toBe(0)
    expect(attemptsLeft('signIn', 'a@b.com', T0 + 5)).toBe(5)
  })
})

describe('attemptsLeft', () => {
  it('counts down with each failure', () => {
    expect(attemptsLeft('signIn', 'a@b.com', T0)).toBe(5)
    recordFailure('signIn', 'a@b.com', T0)
    expect(attemptsLeft('signIn', 'a@b.com', T0 + 1)).toBe(4)
  })

  it('is zero while a wait is running', () => {
    for (let i = 0; i < 5; i++) recordFailure('signIn', 'a@b.com', T0 + i)
    expect(attemptsLeft('signIn', 'a@b.com', T0 + 5)).toBe(0)
  })
})

describe('waitLabel', () => {
  it('rounds up so a wait never reads as zero', () => {
    expect(waitLabel(400)).toBe('1 second')
  })

  it('singularises', () => {
    expect(waitLabel(1000)).toBe('1 second')
    expect(waitLabel(2000)).toBe('2 seconds')
    expect(waitLabel(60_000)).toBe('1 minute')
    expect(waitLabel(120_000)).toBe('2 minutes')
  })

  it('switches to minutes at a minute', () => {
    expect(waitLabel(59_000)).toBe('59 seconds')
    expect(waitLabel(90_000)).toBe('2 minutes')
  })
})

describe('storage failure', () => {
  it('never blocks an attempt when storage throws', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => recordFailure('signIn', 'a@b.com', T0)).not.toThrow()
    expect(retryAfter('signIn', 'a@b.com', T0)).toBe(0)
  })
})
