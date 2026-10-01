import { describe, expect, it } from 'vitest'
import { archiveKindsFor, areasOf, filterArchive, hrefOf, readKinds } from './archive'
import type { ArchiveFilter, ArchiveItem } from './archive'

const account = (role: 'student' | 'faculty' | 'admin', can_teach = false) => ({
  role,
  status: 'active' as const,
  can_teach,
})
const student = account('student')
const teacher = account('faculty', true)
const nonTeacher = account('faculty')

const item = (over: Partial<ArchiveItem>): ArchiveItem => ({
  kind: 'class_task',
  area: 'classes',
  id: 'x',
  name: 'Item',
  detail: null,
  file_source: null,
  class_id: null,
  class_name: null,
  space_id: null,
  space_name: null,
  project_id: null,
  project_name: null,
  class_project_id: null,
  repo_id: null,
  path: null,
  archived_at: '2026-09-01T00:00:00Z',
  archived_by: null,
  archived_by_name: null,
  restore_block: null,
  trash_block: null,
  ...over,
})

const all: ArchiveFilter = { area: 'all', kinds: [], by: 'anyone', query: '', sort: 'newest' }

describe('archiveKindsFor', () => {
  it('gives a student with no work class sections only', () => {
    const kinds = archiveKindsFor(student, { inClass: true, hasWork: false })
    expect(kinds).toEqual(['class_task', 'class_file'])
    expect(areasOf(kinds)).toEqual(['classes'])
  })

  it('treats a student as having no work while membership loads', () => {
    expect(archiveKindsFor(student, undefined)).toEqual(['class_task', 'class_file'])
  })

  it('adds work, without Spaces, once a student is invited to some', () => {
    const kinds = archiveKindsFor(student, { inClass: true, hasWork: true })
    expect(kinds).toEqual(['class_task', 'class_file', 'team', 'project', 'work_task', 'work_file'])
    expect(areasOf(kinds)).toEqual(['classes', 'work'])
  })

  it('gives teaching faculty every class section and all of work', () => {
    const kinds = archiveKindsFor(teacher, undefined)
    expect(kinds).toContain('class')
    expect(kinds).toContain('syllabus')
    expect(kinds).toContain('space')
    expect(kinds).not.toContain('class_file')
  })

  it('gives faculty who do not teach nothing about classes', () => {
    const kinds = archiveKindsFor(nonTeacher, { inClass: true, hasWork: true })
    expect(kinds).toEqual(['space', 'team', 'project', 'work_task', 'work_file'])
    expect(areasOf(kinds)).toEqual(['work'])
  })

  it('gives an account that is not active nothing', () => {
    expect(archiveKindsFor({ role: 'student', status: 'pending', can_teach: false }, undefined)).toEqual([])
    expect(archiveKindsFor(null, undefined)).toEqual([])
  })
})

describe('filterArchive', () => {
  const rows = [
    item({ id: 'a', kind: 'class_task', name: 'Wireframes', archived_by: 'me', archived_at: '2026-09-03T00:00:00Z' }),
    item({ id: 'b', kind: 'work_task', area: 'work', name: 'Budget', archived_by: 'them', archived_at: '2026-09-01T00:00:00Z' }),
    item({ id: 'c', kind: 'class', name: 'Algorithms', archived_at: '2026-09-02T00:00:00Z' }),
  ]

  it('drops kinds the person has no section for, whatever the server sent', () => {
    expect(filterArchive(rows, ['work_task'], all, 'me').map((r) => r.id)).toEqual(['b'])
  })

  it('narrows by area, kind, who archived it and words, newest first', () => {
    const kinds = ['class_task', 'work_task', 'class'] as const
    expect(filterArchive(rows, [...kinds], all, 'me').map((r) => r.id)).toEqual(['a', 'c', 'b'])
    expect(filterArchive(rows, [...kinds], { ...all, area: 'work' }, 'me').map((r) => r.id)).toEqual(['b'])
    expect(filterArchive(rows, [...kinds], { ...all, kinds: ['class'] }, 'me').map((r) => r.id)).toEqual(['c'])
    expect(filterArchive(rows, [...kinds], { ...all, by: 'me' }, 'me').map((r) => r.id)).toEqual(['a'])
    expect(filterArchive(rows, [...kinds], { ...all, by: 'others' }, 'me').map((r) => r.id)).toEqual(['b'])
    expect(filterArchive(rows, [...kinds], { ...all, query: 'budg' }, 'me').map((r) => r.id)).toEqual(['b'])
    expect(filterArchive(rows, [...kinds], { ...all, sort: 'name' }, 'me').map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(filterArchive(rows, [...kinds], { ...all, sort: 'oldest' }, 'me').map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('hrefOf', () => {
  it('opens a draft file in My draft and a task file in the project archive', () => {
    expect(hrefOf(item({ kind: 'work_file', file_source: 'draft', project_id: 'p' }))).toBe('/projects/p?tab=files&view=draft')
    expect(hrefOf(item({ kind: 'work_file', file_source: 'task', project_id: 'p' }))).toBe('/projects/p/archive')
    expect(hrefOf(item({ kind: 'class_task', class_project_id: 'cp' }))).toBe('/class-projects/cp')
  })
})

describe('readKinds', () => {
  it('keeps known kinds and drops the rest', () => {
    expect(readKinds('class,nope,work_task')).toEqual(['class', 'work_task'])
    expect(readKinds(null)).toEqual([])
  })
})
