import { describe, expect, it } from 'vitest'
import { educationHome, homeFor, workplaceOf } from './workplace'

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

  it('keeps the admin on the console', () => {
    expect(homeFor(p('admin', 'active', 'education'))).toBe('/admin')
  })

  it('lands a General account in General, even as a pending professor', () => {
    expect(homeFor(p(null, 'active', 'general'))).toBe('/general')
    expect(homeFor(p('professor', 'pending', 'general'))).toBe('/general')
  })

  it('lands an Education account where it always did', () => {
    expect(homeFor(p('student', 'active', 'education'))).toBe('/student')
    expect(homeFor(p('professor', 'pending', 'education'))).toBe('/pending')
    expect(homeFor(p(null, 'active', 'education'))).toBe('/education/enter')
  })
})

describe('educationHome', () => {
  it('asks for a role before anything else', () => {
    expect(educationHome(p(null, 'active', 'general'))).toBe('/education/enter')
  })

  it('parks a pending professor and opens an approved one', () => {
    expect(educationHome(p('professor', 'pending', 'general'))).toBe('/pending')
    expect(educationHome(p('professor', 'active', 'general'))).toBe('/professor')
  })
})

describe('workplaceOf', () => {
  it('reads General from its own section', () => {
    expect(workplaceOf('/general', 'education')).toBe('general')
    expect(workplaceOf('/general/projects/abc', 'education')).toBe('general')
  })

  it('does not mistake a lookalike path for General', () => {
    expect(workplaceOf('/generally', 'education')).toBe('education')
  })

  it('reads Education from the role sections', () => {
    expect(workplaceOf('/student/tasks', 'general')).toBe('education')
    expect(workplaceOf('/professor', 'general')).toBe('education')
    expect(workplaceOf('/education/enter', 'general')).toBe('education')
  })

  it('uses the home workplace on shared pages', () => {
    expect(workplaceOf('/settings', 'general')).toBe('general')
    expect(workplaceOf('/privacy/request', 'education')).toBe('education')
  })
})
