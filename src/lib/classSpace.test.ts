import { describe, expect, it } from 'vitest'
import {
  classTabRedirect,
  classTabs,
  groupsHomeFor,
  isEmptyClass,
  readClassTab,
  readPeopleView,
  teacherSettingsSection,
  seatKnown,
  teachesClass,
  teachingClassFilter,
} from './classSpace'

describe('teachingClassFilter', () => {
  it('is null with no seats, so the caller filters on professor_id alone', () => {
    expect(teachingClassFilter('u1', [])).toBeNull()
  })

  it('asks for their own classes or the classes of the spaces they sit in', () => {
    expect(teachingClassFilter('u1', ['s1', 's2'])).toBe('professor_id.eq.u1,space_id.in.(s1,s2)')
  })
})

describe('teachesClass', () => {
  const prof = { id: 'p1', role: 'member' as const, can_teach: true }

  it('is the class professor', () => {
    expect(teachesClass(prof, 'p1', null)).toBe(true)
  })

  it('is a member with Can teach holding Owner or Manager in the class space', () => {
    expect(teachesClass(prof, 'other', 'manager')).toBe(true)
    expect(teachesClass(prof, 'other', 'owner')).toBe(true)
    expect(teachesClass({ id: 'a1', role: 'admin', can_teach: true }, 'other', 'manager')).toBe(false)
  })

  it('is not a member without Can teach, whatever the seat says', () => {
    const plain = { id: 'm1', role: 'member' as const, can_teach: false }
    expect(teachesClass(plain, 'other', 'owner')).toBe(false)
    expect(teachesClass(plain, 'other', 'manager')).toBe(false)
  })

  it('is never a student, whatever the seat says', () => {
    expect(teachesClass({ id: 's1', role: 'student', can_teach: false }, 's1', 'owner')).toBe(false)
  })

  it('is not a teacher without a teaching seat', () => {
    expect(teachesClass(prof, 'other', 'member')).toBe(false)
    expect(teachesClass(prof, 'other', null)).toBe(false)
    expect(teachesClass(null, 'p1', null)).toBe(false)
  })
})

describe('classTabs', () => {
  it('gives everyone the four shared tabs', () => {
    expect(classTabs(false)).toEqual(['overview', 'projects', 'people', 'syllabus'])
  })

  it('gives faculty who teach it the class run from its own tabs, people inside Settings', () => {
    expect(classTabs(true)).toEqual(['overview', 'projects', 'reports', 'syllabus', 'settings'])
  })

  it('holds students and groups in one People tab for a student', () => {
    for (const teaching of [true, false]) {
      expect(classTabs(teaching)).not.toContain('groups')
      expect(classTabs(teaching)).not.toContain('members')
    }
  })

  it('no longer has Submissions or Analytics tabs', () => {
    expect(classTabs(true)).not.toContain('submissions')
    expect(classTabs(true)).not.toContain('analytics')
  })
})

describe('seatKnown', () => {
  it('is known for a student, before spaces ever load', () => {
    expect(seatKnown('student', 's1', 'p1', false)).toBe(true)
  })

  it('is known for the class professor, before spaces ever load', () => {
    expect(seatKnown('member', 'p1', 'p1', false)).toBe(true)
  })

  it('is known once spaces have loaded, for anyone', () => {
    expect(seatKnown('member', 'other', 'p1', true)).toBe(true)
    expect(seatKnown(null, 'other', 'p1', true)).toBe(true)
  })

  it('is unknown for a co-teacher whose spaces have not loaded yet', () => {
    expect(seatKnown('member', 'cot1', 'p1', false)).toBe(false)
  })
})

