import { describe, expect, it } from 'vitest'
import { canTeach, homeFor, isFaculty } from './access'

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

describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops inactive accounts at the door', () => {
    expect(homeFor(p('student', 'rejected'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected'))).toBe('/pending')
    expect(homeFor(p('professor', 'pending'))).toBe('/pending')
  })

  it('parks an old account that never got a role', () => {
    expect(homeFor(p(null, 'active'))).toBe('/pending')
  })

  it('lands any admitted account on the one dashboard', () => {
    expect(homeFor(p('admin', 'active'))).toBe('/home')
    expect(homeFor(p('student', 'active'))).toBe('/home')
    expect(homeFor(p('professor', 'active'))).toBe('/home')
  })
})
