import { describe, expect, it } from 'vitest'
import { authErrorMessage } from './authError'

describe('authErrorMessage', () => {
  it('explains a second running sprint before the generic duplicate-name rule', () => {
    const running = 'Another sprint is already running. Finish it before starting this one.'
    expect(
      authErrorMessage(new Error('duplicate key value violates unique constraint "general_sprints_one_running"')),
    ).toBe(running)
    expect(
      authErrorMessage({ message: 'duplicate key value violates unique constraint "board_sprints_one_running"' }),
    ).toBe(running)
  })

  it('still reads any other duplicate as a name already in use', () => {
    expect(authErrorMessage(new Error('duplicate key value violates unique constraint "general_teams_name"'))).toBe(
      'That name is already used here. Pick another one.',
    )
  })
})

describe('a refused class project write', () => {
  it('says only the setter can change it, with or without the section prefix', () => {
    const plain = 'Only the teacher who set this project can change it. Ask them to make the change.'
    expect(authErrorMessage({ message: 'new row violates row-level security policy for table "projects"' })).toBe(plain)
    expect(
      authErrorMessage({
        message: 'QME  ·  BSIT-4A — new row violates row-level security policy for table "projects"',
      }),
    ).toBe(plain)
  })

  it('leaves another table refusal alone', () => {
    expect(
      authErrorMessage({ message: 'new row violates row-level security policy for table "project_tasks"' }),
    ).toContain('project_tasks')
  })

  it('explains a work task that would start after it is due', () => {
    expect(
      authErrorMessage({ message: 'new row for relation "general_tasks" violates check constraint "general_tasks_starts_before_due"' }),
    ).toBe('A task cannot start after it is due. Move one of the two dates.')
  })
})
