import { describe, expect, it } from 'vitest'
import { ROW_LEFT, pathsNotRemoved, rowDeleteError } from './storage'

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

describe('rowDeleteError', () => {
  const refused = { code: '42501', message: 'You can delete only what you archived.' }
  const frozen = { code: '23514', message: 'This project is archived.' }
  const other = { code: '08006', message: 'connection lost' }

  it('passes a refusal through with its own message', () => {
    expect(rowDeleteError(refused, 1)).toBe(refused)
    expect(rowDeleteError(frozen, 2)).toBe(frozen)
  })

  it('says the entry remains only when this call removed an object', () => {
    expect((rowDeleteError(other, 1) as Error).message).toBe(ROW_LEFT)
    expect(rowDeleteError(other, 0)).toBe(other)
  })
})
