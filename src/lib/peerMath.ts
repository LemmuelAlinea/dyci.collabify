import type { Tone } from './analyticsMath'
import type { PeerResult } from './types'

/** Thresholds for reading peer ratings. Each one is a named, tested constant. */
export const PEER_MIN_RATERS = 2
export const FACTOR_LOW = 0.85
export const FACTOR_HIGH = 1.1
export const SELF_GAP = 1.0
export const MANIPULATOR_GAP = 1.5
export const CONFLICT_SPREAD = 1.0
/** Phase C2 caps a suggested score at this multiple of the group score. */
export const FACTOR_CAP = 1.05

// Averages arrive rounded to three places, so a gap of exactly 1.0 must count.
const EPS = 1e-9

export type PeerFlag =
  | 'low'
  | 'high'
  | 'overconfident'
  | 'underconfident'
  | 'manipulator'
  | 'conflict'
  | 'no_response'

export const PEER_FLAG_META: Record<PeerFlag, { label: string; tone: Tone }> = {
  low: { label: 'Rated low by teammates', tone: 'danger' },
  high: { label: 'Rated high by teammates', tone: 'success' },
  overconfident: { label: 'Rates self higher than teammates do', tone: 'warning' },
  underconfident: { label: 'Rates self lower than teammates do', tone: 'pending' },
  manipulator: { label: 'Rates self far above others', tone: 'danger' },
  conflict: { label: 'Teammates disagree', tone: 'warning' },
  no_response: { label: "Didn't rate everyone", tone: 'warning' },
}

export type PeerInput = {
  student_id: string
  received_avg: number | null
  self_avg: number | null
  given_avg: number | null
  raters: number
  received_spread: number | null
  rated_all: boolean
  team_size: number
}

const num = (v: number | null) => (v === null ? null : Number(v))
const round3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * One group in one round: each member's adjustment factor (their average from
 * teammates ÷ the team's mean of the same) and the patterns worth a conversation.
 * Members with fewer than PEER_MIN_RATERS raters get no factor and stay out of
 * the mean, so one person's opinion never moves anyone.
 */
export function analyseTeam<T extends PeerInput>(rows: T[]): (T & { factor: number | null; flags: PeerFlag[] })[] {
  const counted = rows.filter((r) => r.raters >= PEER_MIN_RATERS && r.received_avg !== null)
  const mean = counted.length
    ? counted.reduce((s, r) => s + Number(r.received_avg), 0) / counted.length
    : null

  return rows.map((r) => {
    const received = num(r.received_avg)
    const factor =
      mean && received !== null && r.raters >= PEER_MIN_RATERS ? round3(received / mean) : null
    return { ...r, factor, flags: peerFlags(r, factor) }
  })
}

function peerFlags(r: PeerInput, factor: number | null): PeerFlag[] {
  const out: PeerFlag[] = []
  const received = num(r.received_avg)
  const self = num(r.self_avg)
  const given = num(r.given_avg)
  const spread = num(r.received_spread)
  const enough = r.raters >= PEER_MIN_RATERS

  if (factor !== null && factor < FACTOR_LOW) out.push('low')
  if (factor !== null && factor > FACTOR_HIGH) out.push('high')
  if (enough && self !== null && received !== null) {
    if (self - received >= SELF_GAP - EPS) out.push('overconfident')
    if (received - self >= SELF_GAP - EPS) out.push('underconfident')
  }
  if (factor !== null && factor < 1 && self !== null && given !== null && self - given >= MANIPULATOR_GAP - EPS) {
    out.push('manipulator')
  }
  if (enough && spread !== null && spread >= CONFLICT_SPREAD - EPS) out.push('conflict')
  if (!r.rated_all && r.team_size > 1) out.push('no_response')
  return out
}

/** Each board's most recent round only, which is what a summary should show. */
export function latestRoundRows(rows: PeerResult[]): PeerResult[] {
  const latest = new Map<string, string>()
  for (const r of rows) {
    const cur = latest.get(r.board_id)
    if (!cur || r.opens_at > cur) latest.set(r.board_id, r.opens_at)
  }
  return rows.filter((r) => latest.get(r.board_id) === r.opens_at)
}
