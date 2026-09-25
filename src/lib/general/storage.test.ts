import { describe, expect, it } from 'vitest'
import { pathsNotRemoved } from './storage'

describe('pathsNotRemoved', () => {
  it('lists the requested paths Storage did not report removing', () => {
    expect(pathsNotRemoved(['a', 'b', 'c'], [{ name: 'b' }])).toEqual(['a', 'c'])
    expect(pathsNotRemoved(['a', 'b'], [{ name: 'a' }, { name: 'b' }])).toEqual([])
  })

  it('treats a missing result as nothing removed', () => {
    expect(pathsNotRemoved(['a'], null)).toEqual(['a'])
    expect(pathsNotRemoved([], null)).toEqual([])
  })
})
