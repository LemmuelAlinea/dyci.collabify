import { describe, expect, it } from 'vitest'
import { navForWorkplace } from './nav'
import type { NavGroup } from './nav'

const labels = (groups: NavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label))

describe('navForWorkplace', () => {
  it('gives a student nobody has let in only the dashboard and settings', () => {
    expect(labels(navForWorkplace('education', 'student', false))).toEqual(['Dashboard', 'Settings'])
  })

  it('gives an admitted student the whole rail', () => {
    expect(labels(navForWorkplace('education', 'student', true))).toContain('Classes')
    expect(labels(navForWorkplace('education', 'student'))).toContain('My tasks')
  })

  it('never narrows faculty on the admission flag', () => {
    expect(labels(navForWorkplace('education', 'professor', false))).toContain('Classes')
  })

  it('calls the approval queue by what it approves', () => {
    expect(labels(navForWorkplace('education', 'admin'))).toContain('Faculty approvals')
  })

  it('keeps settings inside the workplace', () => {
    const settings = navForWorkplace('education', 'student', false).at(-1)?.items[0]
    expect(settings?.to).toBe('/student/settings')
  })
})
