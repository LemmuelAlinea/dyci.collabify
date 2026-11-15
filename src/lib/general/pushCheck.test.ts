import { describe, expect, it } from 'vitest'
import { isStalePushError, pushVerdict } from './pushCheck'
import type { PushState } from './types'

const state = (over: Partial<PushState>): PushState => ({
  base_seq: 3,
  main_seq: 3,
  main_author: null,
  main_at: null,
  main_removed: false,
  ...over,
})

describe('pushVerdict', () => {
  it('is unknown with no pull when Main has the file', () => {
    expect(pushVerdict(null, true)).toEqual({ kind: 'unknown' })
  })
  it('is clear with no pull when Main does not have it', () => {
    expect(pushVerdict(null, false)).toEqual({ kind: 'clear' })
  })
  it('is clear when Main has not moved', () => {
    expect(pushVerdict(state({}), true)).toEqual({ kind: 'clear' })
  })
  it('is held when Main moved on', () => {
    expect(pushVerdict(state({ main_seq: 5, main_author: 'ben', main_at: 't' }), true)).toEqual({
      kind: 'held', by: 'ben', at: 't', removed: false, mainSeq: 5, baseSeq: 3,
    })
  })
  it('is held when Main removed it', () => {
    const v = pushVerdict(state({ main_seq: 4, main_removed: true }), false)
    expect(v).toMatchObject({ kind: 'held', removed: true })
  })
})

describe('isStalePushError', () => {
  it('matches the guard message', () => {
    expect(isStalePushError({ message: 'Main has a newer version of chap.docx than…' })).toBe(true)
  })
  it('ignores other errors', () => {
    expect(isStalePushError(new Error('nope'))).toBe(false)
    expect(isStalePushError(null)).toBe(false)
  })
})
