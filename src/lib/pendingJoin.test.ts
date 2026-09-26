import { describe, expect, it } from 'vitest'
import { forgetJoin, inviteLink, joinPath, normalizeCode, pendingJoin, rememberJoin } from './pendingJoin'
import type { KeyStore } from './pendingJoin'

function memory(): KeyStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

describe('class invite links', () => {
  it('reads a code the way join_class does', () => {
    expect(normalizeCode('  dbm-7823 ')).toBe('DBM-7823')
  })

  it('builds the path and the link', () => {
    expect(joinPath('dbm-7823')).toBe('/join/DBM-7823')
    expect(inviteLink('dbm-7823', 'https://collabify.app')).toBe('https://collabify.app/join/DBM-7823')
  })

  it('keeps a code across the sign-in detour, once', () => {
    const s = memory()
    expect(pendingJoin(s)).toBeNull()
    rememberJoin('dbm-7823', s)
    expect(pendingJoin(s)).toBe('DBM-7823')
    forgetJoin(s)
    expect(pendingJoin(s)).toBeNull()
  })

  it('does nothing when there is no storage', () => {
    expect(() => rememberJoin('x', undefined)).not.toThrow()
    expect(pendingJoin(undefined)).toBeNull()
  })
})
