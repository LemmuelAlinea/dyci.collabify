import { describe, expect, it } from 'vitest'
import { SKILL_LIMIT, mayEditSkills, normalizeTag, skillProblem } from './skills'
import type { GeneralPermission, ProjectRole } from './permissions'

describe('normalizeTag', () => {
  it('trims and collapses inner spaces', () => {
    expect(normalizeTag('  UI   design ')).toBe('UI design')
  })

  it('answers null for an empty tag', () => {
    expect(normalizeTag('   ')).toBeNull()
  })

  it('answers null past 40 characters', () => {
    expect(normalizeTag('a'.repeat(41))).toBeNull()
    expect(normalizeTag('a'.repeat(40))).toBe('a'.repeat(40))
  })
})

describe('skillProblem', () => {
  it('refuses a duplicate, ignoring case', () => {
    expect(skillProblem(['Figma'], 'figma')).toBe('That skill is already there.')
  })

  it('refuses a 13th skill', () => {
    const twelve = Array.from({ length: SKILL_LIMIT }, (_, i) => `Skill ${i}`)
    expect(skillProblem(twelve, 'React')).toBe('Up to 12 skills each.')
  })

  it('refuses a tag that is too long', () => {
    expect(skillProblem([], 'a'.repeat(41))).toBe('Keep a skill to 40 characters or fewer.')
  })

  it('passes a new tag', () => {
    expect(skillProblem(['Figma'], 'React')).toBeNull()
  })
})

const viewer = (
  id: string,
  role: ProjectRole | null,
  perms: GeneralPermission[] = [],
  readOnly = false,
) => ({ id, role, readOnly, can: (p: GeneralPermission) => perms.includes(p) })

describe('mayEditSkills', () => {
  it('lets a member edit their own skills', () => {
    expect(mayEditSkills(viewer('a', 'member'), { userId: 'a', role: 'member' })).toBe(true)
  })

  it("does not let a member edit another member's skills", () => {
    expect(mayEditSkills(viewer('a', 'member'), { userId: 'b', role: 'member' })).toBe(false)
  })

  it("lets a coordinator who manages tasks edit another member's skills", () => {
    expect(
      mayEditSkills(viewer('a', 'coordinator', ['manage_tasks']), { userId: 'b', role: 'member' }),
    ).toBe(true)
  })

  it('lets a member granted manage_structure edit others', () => {
    expect(
      mayEditSkills(viewer('a', 'member', ['manage_structure']), { userId: 'b', role: 'coordinator' }),
    ).toBe(true)
  })

  it('refuses a QA or stakeholder target for anyone', () => {
    const pm = viewer('a', 'pm', ['manage_tasks', 'manage_structure'])
    expect(mayEditSkills(pm, { userId: 'b', role: 'qa' })).toBe(false)
    expect(mayEditSkills(pm, { userId: 'b', role: 'stakeholder' })).toBe(false)
  })

  it('refuses a read-only viewer', () => {
    expect(
      mayEditSkills(viewer('a', 'pm', ['manage_tasks'], true), { userId: 'a', role: 'pm' }),
    ).toBe(false)
  })

  it('refuses a QA viewer on themselves', () => {
    expect(mayEditSkills(viewer('a', 'qa'), { userId: 'a', role: 'qa' })).toBe(false)
    // Even if the row's role were stale, QA editing "self" stays refused.
    expect(mayEditSkills(viewer('a', 'qa'), { userId: 'a', role: 'member' })).toBe(false)
  })

  it('refuses a viewer who is not signed in', () => {
    expect(
      mayEditSkills({ id: undefined, role: null, readOnly: false, can: () => false }, { userId: 'a', role: 'member' }),
    ).toBe(false)
  })
})
