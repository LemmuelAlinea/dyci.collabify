import { describe, expect, it } from 'vitest'
import { navFor } from './nav'
import type { NavGroup } from './nav'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))
const tos = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.to))

describe('navFor', () => {
  it('gives a student nobody has let in only Home and Settings', () => {
    expect(labels(navFor({ role: 'student', status: 'active' }, false))).toEqual([
      'Home',
      'Settings',
    ])
  })

  it('gives an admitted student Main, Classes with Your record, and Account, no Teaching or Admin', () => {
    const groups = navFor({ role: 'student', status: 'active' }, true)
    const titles = groups.map((g) => g.title)
    expect(titles).toEqual(['Main', 'Classes', 'Account'])
    expect(labels(groups)).toContain('Your record')
    expect(titles).not.toContain('Teaching')
    expect(titles).not.toContain('Admin')
  })

  it('gives a professor Teaching, and no Your record', () => {
    const groups = navFor({ role: 'faculty', status: 'active' }, true)
    const titles = groups.map((g) => g.title)
    expect(titles).toContain('Teaching')
    expect(labels(groups)).not.toContain('Your record')
  })

  it('never narrows faculty on the admission flag', () => {
    expect(labels(navFor({ role: 'faculty', status: 'active' }, false))).toContain('Classes')
  })

  it('gives an admin Admin with Faculty approvals, and no Classes', () => {
    const groups = navFor({ role: 'admin', status: 'active' }, true)
    const titles = groups.map((g) => g.title)
    expect(labels(groups)).toContain('Faculty approvals')
    expect(titles).not.toContain('Classes')
  })

  it('gives an account with no role, or one not active, only Settings', () => {
    expect(labels(navFor({ role: null, status: 'pending' }, true))).toEqual(['Settings'])
    expect(labels(navFor({ role: 'faculty', status: 'pending' }, true))).toEqual(['Settings'])
    expect(labels(navFor(null, true))).toEqual(['Settings'])
  })

  it('routes every item through one of the allowed prefixes', () => {
    const allowed = [
      '/home',
      '/tasks',
      '/calendar',
      '/messages',
      '/settings',
      '/classes',
      '/groups',
      '/class-projects',
      '/record',
      '/teaching/',
      '/admin/',
    ]
    const everyone = [
      navFor({ role: 'student', status: 'active' }, true),
      navFor({ role: 'faculty', status: 'active' }, true),
      navFor({ role: 'admin', status: 'active' }, true),
    ]
    for (const groups of everyone) {
      for (const to of tos(groups)) {
        expect(allowed.some((prefix) => to?.startsWith(prefix))).toBe(true)
      }
    }
  })
})
