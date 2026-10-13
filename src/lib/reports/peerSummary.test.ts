import { describe, expect, it } from 'vitest'
import { defaultRound, peerSummaryDoc } from './peerSummary'
import { tableBlocks } from './doc'
import type { ReportDoc } from './doc'
import type { PeerResult, PeerRoundStatus } from '../types'

const head = { classLine: 'QM · BSIT 3A', professor: 'Prof. Reyes', madeAt: 'October 13, 2026' }
const round = (over: Partial<PeerRoundStatus>): PeerRoundStatus => ({
  id: 'r1', project_id: 'p1', class_id: 'c', kind: 'check_in', opens_at: '2026-10-01T00:00:00Z',
  closes_at: '2026-10-05T00:00:00Z', closed_at: '2026-10-05T00:00:00Z', is_open: false, expected: 3, answered: 2, ...over,
})
const res = (sid: string, avg: number, board = 'b1'): PeerResult => ({
  round_id: 'r1', project_id: 'p1', class_id: 'c', kind: 'final', opens_at: '2026-10-01T00:00:00Z', is_open: false,
  board_id: board, group_name: board === 'b1' ? 'Group 1' : 'Group 2', student_id: sid, student_name: sid.toUpperCase(),
  received_avg: avg, raters: 2, received_spread: 0, self_avg: avg, given_avg: avg, contributes_avg: avg,
  interacts_avg: avg, on_track_avg: avg, quality_avg: avg, skills_avg: avg, team_size: 3, rated_all: true,
})
const kpi = (doc: ReportDoc, label: string) =>
  doc.blocks.flatMap((b) => (b.kind === 'kpis' ? b.items : [])).find((k) => k.label === label)?.value

describe('defaultRound', () => {
  it('prefers the closed final round, else the latest', () => {
    const early = round({ id: 'a', opens_at: '2026-09-01T00:00:00Z' })
    const late = round({ id: 'b', opens_at: '2026-10-01T00:00:00Z' })
    const fin = round({ id: 'f', kind: 'final', opens_at: '2026-09-15T00:00:00Z' })
    const openFinal = round({ id: 'o', kind: 'final', is_open: true, closed_at: null, opens_at: '2026-10-10T00:00:00Z' })
    expect(defaultRound([early, late, fin])?.id).toBe('f')
    expect(defaultRound([early, late, openFinal])?.id).toBe('o')
    expect(defaultRound([early, late])?.id).toBe('b')
    expect(defaultRound([])).toBeNull()
  })
})

describe('peerSummaryDoc', () => {
  const results = [res('a', 4), res('b', 3.5), res('c', 2), res('d', 3, 'b2'), res('e', 3, 'b2')]
  const doc = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ kind: 'final' }), results, comments: null })

  it('shows the response rate and flag counts', () => {
    expect(kpi(doc, 'Answered')).toBe('2 of 3')
    expect(kpi(doc, 'Response rate')).toBe('66.7%')
    expect(kpi(doc, 'Rated low by teammates')).toBe(1)
  })
  it('has one table per group with the five dimensions', () => {
    const groups = tableBlocks(doc).filter((t) => t.id.startsWith('group-'))
    expect(groups.map((t) => t.title)).toEqual(['Group 1', 'Group 2'])
    expect(groups[0].columns).toHaveLength(11)
  })
  it('charts the class dimension averages out of 5', () => {
    const chart = doc.blocks.find((b) => b.kind === 'chart')
    expect(chart && chart.kind === 'chart' && chart.chart.max).toBe(5)
  })
  it('leaves comments out and the header plain by default', () => {
    expect(tableBlocks(doc).some((t) => t.id === 'comments')).toBe(false)
    expect(doc.header.confidential).toBeUndefined()
  })
  it('adds comments without rater names and marks the report confidential', () => {
    const withComments = peerSummaryDoc({
      ...head, projectTitle: 'Lab 6', round: round({ kind: 'final' }), results,
      comments: [{ round_id: 'r1', board_id: 'b1', project_id: 'p1', ratee_id: 'a', ratee_name: 'A', rater_id: 'b', rater_name: 'B', comment: 'Quiet', updated_at: '' }],
    })
    const t = tableBlocks(withComments).find((x) => x.id === 'comments')!
    expect(t.columns.map((c) => c.label)).toEqual(['About', 'Group', 'Comment'])
    expect(JSON.stringify(t.rows)).not.toContain('"B"')
    expect(withComments.header.confidential).toBe('Contains confidential peer comments')
  })
  it('never divides by zero', () => {
    const none = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ expected: 0, answered: 0 }), results: [], comments: null })
    expect(kpi(none, 'Response rate')).toBe('—')
    const zero = peerSummaryDoc({ ...head, projectTitle: 'Lab 6', round: round({ expected: 4, answered: 0 }), results: [], comments: null })
    expect(kpi(zero, 'Response rate')).toBe('0.0%')
    expect(none.blocks.some((b) => b.kind === 'note')).toBe(true)
  })
})
