/**
 * The optional contribution score.
 *
 * Each part is a person's share of this report's total for it — points
 * finished, hours logged, repository work (commits and reviews done), comments.
 * The score is those shares weighted and summed, out of 100. A part nobody
 * contributed to is dropped and the other weights stretched to fill, so a
 * project without a repository is not scored out of 80.
 *
 * It is printed with its formula and parts, because it is a description of
 * this report's numbers and not a grade.
 */
import type { ScoreWeights } from './reportConfig'

export type ScoreInput = {
  user_id: string
  name: string | null
  points_finished: number
  minutes_logged: number
  commits: number
  reviews_done: number
  comments: number
}

export type ScorePart = 'points' | 'hours' | 'repo' | 'comments'

export const SCORE_PARTS: { id: ScorePart; label: string }[] = [
  { id: 'points', label: 'points' },
  { id: 'hours', label: 'hours' },
  { id: 'repo', label: 'repository work' },
  { id: 'comments', label: 'comments' },
]

export type ScoreRow = {
  user_id: string
  name: string | null
  score: number
  /** Each part's share of the report total, 0–1. */
  shares: Record<ScorePart, number>
}

export type ScoreResult = {
  rows: ScoreRow[]
  /** The weights actually applied, summing to 100, zero for dropped parts. */
  applied: Record<ScorePart, number>
}

function value(p: ScoreInput, part: ScorePart) {
  switch (part) {
    case 'points':
      return Number(p.points_finished) || 0
    case 'hours':
      return Number(p.minutes_logged) || 0
    case 'repo':
      return (Number(p.commits) || 0) + (Number(p.reviews_done) || 0)
    case 'comments':
      return Number(p.comments) || 0
  }
}

export function contributionScores(people: readonly ScoreInput[], weights: ScoreWeights): ScoreResult {
  const parts = SCORE_PARTS.map((p) => p.id)
  const totals = Object.fromEntries(
    parts.map((part) => [part, people.reduce((sum, p) => sum + value(p, part), 0)]),
  ) as Record<ScorePart, number>

  const live = parts.filter((part) => totals[part] > 0 && weights[part] > 0)
  const weightSum = live.reduce((sum, part) => sum + weights[part], 0)
  const applied = Object.fromEntries(
    parts.map((part) => [part, live.includes(part) && weightSum > 0 ? (weights[part] / weightSum) * 100 : 0]),
  ) as Record<ScorePart, number>

  const rows = people.map((p) => {
    const shares = Object.fromEntries(
      parts.map((part) => [part, totals[part] > 0 ? value(p, part) / totals[part] : 0]),
    ) as Record<ScorePart, number>
    const score = parts.reduce((sum, part) => sum + applied[part] * shares[part], 0)
    return { user_id: p.user_id, name: p.name, score: Math.round(score * 10) / 10, shares }
  })

  // Highest first; a tie keeps name order so the table does not reshuffle.
  rows.sort((a, b) => b.score - a.score || (a.name ?? '').localeCompare(b.name ?? ''))
  return { rows, applied }
}

/** "Score = 50% points share + 20% hours share + …" with the weights actually used. */
export function scoreFormula(applied: Record<ScorePart, number>) {
  const terms = SCORE_PARTS.filter((p) => applied[p.id] > 0).map(
    (p) => `${Math.round(applied[p.id])}% ${p.label} share`,
  )
  if (terms.length === 0) return 'Nothing in this report to score.'
  return `Score = ${terms.join(' + ')}, each a share of this report's totals. It is not a grade.`
}
