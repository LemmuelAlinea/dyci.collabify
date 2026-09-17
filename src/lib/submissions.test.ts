import { describe, expect, it } from 'vitest'
import {
  EMPTY_SUBMISSION_FILTERS,
  applySubmissionFilters,
  countByStatus,
  handedInLate,
  narrowSubmissions,
  sectionByClass,
  submissionStatus,
  submittedProjects,
  toSubmissions,
} from './submissions'
import type { BoardSummary } from './types'

/**
 * The page's whole claim is "every group that handed something in". The case
 * most likely to break it is a returned board: returning work clears
 * `submitted_at`, so anything keyed on that column alone loses it.
 */

const CLASSES = [
  { id: 'c1', name: 'Quantitative Methods', initial: 'QM', section: 'BSIT 3A' },
  { id: 'c2', name: 'Web Systems', initial: 'WS', section: 'BSIT 3B' },
]

function board(over: Partial<BoardSummary>): BoardSummary {
  return {
    id: 'b1',
    project_id: 'p1',
    group_id: 'g1',
    student_id: null,
    submitted_at: null,
    submitted_by: null,
    created_at: '2026-09-01T00:00:00Z',
    class_id: 'c1',
    project_title: 'Lab 6',
    project_due_at: '2026-09-10T15:00:00Z',
    project_locked_at: null,
    total_points: 100,
    group_name: 'Group 1',
    group_set_id: 's1',
    student_name: null,
    submitted_by_name: null,
    result_verdict: null,
    result_at: null,
    task_count: 6,
    done_count: 6,
    doing_count: 0,
    unclaimed_count: 0,
    late_count: 0,
    member_count: 3,
    total_weight: 100,
    done_pct: 100,
    doing_pct: 0,
    unclaimed_pct: 0,
    last_activity: null,
    ...over,
  }
}

describe('submissionStatus', () => {
  it('leaves off a board that was never handed in', () => {
    expect(submissionStatus(board({}))).toBeNull()
  })

  it('waits on a board handed in and not answered', () => {
    expect(submissionStatus(board({ submitted_at: '2026-09-09T00:00:00Z' }))).toBe('waiting')
  })

  it('keeps a returned board, though returning cleared its hand-in', () => {
    expect(
      submissionStatus(board({ result_verdict: 'returned', result_at: '2026-09-09T00:00:00Z' })),
    ).toBe('returned')
  })

  it('waits again once returned work is handed back in', () => {
    expect(
      submissionStatus(
        board({
          submitted_at: '2026-09-10T00:00:00Z',
          result_verdict: 'returned',
          result_at: '2026-09-09T00:00:00Z',
        }),
      ),
    ).toBe('waiting')
  })

  it('reads accepted work as accepted', () => {
    expect(
      submissionStatus(
        board({
          submitted_at: '2026-09-09T00:00:00Z',
          result_verdict: 'accepted',
          result_at: '2026-09-09T02:00:00Z',
        }),
      ),
    ).toBe('accepted')
  })

  it('drops accepted work the group has since taken back', () => {
    expect(
      submissionStatus(board({ result_verdict: 'accepted', result_at: '2026-09-09T02:00:00Z' })),
    ).toBeNull()
  })
})

describe('handedInLate', () => {
  it('is late only after the deadline', () => {
    expect(handedInLate(board({ submitted_at: '2026-09-10T15:00:01Z' }))).toBe(true)
    expect(handedInLate(board({ submitted_at: '2026-09-10T15:00:00Z' }))).toBe(false)
  })

  it('cannot be late without a deadline or a hand-in', () => {
    expect(
      handedInLate(board({ submitted_at: '2026-09-30T00:00:00Z', project_due_at: null })),
    ).toBe(false)
    expect(handedInLate(board({}))).toBe(false)
  })
})

