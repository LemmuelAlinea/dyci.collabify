import { describe, expect, it } from 'vitest'
import { homeFor } from './workplace'

const p = (
  role: 'student' | 'professor' | 'admin' | null,
  status: 'active' | 'pending' | 'rejected',
  home_workplace: 'education' | 'general',
) => ({ role, status, home_workplace })

describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops a deactivated account at the door, whichever workplace', () => {
    expect(homeFor(p('student', 'rejected', 'education'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected', 'general'))).toBe('/pending')
  })

  it('parks faculty waiting on the admin, whichever workplace they last used', () => {
    expect(homeFor(p('professor', 'pending', 'general'))).toBe('/pending')
    expect(homeFor(p('professor', 'pending', 'education'))).toBe('/pending')
  })

  it('parks an old account that never got a role', () => {
    expect(homeFor(p(null, 'active', 'general'))).toBe('/pending')
    expect(homeFor(p(null, 'active', 'education'))).toBe('/pending')
  })

  it('lands any admitted account on the one dashboard', () => {
    expect(homeFor(p('admin', 'active', 'education'))).toBe('/home')
    expect(homeFor(p('student', 'active', 'education'))).toBe('/home')
    expect(homeFor(p('professor', 'active', 'general'))).toBe('/home')
  })
})
