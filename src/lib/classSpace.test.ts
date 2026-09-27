import { describe, expect, it } from 'vitest'
import { teachingClassFilter } from './classSpace'

describe('teachingClassFilter', () => {
  it('is null with no seats, so the caller filters on professor_id alone', () => {
    expect(teachingClassFilter('u1', [])).toBeNull()
  })

  it('asks for their own classes or the classes of the spaces they sit in', () => {
    expect(teachingClassFilter('u1', ['s1', 's2'])).toBe('professor_id.eq.u1,space_id.in.(s1,s2)')
  })
})