const ROWS = toSubmissions(
  [
    board({ id: 'waiting-late', submitted_at: '2026-09-11T00:00:00Z' }),
    board({
      id: 'accepted',
      group_name: 'Group 2',
      submitted_at: '2026-09-08T00:00:00Z',
      submitted_by_name: 'Ricardo Batumbakaldimagibababy',
      result_verdict: 'accepted',
      result_at: '2026-09-09T00:00:00Z',
    }),
    board({
      id: 'returned',
      class_id: 'c2',
      project_id: 'p2',
      project_title: 'Capstone proposal',
      group_name: 'Team Alpha',
      result_verdict: 'returned',
      result_at: '2026-09-12T00:00:00Z',
    }),
    board({ id: 'untouched', group_name: 'Group 3' }),
    board({ id: 'other-class', class_id: 'c9', submitted_at: '2026-09-09T00:00:00Z' }),
  ],
  CLASSES,
)

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('toSubmissions', () => {
  it('keeps only handed-in boards in the classes given', () => {
    expect(ids(ROWS).sort()).toEqual(['accepted', 'returned', 'waiting-late'])
  })

  it('carries the class and the latest event', () => {
    const r = ROWS.find((x) => x.id === 'accepted')
    expect(r?.class_initial).toBe('QM')
    expect(r?.last_event).toBe('2026-09-09T00:00:00Z')
  })
})

describe('filters', () => {
  const f = EMPTY_SUBMISSION_FILTERS

  it('orders newest first by default, and oldest first on request', () => {
    expect(ids(applySubmissionFilters(ROWS, f))).toEqual(['returned', 'waiting-late', 'accepted'])
    expect(ids(applySubmissionFilters(ROWS, { ...f, order: 'oldest' }))).toEqual([
      'accepted',
      'waiting-late',
      'returned',
    ])
  })

  it('narrows by class, project and status', () => {
    expect(ids(applySubmissionFilters(ROWS, { ...f, classId: 'c2' }))).toEqual(['returned'])
    expect(ids(applySubmissionFilters(ROWS, { ...f, projectId: 'p1' })).sort()).toEqual([
      'accepted',
      'waiting-late',
    ])
    expect(ids(applySubmissionFilters(ROWS, { ...f, status: 'waiting' }))).toEqual([
      'waiting-late',
    ])
  })

  it('searches the group, the project and who handed it in', () => {
    expect(ids(applySubmissionFilters(ROWS, { ...f, query: 'alpha' }))).toEqual(['returned'])
    expect(ids(applySubmissionFilters(ROWS, { ...f, query: 'capstone' }))).toEqual(['returned'])
    expect(ids(applySubmissionFilters(ROWS, { ...f, query: 'batumbakal' }))).toEqual([
      'accepted',
    ])
  })

  it('never calls a returned board on time or late', () => {
    expect(ids(applySubmissionFilters(ROWS, { ...f, timing: 'late' }))).toEqual(['waiting-late'])
    expect(ids(applySubmissionFilters(ROWS, { ...f, timing: 'on_time' }))).toEqual(['accepted'])
  })

  it('counts statuses under the other filters, not the status filter', () => {
    const narrowed = narrowSubmissions(ROWS, { ...f, classId: 'c1', status: 'returned' })
    expect(countByStatus(narrowed)).toEqual({ waiting: 1, accepted: 1, returned: 0 })
  })
})

describe('sectionByClass', () => {
  it('follows the class order and skips an emptied class', () => {
    const sections = sectionByClass(applySubmissionFilters(ROWS, EMPTY_SUBMISSION_FILTERS), [
      'c2',
      'c1',
      'c3',
    ])
    expect(sections.map((s) => s.classId)).toEqual(['c2', 'c1'])
    expect(ids(sections[1].rows)).toEqual(['waiting-late', 'accepted'])
  })
})

describe('submittedProjects', () => {
  it('lists each project once, narrowed by class', () => {
    expect(submittedProjects(ROWS, '')).toEqual([
      { value: 'p2', label: 'Capstone proposal' },
      { value: 'p1', label: 'Lab 6' },
    ])
    expect(submittedProjects(ROWS, 'c1')).toEqual([{ value: 'p1', label: 'Lab 6' }])
  })
})
