import { describe, expect, it } from 'vitest'
import { navFor } from './nav'
import type { NavGroup } from './nav'
import type { AccountStatus, Role } from '../../lib/types'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))
const titles = (groups: NavGroup[]) => groups.map((g) => g.title)
const tos = (groups: NavGroup[]) =>
  groups.flatMap((g) => [...g.items.map((i) => i.to), ...(g.more ? [g.more.to] : [])])
const places = (groups: NavGroup[]) => groups.find((g) => g.picker)
const spaces = (groups: NavGroup[]) => groups.find((g) => g.picker?.includes('spaces'))
const section = (groups: NavGroup[], title: string) =>
  groups.find((g) => g.title === title)?.items.map((i) => i.label)

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
  it('puts Archive between Settings and Trash for everyone admitted, the program archive for admins', () => {
    const account = (groups: NavGroup[]) => section(groups, 'Account')
    expect(account(navFor(student, true, { inClass: true, hasWork: false }))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(teacher, true))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(nonTeacher, true))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(admin, true, { inClass: false, hasWork: true }))).toEqual(['Settings', 'Archive', 'Trash'])
    expect(account(navFor(admin, true))).toEqual(['Settings', 'Archive', 'Trash'])
    const adminArchive = navFor(admin, true).find((g) => g.title === 'Account')!.items[1]
    expect(adminArchive.to).toBe('/admin/archive')
    expect(account(navFor(student, false))).toEqual(['Settings', 'Trash'])
  })

  it('gives a student nobody has let in only Home, Settings and Trash', () => {
    expect(labels(navFor(student, false))).toEqual(['Home', 'Settings', 'Trash'])
  })

  it('opens a student with only classes on a Classes card, Your record under Resources', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Classes', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
    expect(places(groups)?.picker).toEqual(['classes'])
    expect(section(groups, 'Resources')).toEqual(['Your record'])
    expect(titles(navFor(student, true))).toEqual(['Classes', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
  })

  it('adds Spaces after Classes on the card once a student is invited to some work', () => {
    const groups = navFor(student, true, { inClass: true, hasWork: true })
    expect(titles(groups)).toEqual(['Classes & spaces', 'Overview', 'Main', 'Quick access', 'Resources', 'Account'])
    expect(places(groups)?.picker).toEqual(['classes', 'spaces'])
    expect(spaces(groups)?.hideWhenEmpty).toBe(true)
  })

  it('opens teaching faculty on a card with Spaces first, with Teaching and Resources and no Your record', () => {
    const groups = navFor(teacher, true)
    expect(titles(groups)).toEqual([
      'Classes & spaces',
      'Overview',
      'Main',
      'Quick access',
      'Teaching',
      'Resources',
      'Account',
    ])
    expect(places(groups)?.picker).toEqual(['spaces', 'classes'])
    expect(section(groups, 'Teaching')).toEqual(['Submissions', 'Reassignments', 'Analytics', 'Reports'])
    expect(section(groups, 'Resources')).toEqual(['Syllabi', 'Curriculum'])
    expect(labels(groups)).not.toContain('Your record')
  })

  it('opens faculty who do not teach on Spaces, with no Classes, Teaching or Groups', () => {
    const groups = navFor(nonTeacher, true)
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Account'])
    expect(section(groups, 'Main')).toEqual(['My tasks', 'Projects', 'Meetings'])
  })

  it('never narrows faculty on the admission flag', () => {
    expect(places(navFor(teacher, false))?.picker).toContain('classes')
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

  it('splits the spine into Overview and Main', () => {
    const groups = navFor(student, true)
    expect(section(groups, 'Overview')).toEqual(['Home', 'Inbox', 'Calendar'])
    expect(section(groups, 'Main')).toEqual(['My tasks', 'Projects', 'Groups', 'Meetings'])
  })

  it('calls the conversations page Inbox for everyone', () => {
    for (const who of [student, teacher, nonTeacher, admin]) {
      const overview = navFor(who, true, { inClass: true, hasWork: true }).find((g) => g.title === 'Overview')!
      expect(overview.items.find((i) => i.to === '/inbox')?.label).toBe('Inbox')
    }
  })

  it('gives an admin in work the non-teaching faculty rail with Admin, and never Classes', () => {
    const groups = navFor(admin, true, { inClass: false, hasWork: true })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Admin', 'Account'])
  })

  it('lists an admin\'s classes under Spaces once one invites them', () => {
    const groups = navFor(admin, true, { inClass: true, hasWork: false })
    expect(titles(groups)).toEqual(['Spaces', 'Overview', 'Main', 'Quick access', 'Admin', 'Account'])
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

  it('fills Quick access with recent projects and hides it while there are none', () => {
    for (const who of [student, teacher, nonTeacher]) {
      const quick = navFor(who, true, { inClass: true, hasWork: true }).find((g) => g.title === 'Quick access')
      expect(quick?.live).toBe('recent')
      expect(quick?.hideWhenEmpty).toBe(true)
    }
  })

  it('gives an account with no role, or one not active, only Settings and Trash', () => {
    expect(labels(navFor(account(null, 'pending'), true))).toEqual(['Settings', 'Trash'])
    expect(labels(navFor(account('faculty', 'pending', true), true))).toEqual(['Settings', 'Trash'])
    expect(labels(navFor(null, true))).toEqual(['Settings', 'Trash'])
  })

  it('routes every item through one of the allowed prefixes', () => {
    const allowed = [
      '/home',
      '/tasks',
      '/calendar',
      '/meetings',
      '/inbox',
      '/settings',
      '/trash',
      '/archive',
      '/spaces',
      '/projects',
      '/classes',
      '/groups',
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
