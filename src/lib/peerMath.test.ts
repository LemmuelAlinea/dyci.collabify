import { describe, expect, it } from 'vitest'
import { analyseTeam, latestRoundRows, peerFlagLabel } from './peerMath'
import type { PeerInput } from './peerMath'
import type { PeerResult } from './types'

// The same three students as supabase/tests/peer-evaluation.test.sql.
const row = (over: Partial<PeerInput> & { student_id: string }): PeerInput => ({
  received_avg: null, self_avg: null, given_avg: null, raters: 0,
  received_spread: null, rated_all: true, team_size: 3, ...over,
})
const team = [
  row({ student_id: 'a', received_avg: 4, self_avg: 5, given_avg: 3, raters: 2, received_spread: 0 }),
  row({ student_id: 'b', received_avg: 3.5, self_avg: 4, given_avg: 3, raters: 2, received_spread: 1 }),
  row({ student_id: 'c', received_avg: 2, self_avg: 5, given_avg: 3.5, raters: 2, received_spread: 0 }),
]

describe('analyseTeam', () => {
  const out = Object.fromEntries(analyseTeam(team).map((r) => [r.student_id, r]))

  it('divides each received average by the team mean', () => {
    expect(out.a.factor).toBe(1.263)
    expect(out.b.factor).toBe(1.105)
    expect(out.c.factor).toBe(0.632)
  })

  it('flags each pattern in a fixed order', () => {
    expect(out.a.flags).toEqual(['high', 'overconfident'])
    expect(out.b.flags).toEqual(['high', 'conflict'])
    expect(out.c.flags).toEqual(['low', 'overconfident', 'manipulator'])
  })

  it('gives no factor, and no factor flags, with fewer than two raters', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 1, self_avg: 5, given_avg: 1, raters: 1, received_spread: 0, team_size: 2 }),
      row({ student_id: 'y', received_avg: 5, self_avg: 5, given_avg: 1, raters: 1, received_spread: 0, team_size: 2 }),
    ])
    expect(x.factor).toBeNull()
    expect(x.flags).toEqual([])
  })

  it('leaves people with too few raters out of the team mean', () => {
    const out2 = analyseTeam([
      row({ student_id: 'p', received_avg: 4, raters: 2 }),
      row({ student_id: 'q', received_avg: 4, raters: 2 }),
      row({ student_id: 'r', received_avg: 1, raters: 1 }),
    ])
    expect(out2.map((r) => r.factor)).toEqual([1, 1, null])
  })

  it('flags someone who has not rated everyone', () => {
    const [x] = analyseTeam([row({ student_id: 'x', rated_all: false })])
    expect(x.flags).toEqual(['no_response'])
  })

  it('does not flag a group of one for not rating', () => {
    const [x] = analyseTeam([row({ student_id: 'x', rated_all: false, team_size: 1 })])
    expect(x.flags).toEqual([])
  })

  it('flags underconfidence', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 4.5, self_avg: 3, raters: 2, received_spread: 0 }),
      row({ student_id: 'y', received_avg: 4.5, self_avg: 4.5, raters: 2, received_spread: 0 }),
    ])
    expect(x.flags).toEqual(['underconfident'])
  })

  // Team mean 4.0 in both: 3.4 / 4 = 0.85 and 4.6 / 4 = 1.15; 4.4 / 4 = 1.1 and 3.6 / 4 = 0.9.
  it('does not flag a factor of exactly 0.85 as low', () => {
    const [x, y] = analyseTeam([
      row({ student_id: 'x', received_avg: 3.4, raters: 2 }),
      row({ student_id: 'y', received_avg: 4.6, raters: 2 }),
    ])
    expect(x.factor).toBe(0.85)
    expect(x.flags).not.toContain('low')
    expect(y.factor).toBe(1.15)
    expect(y.flags).toContain('high')
  })

  it('does not flag a factor of exactly 1.10 as high', () => {
    const [x, y] = analyseTeam([
      row({ student_id: 'x', received_avg: 4.4, raters: 2 }),
      row({ student_id: 'y', received_avg: 3.6, raters: 2 }),
    ])
    expect(x.factor).toBe(1.1)
    expect(x.flags).not.toContain('high')
    expect(y.factor).toBe(0.9)
    expect(y.flags).not.toContain('low')
  })

  it('counts a self gap of one point as overconfident, float error included', () => {
    const one = (received: number, self: number) =>
      analyseTeam([row({ student_id: 'x', received_avg: received, self_avg: self, raters: 2, received_spread: 0 })])[0]
    expect(one(3.2, 4.2).flags).toContain('overconfident')
    // 4.6 - 3.6 is 0.9999999999999996 in floating point.
    expect(4.6 - 3.6).toBeLessThan(1)
    expect(one(3.6, 4.6).flags).toContain('overconfident')
  })

  it('does not count a gap just under one point', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 3.21, self_avg: 4.2, raters: 2, received_spread: 0 }),
    ])
    expect(x.flags).not.toContain('overconfident')
  })

  it('shows no conflict with only one rater, however wide the spread', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 3, self_avg: 3, raters: 1, received_spread: 2, team_size: 2 }),
      row({ student_id: 'y', received_avg: 3, self_avg: 3, raters: 1, received_spread: 0, team_size: 2 }),
    ])
    expect(x.flags).not.toContain('conflict')
    expect(x.flags).toEqual([])
  })
})

describe('peerFlagLabel', () => {
  it('words a missing answer as pending while the round is open', () => {
    expect(peerFlagLabel('no_response', true)).toEqual({ label: 'Not answered yet', tone: 'pending' })
    expect(peerFlagLabel('no_response', false)).toEqual({ label: "Didn't rate everyone", tone: 'warning' })
    expect(peerFlagLabel('no_response')).toEqual({ label: "Didn't rate everyone", tone: 'warning' })
    expect(peerFlagLabel('low', true)).toEqual({ label: 'Rated low by teammates', tone: 'danger' })
  })
})

describe('latestRoundRows', () => {
  const r = (round: string, board: string, opens: string) =>
    ({ round_id: round, board_id: board, opens_at: opens, student_id: 's' }) as PeerResult
  it('keeps each board’s most recent round only', () => {
    const rows = [r('old', 'b1', '2026-10-01T00:00:00Z'), r('new', 'b1', '2026-10-10T00:00:00Z'),
                  r('only', 'b2', '2026-10-02T00:00:00Z')]
    expect(latestRoundRows(rows).map((x) => x.round_id).sort()).toEqual(['new', 'only'])
  })
})