describe('readClassTab', () => {
  it('reads a tab the viewer has', () => {
    expect(readClassTab('people', false)).toBe('people')
    expect(readClassTab('settings', true)).toBe('settings')
  })

  it('lands the old Groups and Members tabs on People for a student', () => {
    expect(readClassTab('groups', false)).toBe('people')
    expect(readClassTab('members', false)).toBe('people')
  })

  it("lands a teacher's People, Groups and Members on Settings", () => {
    expect(readClassTab('people', true)).toBe('settings')
    expect(readClassTab('groups', true)).toBe('settings')
    expect(readClassTab('members', true)).toBe('settings')
  })

  it('falls back to Overview for no tab, an unknown one, or one the viewer lacks', () => {
    expect(readClassTab(null, true)).toBe('overview')
    expect(readClassTab('nope', true)).toBe('overview')
    expect(readClassTab('settings', false)).toBe('overview')
  })

  it('lands an old Submissions tab on Overview and an old Analytics tab on Reports', () => {
    expect(readClassTab('submissions', true)).toBe('overview')
    expect(readClassTab('analytics', true)).toBe('reports')
  })

  it('keeps a student on Overview for the old teaching tabs', () => {
    expect(readClassTab('submissions', false)).toBe('overview')
    expect(readClassTab('analytics', false)).toBe('overview')
    expect(readClassTab('reports', false)).toBe('overview')
  })
})

describe('teacherSettingsSection', () => {
  it('reads the section, General by default', () => {
    expect(teacherSettingsSection('settings', null, null)).toBe('general')
    expect(teacherSettingsSection('settings', null, 'members')).toBe('members')
    expect(teacherSettingsSection('settings', null, 'groups')).toBe('groups')
    expect(teacherSettingsSection('settings', null, 'nope')).toBe('general')
  })

  it('opens an old People, Groups or Members link on the matching section', () => {
    expect(teacherSettingsSection('people', null, null)).toBe('members')
    expect(teacherSettingsSection('people', 'groups', null)).toBe('groups')
    expect(teacherSettingsSection('members', null, null)).toBe('members')
    expect(teacherSettingsSection('groups', null, null)).toBe('groups')
  })
})

describe('readPeopleView', () => {
  it('opens on Students by default', () => {
    expect(readPeopleView('people', null)).toBe('students')
    expect(readPeopleView('people', 'nope')).toBe('students')
  })

  it('reads the switch', () => {
    expect(readPeopleView('people', 'groups')).toBe('groups')
    expect(readPeopleView('people', 'students')).toBe('students')
  })

  it('opens an old Groups link on Groups and an old Members link on Students', () => {
    expect(readPeopleView('groups', null)).toBe('groups')
    expect(readPeopleView('members', null)).toBe('students')
  })
})

describe('classTabRedirect', () => {
  it('sends an old Submissions link with a status to Waiting on you', () => {
    expect(classTabRedirect('submissions', 'waiting', true)).toBe('/waiting?status=waiting')
    expect(classTabRedirect('submissions', 'returned', true)).toBe('/waiting?status=returned')
  })

  it('escapes the status it carries', () => {
    expect(classTabRedirect('submissions', 'a&b', true)).toBe('/waiting?status=a%26b')
  })

  it('stays on the class otherwise', () => {
    expect(classTabRedirect('submissions', null, true)).toBeNull()
    expect(classTabRedirect('submissions', '', true)).toBeNull()
    expect(classTabRedirect('submissions', 'waiting', false)).toBeNull()
    expect(classTabRedirect('overview', 'waiting', true)).toBeNull()
    expect(classTabRedirect(null, 'waiting', true)).toBeNull()
  })
})

describe('isEmptyClass', () => {
  it('is empty with no projects and no students', () => {
    expect(isEmptyClass(0, 0)).toBe(true)
  })

  it('is not empty once either exists', () => {
    expect(isEmptyClass(1, 0)).toBe(false)
    expect(isEmptyClass(0, 1)).toBe(false)
    expect(isEmptyClass(3, 2)).toBe(false)
  })
})

describe('groupsHomeFor', () => {
  it("opens the only class's Settings on Groups", () => {
    expect(groupsHomeFor(['c1'])).toBe('/classes/c1?tab=settings&section=groups')
  })

  it('opens the Classes page for several classes, or none', () => {
    expect(groupsHomeFor(['c1', 'c2'])).toBe('/classes')
    expect(groupsHomeFor([])).toBe('/classes')
  })
})
