import { describe, expect, it } from 'vitest'
import {
  PROFESSOR_PROJECT_TABS, adjacentBoards, boardLabel, boardStage, legacyProfessorTarget,
  boardLeader, projectBackLink, readBoardTab, readProfessorProjectTab, topShare,
} from './classProjectNav'
import { paths } from './paths'

const q = (s: string) => new URLSearchParams(s)

describe('readProfessorProjectTab', () => {
  it('opens on Groups', () => expect(readProfessorProjectTab(q(''))).toBe('groups'))
  it('keeps a named new tab', () => {
    for (const t of PROFESSOR_PROJECT_TABS) expect(readProfessorProjectTab(q(`tab=${t}`))).toBe(t)
  })
  it('maps the old Work sections', () => {
    expect(readProfessorProjectTab(q('tab=work'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=work&work=summary'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=work&work=milestones'))).toBe('milestones')
    expect(readProfessorProjectTab(q('tab=work&work=tasks'))).toBe('tasks')
    expect(readProfessorProjectTab(q('tab=progress'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=tasks'))).toBe('tasks')
    expect(readProfessorProjectTab(q('task=t1'))).toBe('tasks')
  })
  it('sends a teacher-less tab name to Groups', () => {
    expect(readProfessorProjectTab(q('tab=files'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=shared'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=discussion'))).toBe('groups')
  })
})

describe('readBoardTab', () => {
  it('opens on Overview', () => expect(readBoardTab(q(''))).toBe('overview'))
  it('reads plan, files and grade', () => {
    expect(readBoardTab(q('tab=plan'))).toBe('plan')
    expect(readBoardTab(q('tab=files'))).toBe('files')
    expect(readBoardTab(q('tab=grade'))).toBe('grade')
  })
  it('maps old Work sections that belong to one board', () => {
    expect(readBoardTab(q('work=backlog'))).toBe('plan')
    expect(readBoardTab(q('work=sprints'))).toBe('plan')
  })
})

describe('legacyProfessorTarget', () => {
  it('opens a named board on its own page, keeping the task and the section', () => {
    expect(legacyProfessorTarget('p1', q('tab=work&board=b1&task=t1')))
      .toBe('/class-projects/p1/boards/b1?task=t1')
    expect(legacyProfessorTarget('p1', q('tab=work&work=sprints&board=b1')))
      .toBe('/class-projects/p1/boards/b1?tab=plan&work=sprints')
  })
  it('rewrites an old tab name in place', () => {
    expect(legacyProfessorTarget('p1', q('tab=work&work=milestones'))).toBe('/class-projects/p1?tab=milestones')
    expect(legacyProfessorTarget('p1', q('tab=work&task=t1'))).toBe('/class-projects/p1?tab=tasks&task=t1')
    expect(legacyProfessorTarget('p1', q('tab=groups'))).toBe('/class-projects/p1?manage=1')
    expect(legacyProfessorTarget('p1', q('tab=files'))).toBe('/class-projects/p1')
  })
  it('leaves a new address alone', () => {
    expect(legacyProfessorTarget('p1', q(''))).toBeNull()
    expect(legacyProfessorTarget('p1', q('tab=grades'))).toBeNull()
    expect(legacyProfessorTarget('p1', q('tab=tasks&task=t1'))).toBeNull()
  })
  it('sends a bare task link to the Tasks tab', () => {
    expect(legacyProfessorTarget('p1', q('task=t1'))).toBe('/class-projects/p1?tab=tasks&task=t1')
  })
})

describe('boardStage', () => {
  const stages = ['Planning', 'Design', 'Development', 'Done']
  it('is the earliest stage still holding open work', () => {
    expect(boardStage([
      { status: 'done', stage: 3 }, { status: 'in_progress', stage: 2 }, { status: 'in_progress', stage: 1 },
    ], stages)).toBe('Design')
  })
  it('counts a todo task in the first stage', () =>
    expect(boardStage([{ status: 'done', stage: 3 }, { status: 'todo', stage: null }], stages)).toBe('Planning'))
  it('is the last stage when everything is done', () =>
    expect(boardStage([{ status: 'done', stage: 3 }], stages)).toBe('Done'))
  it('is null on an empty board', () => expect(boardStage([], stages)).toBeNull())
})

describe('adjacentBoards', () => {
  const b = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('names the neighbours', () => expect(adjacentBoards(b, 'b')).toEqual({ prev: 'a', next: 'c' }))
  it('stops at the ends', () => {
    expect(adjacentBoards(b, 'a')).toEqual({ prev: null, next: 'b' })
    expect(adjacentBoards(b, 'c')).toEqual({ prev: 'b', next: null })
  })
  it('has none for an unknown board', () => expect(adjacentBoards(b, 'z')).toEqual({ prev: null, next: null }))
})

describe('boardLabel', () => {
  it('says students on an individual project', () =>
    expect(boardLabel(true)).toEqual({ one: 'student', many: 'students', title: 'Students' }))
  it('says groups otherwise', () =>
    expect(boardLabel(false)).toEqual({ one: 'group', many: 'groups', title: 'Groups' }))
})

describe('topShare', () => {
  const p = (first_name: string) => ({ id: first_name, first_name, middle_name: null, last_name: 'Cruz', avatar_url: null })
  it('names the member carrying the most of the group', () =>
    expect(topShare([
      { group_pct: 20, profile: p('Ben') }, { group_pct: 40, profile: p('Ana') }, { group_pct: 10, profile: p('Cy') },
    ])).toEqual({ name: 'Ana', pct: 40 }))
  it('keeps the first on a tie', () =>
    expect(topShare([{ group_pct: 30, profile: p('Ben') }, { group_pct: 30, profile: p('Ana') }]))
      .toEqual({ name: 'Ben', pct: 30 }))
  it('is null while nobody has delivered anything', () => {
    expect(topShare([{ group_pct: 0, profile: p('Ben') }])).toBeNull()
    expect(topShare([])).toBeNull()
  })
})

describe('boardLeader', () => {
  const p = { id: 'a', first_name: 'Ana', middle_name: null, last_name: 'Cruz', avatar_url: null }
  it('names the row marked leader', () =>
    expect(boardLeader([{ is_leader: false, profile: { ...p, first_name: 'Ben' } }, { is_leader: true, profile: p }])).toBe('Ana Cruz'))
  it('is null without one', () => expect(boardLeader([{ is_leader: false, profile: p }])).toBeNull())
})

describe('projectBackLink', () => {
  it('takes a professor back to the class, on its Projects tab', () => {
    expect(projectBackLink('professor', 'c1')).toEqual({ to: '/classes/c1?tab=projects', label: 'Class projects' })
  })
  it('keeps a student on every project, as before', () => {
    expect(projectBackLink('student', 'c1')).toEqual({ to: paths.classProjects, label: 'All projects' })
  })
})
