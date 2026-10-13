import { describe, expect, it } from 'vitest'
import { boardScoreStatus, formatPoints, isHalfStep, suggestScore } from './scoreMath'
import type { ScoreSheetRow } from './types'

// The same hand values as supabase/tests/scoring.test.sql.
describe('suggestScore', () => {
  it('is the group score without a factor', () => {
    expect(suggestScore(80, null, 100)).toBe(80)
  })
  it('scales by the factor', () => {
    expect(suggestScore(80, 0.9, 100)).toBe(72)
    expect(suggestScore(80, 0.632, 100)).toBe(50.5)
    expect(suggestScore(75.5, 0.987, 100)).toBe(74.5)
  })
  it('caps the factor at 1.05', () => {
    expect(suggestScore(80, 1.2, 100)).toBe(84)
    expect(suggestScore(80, 1.263, 100)).toBe(84)
  })
  it('never goes above the total', () => {
    expect(suggestScore(100, 1.04, 100)).toBe(100)
    expect(suggestScore(110, null, 100)).toBe(100)
  })
  it('rounds a half up, exactly as Postgres does', () => {
    // 10 × 1.025 is 10.249999… in floating point; it must still land on 10.5.
    expect(suggestScore(10, 1.025, 100)).toBe(10.5)
  })
  it('suggests nothing before anything is scored', () => {
    expect(suggestScore(null, 1, 100)).toBeNull()
  })
})

describe('isHalfStep', () => {
  it('accepts whole and half points from zero up', () => {
    expect(isHalfStep(0)).toBe(true)
    expect(isHalfStep(7)).toBe(true)
    expect(isHalfStep(7.5)).toBe(true)
  })
  it('refuses quarters, negatives and non-numbers', () => {
    expect(isHalfStep(7.25)).toBe(false)
    expect(isHalfStep(-1)).toBe(false)
    expect(isHalfStep(Number.NaN)).toBe(false)
  })
})

describe('formatPoints', () => {
  it('drops a trailing .0 and keeps a half', () => {
    expect(formatPoints(84)).toBe('84')
    expect(formatPoints(50.5)).toBe('50.5')
    expect(formatPoints(null)).toBe('—')
  })
})

const sheetRow = (over: Partial<ScoreSheetRow>): ScoreSheetRow => ({
  board_id: 'b', student_id: 's', student_name: 'S', in_group: true,
  group_total: null, scored: 0, criteria: 2, total_points: 100,
  factor: null, raters: 0, suggested_now: null, suggested_saved: null,
  final: null, overridden: null, factor_saved: null, confirmed_at: null,
  suggestion_changed: false, released: false, ...over,
})

describe('boardScoreStatus', () => {
  it('is not scored until every criterion has points', () => {
    expect(boardScoreStatus([])).toBe('not_scored')
    expect(boardScoreStatus([sheetRow({ scored: 1 })])).toBe('not_scored')
    expect(boardScoreStatus([sheetRow({ scored: 0, criteria: 0 })])).toBe('not_scored')
  })
  it('is scored until every member is confirmed', () => {
    expect(boardScoreStatus([
      sheetRow({ scored: 2, student_id: 'a', confirmed_at: '2026-10-13T00:00:00Z' }),
      sheetRow({ scored: 2, student_id: 'b' }),
    ])).toBe('scored')
  })
  it('is confirmed, then released', () => {
    const done = { scored: 2, confirmed_at: '2026-10-13T00:00:00Z' }
    expect(boardScoreStatus([sheetRow(done)])).toBe('confirmed')
    expect(boardScoreStatus([sheetRow({ ...done, released: true })])).toBe('released')
  })
})
