// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProjectTaskRow } from '../../lib/api/tasks'
import type { BoardSummary } from '../../lib/types'
import { BoardCards } from './BoardCards'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const board = (id: string, over: Partial<BoardSummary> = {}) =>
  ({
    id,
    project_id: 'p1',
    group_name: `Group ${id}`,
    student_name: null,
    submitted_at: null,
    result_verdict: null,
    result_at: null,
    late_count: 0,
    member_count: 4,
    done_pct: 0,
    ...over,
  }) as BoardSummary
const row = (board_id: string, status: string, stage: number | null) =>
  ({ id: `${board_id}-${status}-${stage}`, board_id, status, stage }) as unknown as ProjectTaskRow

const STAGES = ['To do', 'Doing', 'Testing', 'Done']

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
async function render(node: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
}
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const card = (name: string) =>
  [...container.querySelectorAll('a')].find((a) => a.textContent!.includes(name))!

it('shows progress, the stage and the flags for each board', async () => {
  await render(
    <BoardCards
      boards={[
        board('a', { done_pct: 72, submitted_at: '2026-11-10T00:00:00Z' }),
        board('b', {
          done_pct: 40,
          submitted_at: '2026-11-08T00:00:00Z',
          result_verdict: 'accepted',
          result_at: '2026-11-09T00:00:00Z',
          late_count: 2,
        }),
        board('c', { result_verdict: 'returned', result_at: '2026-11-09T00:00:00Z' }),
        // Accepted, then taken back by the group: no longer accepted.
        board('d', { result_verdict: 'accepted', result_at: '2026-11-09T00:00:00Z' }),
        // Returned, then handed in again: waiting once more.
        board('e', {
          submitted_at: '2026-11-11T00:00:00Z',
          result_verdict: 'returned',
          result_at: '2026-11-09T00:00:00Z',
        }),
      ]}
      rows={[row('a', 'in_progress', 1), row('a', 'done', null), row('b', 'done', null)]}
      stages={STAGES}
      solo={false}
      onOpen={vi.fn()}
    />,
  )
  expect(card('Group a').getAttribute('href')).toBe('/class-projects/p1/boards/a')
  expect(card('Group a').textContent).toContain('72% · Doing')
  expect(card('Group a').textContent).toContain('Handed in')
  expect(card('Group a').textContent).toContain('4 members')
  expect(card('Group b').textContent).toContain('Accepted')
  expect(card('Group b').textContent).toContain('2 late')
  expect(card('Group b').textContent).not.toContain('Handed in')
  expect(card('Group c').textContent).toContain('Returned')
  expect(card('Group c').textContent).toContain('No tasks yet')
  expect(card('Group d').textContent).not.toContain('Accepted')
  expect(card('Group e').textContent).toContain('Handed in')
  expect(card('Group e').textContent).not.toContain('Returned')
})

it('leaves member counts off student cards and opens through onOpen', async () => {
  const onOpen = vi.fn()
  await render(
    <BoardCards
      boards={[board('s', { group_name: null, student_name: 'Ana Cruz' })]}
      rows={[]}
      stages={STAGES}
      solo
      onOpen={onOpen}
    />,
  )
  expect(card('Ana Cruz').textContent).not.toContain('members')
  await act(async () => card('Ana Cruz').click())
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 's' }))
})
