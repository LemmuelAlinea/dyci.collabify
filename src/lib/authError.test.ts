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
