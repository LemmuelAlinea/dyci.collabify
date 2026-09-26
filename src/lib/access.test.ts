import { describe, expect, it } from 'vitest'
import { canTeach, isFaculty } from './access'

const p = (
  role: 'student' | 'professor' | 'admin' | null,
  status: 'active' | 'pending' | 'rejected',
  can_teach = false,
) => ({ role, status, can_teach })

describe('isFaculty', () => {
  it('admits approved faculty and the admin', () => {
    expect(isFaculty(p('professor', 'active'))).toBe(true)
    expect(isFaculty(p('admin', 'active'))).toBe(true)
  })

  it('keeps out students, waiting faculty, deactivated accounts and nobody', () => {
    expect(isFaculty(p('student', 'active'))).toBe(false)
    expect(isFaculty(p('professor', 'pending'))).toBe(false)
    expect(isFaculty(p('professor', 'rejected'))).toBe(false)
    expect(isFaculty(p(null, 'active'))).toBe(false)
    expect(isFaculty(null)).toBe(false)
  })
})

describe('canTeach', () => {
  it('needs approval and the teaching switch both', () => {
    expect(canTeach(p('professor', 'active', true))).toBe(true)
    expect(canTeach(p('professor', 'active', false))).toBe(false)
    expect(canTeach(p('professor', 'pending', true))).toBe(false)
    expect(canTeach(p('student', 'active', true))).toBe(false)
  })
})
