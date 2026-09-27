import { describe, expect, it } from 'vitest'
import { canTeach, homeFor, inAnyClass, isFaculty, membershipOf, showsClassScope } from './access'
import type { GeneralProjectSummary, GeneralSpaceSummary } from './general/types'

const p = (
  role: 'student' | 'faculty' | 'admin' | null,
  status: 'active' | 'pending' | 'rejected',
  can_teach = false,
) => ({ role, status, can_teach })

describe('isFaculty', () => {
  it('admits approved faculty and the admin', () => {
    expect(isFaculty(p('faculty', 'active'))).toBe(true)
    expect(isFaculty(p('admin', 'active'))).toBe(true)
  })

  it('keeps out students, waiting faculty, deactivated accounts and nobody', () => {
    expect(isFaculty(p('student', 'active'))).toBe(false)
    expect(isFaculty(p('faculty', 'pending'))).toBe(false)
    expect(isFaculty(p('faculty', 'rejected'))).toBe(false)
    expect(isFaculty(p(null, 'active'))).toBe(false)
    expect(isFaculty(null)).toBe(false)
  })
})

describe('canTeach', () => {
  it('needs approval and the teaching switch both', () => {
    expect(canTeach(p('faculty', 'active', true))).toBe(true)
    expect(canTeach(p('faculty', 'active', false))).toBe(false)
    expect(canTeach(p('faculty', 'pending', true))).toBe(false)
    expect(canTeach(p('student', 'active', true))).toBe(false)
    expect(canTeach(p('admin', 'active', true))).toBe(false)
  })
})

describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops inactive accounts at the door', () => {
    expect(homeFor(p('student', 'rejected'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected'))).toBe('/pending')
    expect(homeFor(p('faculty', 'pending'))).toBe('/pending')
  })

  it('parks an old account that never got a role', () => {
    expect(homeFor(p(null, 'active'))).toBe('/pending')
  })

  it('lands any admitted account on the one dashboard', () => {
    expect(homeFor(p('admin', 'active'))).toBe('/home')
    expect(homeFor(p('student', 'active'))).toBe('/home')
    expect(homeFor(p('faculty', 'active'))).toBe('/home')
  })
})

const classSpace = { kind: 'education' as const, my_level: 'manager' as const }
const workSpace = { kind: 'work' as const, my_level: 'owner' as const }

describe('inAnyClass', () => {
  it('is true only for a class space the account is in', () => {
    expect(inAnyClass([workSpace, classSpace])).toBe(true)
    expect(inAnyClass([workSpace])).toBe(false)
    expect(inAnyClass([{ ...classSpace, my_level: null }])).toBe(false)
    expect(inAnyClass(null)).toBe(false)
  })
})

describe('showsClassScope', () => {
  const none = { inClass: false, hasWork: false }
  const work = { inClass: false, hasWork: true }
  const cls = { inClass: true, hasWork: false }

  it('offers it to a student only once they have some work', () => {
    expect(showsClassScope(p('student', 'active'), none)).toBe(false)
    expect(showsClassScope(p('student', 'active'), work)).toBe(true)
  })

  it('offers it to faculty only once they are in a class, teaching or not', () => {
    expect(showsClassScope(p('faculty', 'active', true), work)).toBe(false)
    expect(showsClassScope(p('faculty', 'active', true), cls)).toBe(true)
    expect(showsClassScope(p('faculty', 'active'), cls)).toBe(true)
  })

  it('offers it to admins only once someone invites them into a class', () => {
    expect(showsClassScope(p('admin', 'active'), work)).toBe(false)
    expect(showsClassScope(p('admin', 'active'), cls)).toBe(true)
  })

  it('offers it to nobody while membership is still loading', () => {
    expect(showsClassScope(p('student', 'active'), undefined)).toBe(false)
    expect(showsClassScope(p('faculty', 'active'), undefined)).toBe(false)
  })
})

describe('membershipOf', () => {
  const project = (my_level: 'member' | null, archived_at: string | null = null) =>
    ({ my_level, archived_at }) as unknown as GeneralProjectSummary
  const space = (kind: 'work' | 'education', archived_at: string | null = null) =>
    ({ kind, my_level: 'member', archived_at }) as unknown as GeneralSpaceSummary

  it('is undefined while either list loads', () => {
    expect(membershipOf(null, [])).toBeUndefined()
    expect(membershipOf([], null)).toBeUndefined()
  })

  it('counts a live work space or a live project as work', () => {
    expect(membershipOf([space('work')], [])?.hasWork).toBe(true)
    expect(membershipOf([], [project('member')])?.hasWork).toBe(true)
    expect(membershipOf([space('work', '2026-01-01')], [project('member', '2026-01-01')])?.hasWork).toBe(false)
    expect(membershipOf([space('education')], [])).toEqual({ inClass: true, hasWork: false })
  })
})
