import { describe, expect, it } from 'vitest'
import { matches } from './search'

describe('matches', () => {
  it('matches everything when the query is blank', () => {
    expect(matches('   ', 'anything')).toBe(true)
  })
  it('ignores case and surrounding space', () => {
    expect(matches('  CHAPTER ', 'docs/Chapter 1.md')).toBe(true)
  })
  it('matches any one of several fields and skips empty ones', () => {
    expect(matches('ana', null, undefined, 'Title', 'Ana Cruz')).toBe(true)
    expect(matches('zed', 'Title', null)).toBe(false)
  })
})
