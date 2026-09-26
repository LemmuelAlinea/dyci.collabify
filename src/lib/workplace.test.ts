import { describe, expect, it } from 'vitest'
import { educationHome, homeFor, settingsPathFor, workplaceOf } from './workplace'

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

  it('keeps the admin on the console', () => {
    expect(homeFor(p('admin', 'active', 'education'))).toBe('/admin')
  })

  it('lands an admitted account in its home workplace', () => {
    expect(homeFor(p('student', 'active', 'education'))).toBe('/student')
    expect(homeFor(p('professor', 'active', 'general'))).toBe('/general')
  })
})

describe('educationHome', () => {
  it('parks anybody not yet admitted', () => {
    expect(educationHome(p(null, 'active', 'general'))).toBe('/pending')
    expect(educationHome(p('professor', 'pending', 'general'))).toBe('/pending')
  })

  it('opens an approved professor', () => {
    expect(educationHome(p('professor', 'active', 'general'))).toBe('/professor')
  })
})

describe('workplaceOf', () => {
  it('reads General from its own section', () => {
    expect(workplaceOf('/general', 'education')).toBe('general')
    expect(workplaceOf('/general/projects/abc', 'education')).toBe('general')
    expect(workplaceOf('/general/settings', 'education')).toBe('general')
  })

  it('does not mistake a lookalike path for General', () => {
    expect(workplaceOf('/generally', 'education')).toBe('education')
  })

  it('reads Education from the role sections', () => {
    expect(workplaceOf('/student/tasks', 'general')).toBe('education')
    expect(workplaceOf('/student/settings', 'general')).toBe('education')
    expect(workplaceOf('/professor', 'general')).toBe('education')
  })

  it('uses the home workplace on shared pages', () => {
    expect(workplaceOf('/settings', 'general')).toBe('general')
    expect(workplaceOf('/privacy/request', 'education')).toBe('education')
  })
})

describe('settingsPathFor', () => {
  it('keeps Settings in the active workplace when possible', () => {
    expect(settingsPathFor('general', 'student')).toBe('/general/settings')
    expect(settingsPathFor('education', 'student')).toBe('/student/settings')
    expect(settingsPathFor('education', 'professor')).toBe('/professor/settings')
    expect(settingsPathFor('education', 'admin')).toBe('/admin/settings')
    expect(settingsPathFor('education', null)).toBe('/settings')
  })
})
