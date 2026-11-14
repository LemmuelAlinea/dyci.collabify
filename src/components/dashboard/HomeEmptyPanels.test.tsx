// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttentionList } from './AttentionList'
import { ClassRail } from './ClassRail'
import { StalledGroups } from './StalledGroups'
import type { Attention, StalledBoard } from '../../lib/api/dashboard'
import type { ClassSummary } from '../../lib/types'

vi.mock('../../hooks/useClassLooks', () => ({ useClassLooks: () => ({}) }))
vi.mock('../projects/NudgeButton', () => ({ NudgeButton: () => <button>Remind</button> }))

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const show = (node: React.ReactNode) =>
  act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
const panel = () => host.querySelector('[data-tone]')

it('shows the caught-up panel when nothing is waiting', async () => {
  await show(<AttentionList items={[]} />)
  expect(panel()?.getAttribute('data-tone')).toBe('plain')
  expect(panel()?.textContent).toContain("You're all caught up")
  expect(panel()?.textContent).toContain('Nothing is waiting on you.')
  expect(panel()?.querySelector('svg')).not.toBeNull()
})

it('shows the all-active panel in the success tone when no group has stalled', async () => {
  await show(<StalledGroups boards={[]} />)
  expect(panel()?.getAttribute('data-tone')).toBe('success')
  expect(panel()?.className).toContain('bg-success-500/10')
  expect(panel()?.textContent).toContain('All groups are active')
  expect(panel()?.textContent).toContain('Every group made progress in the last 7 days.')
})

it('draws every panel icon square in the banner colours, success tone included', async () => {
  for (const node of [<AttentionList items={[]} />, <StalledGroups boards={[]} />, <ClassRail classes={[]} />]) {
    await show(node)
    const tile = panel()?.querySelector('svg')?.parentElement
    expect(tile?.className).toContain('bg-banner-tile')
    expect(tile?.className).toContain('text-banner-tile-glyph')
  }
})

it('shows the no-classes panel when there are no classes', async () => {
  await show(<ClassRail classes={[]} />)
  expect(panel()?.getAttribute('data-tone')).toBe('plain')
  expect(panel()?.textContent).toContain('No classes yet')
  expect(panel()?.textContent).toContain('Classes you teach show here once you create one.')
})

it('keeps the waiting list as rows when something is waiting', async () => {
  const items: Attention[] = [
    { id: 'a', icon: 'clock', title: 'Set term dates', body: 'BSIT-4A has none', to: '/classes/1' },
  ]
  await show(<AttentionList items={items} />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/classes/1')
  expect(host.textContent).toContain('Set term dates')
})

it('keeps the stalled list as rows when a group has stalled', async () => {
  const boards = [
    {
      id: 'b1',
      project_id: 'p1',
      group_name: 'Group 3',
      project_title: 'Project Prototype',
      reason: 'quiet',
      days: 9,
      done_count: 2,
      task_count: 5,
      done_pct: 40,
    },
  ] as unknown as StalledBoard[]
  await show(<StalledGroups boards={boards} />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('Group 3')
  expect(host.textContent).toContain('Quiet for 9 days')
})

it('keeps the class list as rows when there are classes', async () => {
  const classes = [
    {
      id: 'c1',
      name: 'DYBITQme413',
      section: 'BSIT-4A',
      initial: 'QME',
      student_count: 35,
      syllabus_id: 's1',
      term_start: '2026-08-01',
      term_end: '2026-12-15',
    },
  ] as unknown as ClassSummary[]
  await show(<ClassRail classes={classes} />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('DYBITQme413')
  expect(host.textContent).toContain('35')
})
