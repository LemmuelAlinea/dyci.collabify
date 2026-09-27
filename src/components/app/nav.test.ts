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

  it('gives an admitted student Main, Classes with Your record, Spaces, Projects and Account', () => {
    const groups = navFor(student, true)
    expect(titles(groups)).toEqual(['Main', 'Classes', 'Spaces', 'Projects', 'Account'])
    expect(labels(groups)).toContain('Your record')
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

  it('gives an admin Admin with Faculty approvals, and no Classes', () => {
    const groups = navFor(admin, true)
    expect(titles(groups)).toEqual(['Main', 'Spaces', 'Projects', 'Admin', 'Account'])
    expect(labels(groups)).toContain('Faculty approvals')
  })

  it('hides an empty Spaces only for accounts that cannot open a class', () => {
    expect(spaces(navFor(student, true))?.hideWhenEmpty).toBe(true)
    expect(spaces(navFor(nonTeacher, true))?.hideWhenEmpty).toBe(true)
    expect(spaces(navFor(teacher, true))?.hideWhenEmpty).toBe(false)
    expect(spaces(navFor(admin, true))?.hideWhenEmpty).toBe(false)
  })

  it('never hides Projects', () => {
    for (const who of [student, teacher, nonTeacher, admin]) {
      expect(navFor(who, true).find((g) => g.title === 'Projects')?.hideWhenEmpty).toBeFalsy()
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
      '/messages',
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
      for (const to of tos(navFor(who, true))) {
        expect(allowed.some((prefix) => to?.startsWith(prefix))).toBe(true)
      }
    }
  })
})
