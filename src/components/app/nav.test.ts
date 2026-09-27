import { describe, expect, it } from 'vitest'
import { navFor } from './nav'
import type { NavGroup } from './nav'
import type { AccountStatus, Role } from '../../lib/types'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))
const titles = (groups: NavGroup[]) => groups.map((g) => g.title)
const tos = (groups: NavGroup[]) =>
  groups.flatMap((g) => [...g.items.map((i) => i.to), ...(g.more ? [g.more.to] : [])])
const spaces = (groups: NavGroup[]) => groups.find((g) => g.title === 'Spaces')

const account = (role: Role | null, status: AccountStatus = 'active', can_teach = false) => ({
  role,
  status,
  can_teach,
})
const student = account('student')
const teacher = account('faculty', 'active', true)
const nonTeacher = account('faculty')
const admin = account('admin')

describe('navFor', () => {
  it('gives a student nobody has let in only Home and Settings', () => {
    expect(labels(navFor(student, false))).toEqual(['Home', 'Settings'])
  })

  it('gives a student with only classes Main, Classes with Your record, and Account', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Main', 'Classes', 'Account'])
    expect(labels(groups)).toContain('Your record')
    expect(titles(navFor(student, true))).toEqual(['Main', 'Classes', 'Account'])
  })

  it('adds Spaces and Projects once a student is invited to some work', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: true })
    expect(titles(groups)).toEqual(['Main', 'Classes', 'Spaces', 'Projects', 'Account'])
    expect(spaces(groups)?.hideWhenEmpty).toBe(true)
  })

  it('gives teaching faculty Classes and Teaching, and no Your record', () => {
    const groups = navFor(teacher, true)
    expect(titles(groups)).toEqual(['Main', 'Classes', 'Spaces', 'Projects', 'Teaching', 'Account'])
    expect(labels(groups)).not.toContain('Your record')
  })

  it('gives faculty who do not teach no Classes and no Teaching', () => {
    expect(titles(navFor(nonTeacher, true))).toEqual(['Main', 'Spaces', 'Projects', 'Account'])
  })

  it('never narrows faculty on the admission flag', () => {
    expect(titles(navFor(teacher, false))).toContain('Classes')
  })

  it('gives an admin in nothing only Admin and Account', () => {
    const none = { inClass: false, hasWork: false }
    expect(titles(navFor(admin, true, none))).toEqual(['Admin', 'Account'])
    expect(titles(navFor(admin, true))).toEqual(['Admin', 'Account'])
    expect(labels(navFor(admin, true, none))).toContain('Faculty approvals')
  })

  it('gives an admin in nothing but invited Home and Inbox, so they can answer', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: false, invited: true })
    expect(titles(groups)).toEqual(['Main', 'Admin', 'Account'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['Home', 'Inbox'])
  })

  it('calls the conversations page Inbox for everyone', () => {
    for (const who of [student, teacher, nonTeacher, admin]) {
      const main = navFor(who, true, { inClass: true, hasWork: true })[0]
      expect(main.items.find((i) => i.to === '/inbox')?.label).toBe('Inbox')
    }
  })

  it('gives an admin in work Main, Spaces and Projects, and never Classes', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: true })
    expect(titles(groups)).toEqual(['Main', 'Spaces', 'Projects', 'Admin', 'Account'])
  })

  it('lists an admin\'s classes under Spaces once one invites them', () => {
    const groups = navFor(admin, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Main', 'Spaces', 'Projects', 'Admin', 'Account'])
    expect(spaces(groups)?.withClasses).toBe(true)
  })

  it('lists classes under Spaces for faculty who do not teach, not for those who do', () => {
    expect(spaces(navFor(nonTeacher, true))?.withClasses).toBe(true)
    expect(spaces(navFor(teacher, true))?.withClasses).toBe(false)
    expect(spaces(navFor(student, true, { inClass: true, hasWork: true }))?.withClasses).toBe(false)
  })

  it('hides an empty Spaces only for accounts that cannot open a class', () => {
    expect(spaces(navFor(nonTeacher, true))?.hideWhenEmpty).toBe(true)
    expect(spaces(navFor(teacher, true))?.hideWhenEmpty).toBe(false)
    expect(spaces(navFor(admin, true, { inClass: false, hasWork: true }))?.hideWhenEmpty).toBe(true)
  })

  it('never hides Projects', () => {
    for (const who of [student, teacher, nonTeacher]) {
      expect(navFor(who, true, { inClass: true, hasWork: true }).find((g) => g.title === 'Projects')?.hideWhenEmpty).toBeFalsy()
    }
  })

  it('gives an account with no role, or one not active, only Settings', () => {
    expect(labels(navFor(account(null, 'pending'), true))).toEqual(['Settings'])
    expect(labels(navFor(account('faculty', 'pending', true), true))).toEqual(['Settings'])
    expect(labels(navFor(null, true))).toEqual(['Settings'])
  })

  it('routes every item through one of the allowed prefixes', () => {
    const allowed = [
      '/home',
      '/tasks',
      '/calendar',
      '/inbox',
      '/settings',
      '/spaces',
      '/projects',
      '/classes',
      '/groups',
      '/class-projects',
      '/record',
      '/teaching/',
      '/admin/',
    ]
    for (const who of [student, teacher, nonTeacher, admin]) {
      for (const to of tos(navFor(who, true, { inClass: true, hasWork: true }))) {
        expect(allowed.some((prefix) => to?.startsWith(prefix))).toBe(true)
      }
    }
  })
})
