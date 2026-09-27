import { describe, expect, it } from 'vitest'
import { legacyPath, paths } from './paths'

describe('paths', () => {
  it('builds the short routes', () => {
    expect(paths.home).toBe('/home')
    expect(paths.conversation('c1')).toBe('/inbox/c1')
    expect(paths.space('s1')).toBe('/spaces/s1')
    expect(paths.spaceReports('s1')).toBe('/spaces/s1/reports')
    expect(paths.project('p1')).toBe('/projects/p1')
    expect(paths.classProject('p1')).toBe('/class-projects/p1')
    expect(paths.class('k1')).toBe('/classes/k1')
    expect(paths.group('g1')).toBe('/groups/g1')
    expect(paths.syllabus('r1')).toBe('/teaching/syllabi/r1')
    expect(paths.admin.approvals).toBe('/admin/approvals')
  })
})

describe('legacyPath', () => {
  it('sends every old home to /home', () => {
    for (const old of ['/student', '/professor', '/general', '/admin', '/student/', '/education/enter']) {
      expect(legacyPath(old, 'student')).toBe('/home')
    }
  })

  it('sends every old settings page to /settings', () => {
    for (const old of ['/student/settings', '/professor/settings', '/admin/settings', '/general/settings']) {
      expect(legacyPath(old, null)).toBe('/settings')
    }
  })

  it('drops the General prefix for the allowlisted sections', () => {
    expect(legacyPath('/general/spaces/s1/members', null)).toBe('/spaces/s1/members')
    expect(legacyPath('/general/projects/p1', null)).toBe('/projects/p1')
    expect(legacyPath('/general/messages/c1', null)).toBe('/inbox/c1')
  })

  it('sends anything else under General home, rather than guess at it', () => {
    expect(legacyPath('/general/foo', null)).toBe('/home')
    // Old space-less /teams links had no page of their own to land on either.
    expect(legacyPath('/general/teams', null)).toBe('/home')
    expect(legacyPath('/general/teams/archive', null)).toBe('/home')
  })

  it('matches the old prefixes case-insensitively, keeping the rest as typed', () => {
    expect(legacyPath('/Student/Classes/k1', null)).toBe('/classes/k1')
    expect(legacyPath('/student/classes/k1/', null)).toBe('/classes/k1')
    expect(legacyPath('/general/projects/p1/archive', null)).toBe('/projects/p1/archive')
    expect(legacyPath('/general/spaces/s1/teams/archive', null)).toBe('/spaces/s1/teams/archive')
    expect(legacyPath('/professor/projects/p1/extra', null)).toBe('/home')
    expect(legacyPath('/admin/settings/', null)).toBe('/settings')
  })

  it('maps the class side', () => {
    expect(legacyPath('/student/classes/k1', 'student')).toBe('/classes/k1')
    expect(legacyPath('/professor/groups/g1', 'professor')).toBe('/groups/g1')
    expect(legacyPath('/student/projects', 'student')).toBe('/class-projects')
    expect(legacyPath('/professor/projects/p1', 'professor')).toBe('/class-projects/p1')
    expect(legacyPath('/student/tasks', 'student')).toBe('/tasks')
    expect(legacyPath('/professor/calendar', 'professor')).toBe('/calendar')
    expect(legacyPath('/student/messages/c1', 'student')).toBe('/inbox/c1')
  })

  it('splits the two reports pages by whose they were', () => {
    expect(legacyPath('/student/reports', 'student')).toBe('/record')
    expect(legacyPath('/professor/reports', 'professor')).toBe('/teaching/reports')
  })

  it('moves the faculty pages under /teaching', () => {
    expect(legacyPath('/professor/submissions', 'professor')).toBe('/teaching/submissions')
    expect(legacyPath('/professor/syllabi/r1', 'professor')).toBe('/teaching/syllabi/r1')
    expect(legacyPath('/professor/curriculum', 'professor')).toBe('/teaching/curriculum')
    expect(legacyPath('/professor/privacy', 'professor')).toBe('/privacy/queue')
  })

  it('leaves new and admin pages alone', () => {
    expect(legacyPath('/home', 'student')).toBeNull()
    expect(legacyPath('/admin/approvals', 'admin')).toBeNull()
    expect(legacyPath('/studentish', 'student')).toBeNull()
  })

  it('sends an unknown old page home rather than to a 404', () => {
    expect(legacyPath('/student/nothing-here', 'student')).toBe('/home')
  })
})
