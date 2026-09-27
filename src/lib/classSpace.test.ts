import { describe, expect, it } from 'vitest'
import { classTabs, readClassTab, teachesClass, teachingClassFilter } from './classSpace'

describe('teachingClassFilter', () => {
  it('is null with no seats, so the caller filters on professor_id alone', () => {
    expect(teachingClassFilter('u1', [])).toBeNull()
  })

  it('asks for their own classes or the classes of the spaces they sit in', () => {
    expect(teachingClassFilter('u1', ['s1', 's2'])).toBe('professor_id.eq.u1,space_id.in.(s1,s2)')
  })
})

describe('teachesClass', () => {
  const prof = { id: 'p1', role: 'professor' as const }

  it('is the class professor', () => {
    expect(teachesClass(prof, 'p1', null)).toBe(true)
  })

  it('is faculty holding Owner or Manager in the class space', () => {
    expect(teachesClass(prof, 'other', 'manager')).toBe(true)
    expect(teachesClass(prof, 'other', 'owner')).toBe(true)
    expect(teachesClass({ id: 'a1', role: 'admin' }, 'other', 'manager')).toBe(true)
  })

  it('is never a student, whatever the seat says', () => {
    expect(teachesClass({ id: 's1', role: 'student' }, 's1', 'owner')).toBe(false)
  })

  it('is not faculty without a teaching seat', () => {
    expect(teachesClass(prof, 'other', 'member')).toBe(false)
    expect(teachesClass(prof, 'other', null)).toBe(false)
    expect(teachesClass(null, 'p1', null)).toBe(false)
  })
})

describe('classTabs', () => {
  it('gives everyone the five shared tabs', () => {
    expect(classTabs(false)).toEqual(['overview', 'projects', 'groups', 'members', 'syllabus'])
  })

  it('adds the teaching tabs for faculty who teach it', () => {
    expect(classTabs(true)).toEqual([
      'overview', 'projects', 'groups', 'members', 'syllabus',
      'submissions', 'analytics', 'reports', 'settings',
    ])
  })
})

describe('readClassTab', () => {
  it('reads a tab the viewer has', () => {
    expect(readClassTab('groups', false)).toBe('groups')
    expect(readClassTab('settings', true)).toBe('settings')
  })

  it('falls back to Overview for no tab, an unknown one, or one the viewer lacks', () => {
    expect(readClassTab(null, true)).toBe('overview')
    expect(readClassTab('nope', true)).toBe('overview')
    expect(readClassTab('settings', false)).toBe('overview')
  })
})
