import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS } from './reportConfig'
import { contributionScores, scoreFormula } from './reportScore'

const person = (id: string, name: string, o: Partial<Record<string, number>> = {}) => ({
  user_id: id,
  name,
  points_finished: 0,
  minutes_logged: 0,
  commits: 0,
  reviews_done: 0,
  comments: 0,
  ...o,
})

describe('contributionScores', () => {
  it('weights each share of the report total', () => {
    const { rows, applied } = contributionScores(
      [
        person('a', 'Ana', { points_finished: 3, minutes_logged: 60, commits: 1, comments: 1 }),
        person('b', 'Ben', { points_finished: 1, minutes_logged: 60, reviews_done: 1, comments: 3 }),
      ],
      DEFAULT_WEIGHTS,
    )
    expect(applied).toEqual({ points: 50, hours: 20, repo: 20, comments: 10 })
    // Ana: 50×0.75 + 20×0.5 + 20×0.5 + 10×0.25 = 60
    expect(rows[0]).toMatchObject({ user_id: 'a', score: 60 })
    expect(rows[1]).toMatchObject({ user_id: 'b', score: 40 })
  })

  it('drops a part nobody contributed to and stretches the rest', () => {
    const { rows, applied } = contributionScores(
      [person('a', 'Ana', { points_finished: 1, minutes_logged: 30 }), person('b', 'Ben', { points_finished: 1, minutes_logged: 90 })],
      DEFAULT_WEIGHTS,
    )
    expect(applied.repo).toBe(0)
    expect(applied.comments).toBe(0)
    expect(Math.round(applied.points + applied.hours)).toBe(100)
    expect(rows.reduce((s, r) => s + r.score, 0)).toBeCloseTo(100, 0)
  })

  it('keeps name order on a tie', () => {
    const { rows } = contributionScores(
      [person('z', 'Zoe', { comments: 1 }), person('a', 'Ana', { comments: 1 })],
      DEFAULT_WEIGHTS,
    )
    expect(rows.map((r) => r.name)).toEqual(['Ana', 'Zoe'])
  })

  it('prints the formula it used', () => {
    expect(scoreFormula({ points: 50, hours: 20, repo: 20, comments: 10 })).toBe(
      "Score = 50% points share + 20% hours share + 20% repository work share + 10% comments share, each a share of this report's totals. It is not a grade.",
    )
    expect(scoreFormula({ points: 0, hours: 0, repo: 0, comments: 0 })).toBe('Nothing in this report to score.')
  })
})
