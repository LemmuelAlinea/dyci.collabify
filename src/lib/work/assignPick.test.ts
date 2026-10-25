import { describe, expect, it } from 'vitest'
import {
  pickAssignees,
  type AssignCandidate,
  type AssignMatch,
  type AssignPosition,
  type AssignTaskIn,
} from '../../../supabase/functions/_shared/assignPick.ts'

const POSITIONS: AssignPosition[] = [
  { id: 'pos-fe', name: 'Frontend developer' },
  { id: 'pos-be', name: 'Backend developer' },
]

function person(userId: string, name: string, extra: Partial<AssignCandidate> = {}): AssignCandidate {
  return { userId, name, load: 0, teams: [], positions: [], tags: [], ...extra }
}

function task(key: string, extra: Partial<AssignTaskIn> = {}): AssignTaskIn {
  return { key, title: `Task ${key}`, description: '', teamId: null, ...extra }
}

function byPosition(key: string, match = 'pos-fe', reason = 'Fits the role'): AssignMatch {
  return { key, kind: 'position', match, reason }
}

describe('pickAssignees', () => {
  it('gives a position task to its only holder', () => {
    const picks = pickAssignees(
      [task('t1')],
      [byPosition('t1', 'pos-fe', 'Builds the UI')],
      [person('a', 'Ana', { positions: ['pos-fe'] }), person('b', 'Ben', { positions: ['pos-be'] })],
      POSITIONS,
    )
    expect(picks).toEqual([
      { key: 't1', userId: 'a', kind: 'position', label: 'Frontend developer', reason: 'Builds the UI' },
    ])
  })

  it('spreads ties by load', () => {
    const tasks = [task('t1'), task('t2'), task('t3')]
    const picks = pickAssignees(
      tasks,
      tasks.map((t) => byPosition(t.key)),
      [
        person('a', 'Ana', { positions: ['pos-fe'], load: 2 }),
        person('b', 'Ben', { positions: ['pos-fe'], load: 0 }),
      ],
      POSITIONS,
    )
    expect(picks.map((p) => p.userId)).toEqual(['b', 'b', 'a'])
  })

  it("prefers the task's team", () => {
    const picks = pickAssignees(
      [task('t1', { teamId: 'T' })],
      [byPosition('t1')],
      [
        person('a', 'Ana', { positions: ['pos-fe'], load: 0, teams: [] }),
        person('b', 'Ben', { positions: ['pos-fe'], load: 3, teams: ['T'] }),
      ],
      POSITIONS,
    )
    expect(picks[0].userId).toBe('b')
  })

  it('falls back outside the team when nobody in it fits', () => {
    const picks = pickAssignees(
      [task('t1', { teamId: 'T' })],
      [byPosition('t1')],
      [person('a', 'Ana', { positions: ['pos-fe'], teams: [] }), person('b', 'Ben', { teams: ['T'] })],
      POSITIONS,
    )
    expect(picks[0].userId).toBe('a')
  })

  it('breaks equal load by tag hits in the wording', () => {
    const picks = pickAssignees(
      [task('t1', { title: 'Build the Figma prototype' })],
      [byPosition('t1')],
      [
        person('a', 'Ana', { positions: ['pos-fe'], load: 1, tags: ['Figma'] }),
        person('b', 'Ben', { positions: ['pos-fe'], load: 1 }),
      ],
      POSITIONS,
    )
    expect(picks[0].userId).toBe('a')
  })

  it('matches tags ignoring case', () => {
    const picks = pickAssignees(
      [task('t1')],
      [{ key: 't1', kind: 'tag', match: 'figma', reason: 'Design' }],
      [person('a', 'Ana', { tags: ['Figma'] })],
      POSITIONS,
    )
    expect(picks[0]).toMatchObject({ userId: 'a', kind: 'tag', label: 'Figma' })
  })

  it("drops a match that isn't real", () => {
    const none = { userId: null, kind: 'none', label: '' }
    const picks = pickAssignees(
      [task('t1'), task('t2')],
      [byPosition('t1', 'pos-missing'), { key: 't2', kind: 'tag', match: 'Rust', reason: 'x' }],
      [person('a', 'Ana', { positions: ['pos-fe'], tags: ['Figma'] })],
      POSITIONS,
    )
    expect(picks[0]).toMatchObject(none)
    expect(picks[1]).toMatchObject(none)
  })

  it('none stays none', () => {
    const picks = pickAssignees(
      [task('t1'), task('t2')],
      [{ key: 't1', kind: 'none', match: '', reason: 'No fit' }],
      [person('a', 'Ana', { positions: ['pos-fe'] })],
      POSITIONS,
    )
    expect(picks).toHaveLength(2)
    for (const p of picks) expect(p).toMatchObject({ userId: null, kind: 'none', label: '' })
  })

  it('same input, same output', () => {
    const tasks = [task('t1'), task('t2'), task('t3'), task('t4')]
    const matches = tasks.map((t) => byPosition(t.key))
    const people = [
      person('a', 'Ana', { positions: ['pos-fe'], load: 1 }),
      person('b', 'Ben', { positions: ['pos-fe'], load: 1 }),
      person('c', 'Cy', { positions: ['pos-fe'], load: 0 }),
    ]
    const ids = (cs: AssignCandidate[]) => pickAssignees(tasks, matches, cs, POSITIONS).map((p) => p.userId)
    const base = ids(people)
    expect(ids([...people].reverse())).toEqual(base)
    expect(ids([people[1], people[2], people[0]])).toEqual(base)
  })
})
