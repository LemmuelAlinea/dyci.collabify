import { describe, expect, it } from 'vitest'
import { classTabs, readClassTab, seatKnown, teachesClass, teachingClassFilter } from './classSpace'

describe('teachingClassFilter', () => {
  it('is null with no seats, so the caller filters on professor_id alone', () => {
    expect(teachingClassFilter('u1', [])).toBeNull()
  })

  it('asks for their own classes or the classes of the spaces they sit in', () => {
    expect(teachingClassFilter('u1', ['s1', 's2'])).toBe('professor_id.eq.u1,space_id.in.(s1,s2)')
  })
})

describe('teachesClass', () => {
  const prof = { id: 'p1', role: 'faculty' as const }

  it('is the class professor', () => {
    expect(teachesClass(prof, 'p1', null)).toBe(true)
  })

  it('is faculty holding Owner or Manager in the class space', () => {
    expect(teachesClass(prof, 'other', 'manager')).toBe(true)
    expect(teachesClass(prof, 'other', 'owner')).toBe(true)
    expect(teachesClass({ id: 'a1', role: 'admin' }, 'other', 'manager')).toBe(false)
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

describe('seatKnown', () => {
  it('is known for a student, before spaces ever load', () => {
    expect(seatKnown('student', 's1', 'p1', false)).toBe(true)
  })

  it('is known for the class professor, before spaces ever load', () => {
    expect(seatKnown('faculty', 'p1', 'p1', false)).toBe(true)
  })

  it('is known once spaces have loaded, for anyone', () => {
    expect(seatKnown('faculty', 'other', 'p1', true)).toBe(true)
    expect(seatKnown(null, 'other', 'p1', true)).toBe(true)
  })

  it('is unknown for a co-teacher whose spaces have not loaded yet', () => {
    expect(seatKnown('faculty', 'cot1', 'p1', false)).toBe(false)
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
