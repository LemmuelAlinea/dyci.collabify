import type { Tone } from './analyticsMath'
import { FACTOR_CAP } from './peerMath'
import type { ScoreSheetRow } from './types'

/**
 * The suggested individual score. Same rule as suggest_score in
 * supabase/scoring.sql, with the same hand values tested on both sides:
 * the group score × the peer factor (capped at FACTOR_CAP), in half points,
 * never above the project total.
 *
 * Worked in integers (halves × thousandths), because 10 × 1.025 is
 * 10.249999… in floating point and would round the other way from Postgres.
 */
export function suggestScore(groupTotal: number | null, factor: number | null, totalPoints: number): number | null {
  if (groupTotal === null) return null
  const capHalves = Math.round(totalPoints * 2)
  const halves = Math.round(groupTotal * 2)
  if (factor === null) return Math.min(halves, capHalves) / 2
  const milli = Math.min(Math.round(factor * 1000), Math.round(FACTOR_CAP * 1000))
  const scaled = Math.floor((halves * milli + 500) / 1000)
  return Math.min(scaled, capHalves) / 2
}

/** Whole or half points, from zero up: what a score box accepts. */
export function isHalfStep(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2)
}

export function formatPoints(n: number | null): string {
  if (n === null) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export type ScoreStatus = 'not_scored' | 'scored' | 'confirmed' | 'released'

export const SCORE_STATUS_META: Record<ScoreStatus, { label: string; tone: Tone }> = {
  not_scored: { label: 'Not scored', tone: 'pending' },
  scored: { label: 'Scored', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  released: { label: 'Released', tone: 'success' },
}

/** One board's standing, from its score_sheet rows. */
export function boardScoreStatus(rows: ScoreSheetRow[]): ScoreStatus {
  const first = rows[0]
  if (!first || first.criteria === 0 || first.scored < first.criteria) return 'not_scored'
  if (!rows.every((r) => r.confirmed_at)) return 'scored'
  return first.released ? 'released' : 'confirmed'
}
