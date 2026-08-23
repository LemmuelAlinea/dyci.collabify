import { describe, expect, it } from 'vitest'
import { STALLED_DAYS, boardCauses } from './insight'
import type { BoardDiagnosis } from './insight'
import { CARRYING_ALONE_PCT } from './types'

/**
 * `boardCauses` is the diagnostic band of the analytics page: it turns a row of
 * counts into the sentences a professor reads about why a group is stuck.
 *
 * Two things are worth holding still. A cause that fires when it should not
 * sends a professor to a group that is fine, and the order is the advice — the
 * first line is the one they act on.
 */
function diagnosis(over: Partial<BoardDiagnosis> = {}): BoardDiagnosis {
  return {
    board_id: 'b1',
    class_id: 'c1',
    project_id: 'p1',
    group_id: 'g1',
    project_title: 'A project',
    owner_name: 'Group 1',
    project_due_at: null,
    project_locked_at: null,
    submitted_at: null,
    result_verdict: null,
    result_at: null,
    task_count: 10,
    done_count: 5,
    unclaimed_count: 0,
    late_count: 0,
    member_count: 4,
    done_pct: 50,
    last_activity: '2026-08-22T02:00:00+00:00',
    release_at: null,
    idle_days: 1,
    never_started: false,
    overdue_open_count: 0,
    top_holder_id: null,
    top_holder_name: null,
    top_holder_pct: null,
    members_holding_nothing: null,
    unclaim_events: 0,
    reopened_events: 0,
    reassignments_total: 0,
    reassignments_pending: 0,
    oldest_pending_at: null,
    returned_untouched: false,
    ...over,
  }
}

const keys = (d: BoardDiagnosis) => boardCauses(d).map((c) => c.key)

describe('boardCauses', () => {
  it('says nothing about a board that is simply getting on with it', () => {
    expect(boardCauses(diagnosis())).toEqual([])
  })

  it('ranks the most actionable cause first', () => {
    const out = boardCauses(
      diagnosis({ unclaimed_count: 2, overdue_open_count: 3, reopened_events: 1 }),
    )
    expect(out.map((c) => c.key)).toEqual(['overdue', 'unclaimed', 'reopened'])
    expect(out[0].weight).toBeGreaterThan(out[1].weight)
  })

  it('reports an empty board, and does not also claim it never started', () => {
    // "Nothing has been started" is misleading when there is nothing to start.
    const out = keys(diagnosis({ task_count: 0, never_started: true }))
    expect(out).toContain('empty')
    expect(out).not.toContain('never_started')
  })

  it('reports work never started only when there is work', () => {
    expect(keys(diagnosis({ never_started: true }))).toContain('never_started')
  })

  it('counts a board idle only once it passes the threshold', () => {
    expect(keys(diagnosis({ idle_days: STALLED_DAYS - 1 }))).not.toContain('idle')
    expect(keys(diagnosis({ idle_days: STALLED_DAYS }))).toContain('idle')
  })

  it('does not call a board idle when it has already been handed in', () => {
    // Quiet after submitting is the expected state, not a problem to chase.
    expect(
      keys(diagnosis({ idle_days: 30, submitted_at: '2026-08-01T00:00:00+00:00' })),
    ).not.toContain('idle')
  })

  it('says nothing about idleness when nothing has ever moved', () => {
    // null means "never touched", which never_started already covers.
    expect(keys(diagnosis({ idle_days: null }))).not.toContain('idle')
  })

  it('flags one person carrying the board only when others hold nothing', () => {
    const carrying = {
      top_holder_name: 'Ana',
      top_holder_pct: CARRYING_ALONE_PCT + 5,
      members_holding_nothing: 2,
    }
    expect(keys(diagnosis(carrying))).toContain('carrying')
    // Same share, but everyone else is working too: that is just a big share.
    expect(keys(diagnosis({ ...carrying, members_holding_nothing: 0 }))).not.toContain('carrying')
  })

  it('never flags carrying on an individual board, where one person is the point', () => {
    expect(
      keys(
        diagnosis({
          group_id: null,
          top_holder_name: 'Ana',
          top_holder_pct: 100,
          members_holding_nothing: 3,
        }),
      ),
    ).not.toContain('carrying')
  })

  it('holds the carrying threshold at the boundary rather than just above it', () => {
    const at = diagnosis({
      top_holder_name: 'Ana',
      top_holder_pct: CARRYING_ALONE_PCT,
      members_holding_nothing: 1,
    })
    expect(keys(at)).toContain('carrying')
  })

  it('reports a returned board only while it is still untouched and dated', () => {
    expect(
      keys(diagnosis({ returned_untouched: true, result_at: '2026-08-10T00:00:00+00:00' })),
    ).toContain('returned')
    // No decision date: there is nothing to say "how long ago" about.
    expect(keys(diagnosis({ returned_untouched: true, result_at: null }))).not.toContain('returned')
  })

  it('treats churn as a pattern, not a one-off', () => {
    expect(keys(diagnosis({ unclaim_events: 2 }))).not.toContain('churn')
    expect(keys(diagnosis({ unclaim_events: 3 }))).toContain('churn')
  })

  it('raises pending reassignments, because they are waiting on the professor', () => {
    expect(keys(diagnosis({ reassignments_pending: 1 }))).toContain('pending')
    expect(keys(diagnosis({ reassignments_total: 4, reassignments_pending: 0 }))).not.toContain(
      'pending',
    )
  })

  it('writes each sentence for one item without a stray plural', () => {
    const one = boardCauses(diagnosis({ unclaimed_count: 1 }))[0]
    expect(one.text).toContain('1 task nobody has claimed')
    const many = boardCauses(diagnosis({ unclaimed_count: 4 }))[0]
    expect(many.text).toContain('4 tasks nobody has claimed')
  })

  it('agrees its verb with the number of members holding nothing', () => {
    const single = boardCauses(
      diagnosis({ top_holder_name: 'Ana', top_holder_pct: 90, members_holding_nothing: 1 }),
    )[0]
    expect(single.text).toContain('1 member holds nothing')
    const plural = boardCauses(
      diagnosis({ top_holder_name: 'Ana', top_holder_pct: 90, members_holding_nothing: 3 }),
    )[0]
    expect(plural.text).toContain('3 members hold nothing')
  })
})
