import { describe, expect, it } from 'vitest'
import { readScope, writeScope } from './scope'

describe('readScope', () => {
  it('defaults to all when show is absent', () => {
    expect(readScope(new URLSearchParams())).toBe('all')
  })

  it('round-trips classes and work', () => {
    expect(readScope(new URLSearchParams('show=classes'))).toBe('classes')
    expect(readScope(new URLSearchParams('show=work'))).toBe('work')
  })

  it('rejects junk to all', () => {
    expect(readScope(new URLSearchParams('show=bogus'))).toBe('all')
    expect(readScope(new URLSearchParams('show='))).toBe('all')
  })
})

describe('writeScope', () => {
  it('deletes show for all', () => {
    const params = writeScope(new URLSearchParams('show=classes'), 'all')
    expect(params.has('show')).toBe(false)
  })

  it('sets show for classes and work', () => {
    expect(writeScope(new URLSearchParams(), 'classes').get('show')).toBe('classes')
    expect(writeScope(new URLSearchParams(), 'work').get('show')).toBe('work')
  })

  it('leaves other params untouched', () => {
    const params = writeScope(new URLSearchParams('foo=bar'), 'work')
    expect(params.get('foo')).toBe('bar')
    expect(params.get('show')).toBe('work')
  })
})
