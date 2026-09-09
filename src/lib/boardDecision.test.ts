import { describe, expect, it } from 'vitest'

import { awaitingDecision } from './types'

const T = (iso: string) => iso

describe('awaitingDecision', () => {
  it('is false for a board nobody has handed in', () => {
    expect(awaitingDecision({ submitted_at: null, result_at: null })).toBe(false)
  })

  it('is true for a first hand-in', () => {
    expect(awaitingDecision({ submitted_at: T('2026-09-08T10:00:00Z'), result_at: null })).toBe(true)
  })

  it('is false once it has been accepted', () => {
    expect(
      awaitingDecision({
        submitted_at: T('2026-09-08T10:00:00Z'),
        result_at: T('2026-09-08T11:00:00Z'),
      }),
    ).toBe(false)
  })

  /**
   * The bug this function was extracted for. A return keeps the `returned` row
   * and nulls `submitted_at`; handing in again sets a later `submitted_at`
   * while the old decision still stands, and asking only "has a verdict" hid
   * the control on the boards that most needed it.
   */
  it('is true again after a return and a fresh hand-in', () => {
    expect(
      awaitingDecision({
        submitted_at: T('2026-09-09T09:00:00Z'),
        result_at: T('2026-09-08T11:00:00Z'),
      }),
    ).toBe(true)
  })

  it('is false when a board was returned and not handed back yet', () => {
    expect(awaitingDecision({ submitted_at: null, result_at: T('2026-09-08T11:00:00Z') })).toBe(
      false,
    )
  })

  // Same instant is not a new submission: the decision is the later event.
  it('is false when the two land on the same instant', () => {
    const at = T('2026-09-08T11:00:00Z')
    expect(awaitingDecision({ submitted_at: at, result_at: at })).toBe(false)
  })
})
