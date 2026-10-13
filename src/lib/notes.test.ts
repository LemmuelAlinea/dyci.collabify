import { describe, expect, it } from 'vitest'
import { followUpActions, notesAbout, openableNotes } from './notes'
import type { ClassNote } from './types'

const note = (over: Partial<ClassNote> & { id: string }): ClassNote => ({
  class_id: 'c1', student_id: null, board_id: null, kind: 'note', body: 'zz',
  follow_up_on: null, resolved_at: null, outcome: '', created_by: 'p',
  created_at: '2026-10-10T02:00:00Z', ...over,
})

describe('followUpActions', () => {
  const name = (n: ClassNote) => (n.student_id === 's1' ? 'Ana Cruz' : 'Group 1')

  it('raises a follow-up that is due today, as a Manila day', () => {
    const out = followUpActions(
      [note({ id: 'n1', student_id: 's1', kind: 'follow_up', follow_up_on: '2026-10-14', body: 'Check the draft' })],
      '2026-10-14',
      name,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      key: 'follow_up_due-n1', kind: 'follow_up_due', severity: 2,
      title: 'Follow up with Ana Cruz', classId: 'c1', studentId: 's1', boardId: null, to: null,
    })
    expect(out[0].evidence).toContain('Check the draft')
  })

  it('raises one that is overdue', () => {
    expect(followUpActions([note({ id: 'n2', student_id: 's1', follow_up_on: '2026-10-01' })], '2026-10-14', name)).toHaveLength(1)
  })

  it('skips one due later, one resolved, and one with no date', () => {
    expect(
      followUpActions(
        [
          note({ id: 'n3', student_id: 's1', follow_up_on: '2026-10-15' }),
          note({ id: 'n4', student_id: 's1', follow_up_on: '2026-10-01', resolved_at: '2026-10-02T00:00:00Z' }),
          note({ id: 'n5', student_id: 's1' }),
        ],
        '2026-10-14',
        name,
      ),
    ).toEqual([])
  })

  it('says "Noted:" and cuts a long body to 140 characters', () => {
    const [a] = followUpActions(
      [note({ id: 'n7', student_id: 's1', follow_up_on: '2026-10-14', body: `  ${'x'.repeat(300)}  ` })],
      '2026-10-14',
      name,
    )
    expect(a.evidence).toContain('Noted: ')
    expect(a.evidence).not.toContain('You noted')
    expect(a.evidence).toContain(`${'x'.repeat(140)}…`)
    expect(a.evidence).not.toContain('x'.repeat(141))
  })

  it('leaves a short body whole', () => {
    const [a] = followUpActions([note({ id: 'n8', student_id: 's1', follow_up_on: '2026-10-14', body: 'Short' })], '2026-10-14', name)
    expect(a.evidence).toMatch(/Noted: Short$/)
  })

  it('names a group for a note on a board', () => {
    const out = followUpActions([note({ id: 'n6', board_id: 'b1', follow_up_on: '2026-10-14' })], '2026-10-14', name)
    expect(out[0]).toMatchObject({ title: 'Follow up with Group 1', boardId: 'b1', studentId: null })
  })
})

describe('openableNotes', () => {
  const openable = { students: new Set(['c1:s1']), boards: new Set(['b1']) }

  it('keeps a student note whose student is openable', () => {
    expect(openableNotes([note({ id: 'a', student_id: 's1' })], openable)).toHaveLength(1)
  })

  it('drops a student note for a removed student or an archived class', () => {
    expect(
      openableNotes([note({ id: 'b', student_id: 's9' }), note({ id: 'c', student_id: 's1', class_id: 'c2' })], openable),
    ).toEqual([])
  })

  it('keeps or drops a board-only note by its board', () => {
    expect(
      openableNotes([note({ id: 'd', board_id: 'b1' }), note({ id: 'e', board_id: 'b2' })], openable).map((n) => n.id),
    ).toEqual(['d'])
  })
})

describe('notesAbout', () => {
  const notes = [
    note({ id: 'old', student_id: 's1', created_at: '2026-10-01T00:00:00Z' }),
    note({ id: 'board', board_id: 'b1', created_at: '2026-10-05T00:00:00Z' }),
    note({ id: 'new', student_id: 's1', created_at: '2026-10-09T00:00:00Z' }),
    note({ id: 'other', student_id: 's2', created_at: '2026-10-09T00:00:00Z' }),
    note({ id: 'elsewhere', student_id: 's1', class_id: 'c2', created_at: '2026-10-09T00:00:00Z' }),
  ]

  it('gives a student their notes and their boards’ notes, newest first', () => {
    expect(notesAbout(notes, { classId: 'c1', studentId: 's1', boardIds: ['b1'] }).map((n) => n.id)).toEqual([
      'new', 'board', 'old',
    ])
  })

  it('gives a board only its own notes', () => {
    expect(notesAbout(notes, { classId: 'c1', boardIds: ['b1'] }).map((n) => n.id)).toEqual(['board'])
  })
})
