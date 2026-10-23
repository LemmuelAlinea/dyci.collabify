import { describe, expect, it } from 'vitest'
import {
  canManageProjects,
  canTeach,
  homeFor,
  inAnyClass,
  isMember,
  isMemberRole,
  membershipOf,
  showsClassScope,
} from './access'
import type { GeneralProjectSummary, GeneralSpaceSummary } from './general/types'
import type { Role } from './types'

const p = (
  role: Role | null,
  status: 'active' | 'pending' | 'rejected',
  can_teach = false,
  can_manage_projects?: boolean,
) => ({ role, status, can_teach, can_manage_projects })

describe('isMemberRole', () => {
  it('is a member, or the legacy faculty role it replaces', () => {
    expect(isMemberRole('member')).toBe(true)
    expect(isMemberRole('faculty')).toBe(true)
    expect(isMemberRole('student')).toBe(false)
    expect(isMemberRole('admin')).toBe(false)
    expect(isMemberRole(null)).toBe(false)
    expect(isMemberRole(undefined)).toBe(false)
  })
})

describe('isMember', () => {
  it('admits an approved member, and legacy faculty', () => {
    expect(isMember(p('member', 'active'))).toBe(true)
    expect(isMember(p('faculty', 'active'))).toBe(true)
  })

  it('keeps out students, the admin, deactivated accounts and nobody', () => {
    expect(isMember(p('student', 'active'))).toBe(false)
    expect(isMember(p('admin', 'active'))).toBe(false)
    expect(isMember(p('member', 'rejected'))).toBe(false)
    expect(isMember(p('member', 'pending'))).toBe(false)
    expect(isMember(p(null, 'active'))).toBe(false)
    expect(isMember(null)).toBe(false)
  })
})

describe('canTeach', () => {
  it('needs approval and the teaching switch both', () => {
    expect(canTeach(p('member', 'active', true))).toBe(true)
    expect(canTeach(p('member', 'active', false))).toBe(false)
    expect(canTeach(p('member', 'pending', true))).toBe(false)
    expect(canTeach(p('faculty', 'active', true))).toBe(true)
    expect(canTeach(p('student', 'active', true))).toBe(false)
    expect(canTeach(p('admin', 'active', true))).toBe(false)
  })
})

describe('canManageProjects', () => {
  it('needs the project manager switch, for a member or the admin', () => {
    expect(canManageProjects(p('member', 'active', false, true))).toBe(true)
    expect(canManageProjects(p('member', 'active', false, false))).toBe(false)
    expect(canManageProjects(p('admin', 'active', false, true))).toBe(true)
    expect(canManageProjects(p('admin', 'active', false, false))).toBe(false)
    expect(canManageProjects(p('student', 'active', false, true))).toBe(false)
  })

  it('keeps out an account that is not active, and nobody', () => {
    expect(canManageProjects(p('member', 'pending', false, true))).toBe(false)
    expect(canManageProjects(null)).toBe(false)
  })

  it('lets legacy faculty and admins manage until the column exists', () => {
    expect(canManageProjects(p('admin', 'active'))).toBe(true)
    expect(canManageProjects(p('admin', 'pending'))).toBe(false)
    expect(canManageProjects(p('member', 'active'))).toBe(false)
    expect(canManageProjects(p('faculty', 'active'))).toBe(true)
    expect(canManageProjects(p('faculty', 'active', false, false))).toBe(false)
    expect(canManageProjects(p('faculty', 'pending'))).toBe(false)
  })
})

describe('homeFor', () => {
  it('sends somebody with no profile to onboarding', () => {
    expect(homeFor(null)).toBe('/onboarding')
  })

  it('stops inactive accounts at the door', () => {
    expect(homeFor(p('student', 'rejected'))).toBe('/pending')
    expect(homeFor(p(null, 'rejected'))).toBe('/pending')
    expect(homeFor(p('member', 'pending'))).toBe('/pending')
  })

  it('parks an old account that never got a role', () => {
    expect(homeFor(p(null, 'active'))).toBe('/pending')
  })

  it('lands any admitted account on the one dashboard', () => {
    expect(homeFor(p('admin', 'active'))).toBe('/home')
    expect(homeFor(p('student', 'active'))).toBe('/home')
    expect(homeFor(p('member', 'active'))).toBe('/home')
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

  it('offers it to members only once they are in a class, teaching or not', () => {
    expect(showsClassScope(p('member', 'active', true), work)).toBe(false)
    expect(showsClassScope(p('member', 'active', true), cls)).toBe(true)
    expect(showsClassScope(p('member', 'active'), cls)).toBe(true)
    expect(showsClassScope(p('faculty', 'active'), cls)).toBe(true)
  })

  it('offers it to admins only once someone invites them into a class', () => {
    expect(showsClassScope(p('admin', 'active'), work)).toBe(false)
    expect(showsClassScope(p('admin', 'active'), cls)).toBe(true)
  })

  it('offers it to nobody while membership is still loading', () => {
    expect(showsClassScope(p('student', 'active'), undefined)).toBe(false)
    expect(showsClassScope(p('member', 'active'), undefined)).toBe(false)
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
