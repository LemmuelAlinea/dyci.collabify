// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeadlineList } from './DeadlineList'
import { ProjectStrip } from './ProjectStrip'
import { StandingCard } from './StandingCard'
import { TaskDigest } from './TaskDigest'
import { WaitingOnYou } from './WaitingOnYou'
import type { Deadline } from '../../lib/api/dashboard'

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

const EMPTY: [string, React.ReactNode, string, string][] = [
  ['Due this week', <DeadlineList deadlines={[]} />, 'Your week is clear', 'Nothing is due in the next 7 days.'],
  [
    'Your unfinished tasks',
    <TaskDigest tasks={[]} />,
    'Nothing on your plate',
    'Open a project and claim something your group needs.',
  ],
  [
    'Projects you are on',
    <ProjectStrip projects={[]} boards={[]} linkBase="/projects" />,
    'No open projects',
    'Projects your teacher opens for your class show here.',
  ],
  [
    'Waiting on you',
    <WaitingOnYou unclaimed={0} unread={0} openSets={0} />,
    "You're all caught up",
    'Nothing is waiting on you.',
  ],
  [
    'Where you stand',
    <StandingCard rows={[]} />,
    'No progress yet',
    'Claim a task and your own progress starts counting here.',
  ],
]

for (const [tile, node, title, body] of EMPTY) {
  it(`shows a banner-coloured panel in ${tile} when it is empty`, async () => {
    await show(node)
    expect(panel()?.textContent).toContain(title)
    expect(panel()?.textContent).toContain(body)
    const square = panel()?.querySelector('svg')?.parentElement
    expect(square?.className).toContain('bg-banner-tile')
    expect(square?.className).toContain('text-banner-tile-glyph')
  })
}

it('keeps Waiting on you as rows when something waits', async () => {
  await show(<WaitingOnYou unclaimed={2} unread={1} openSets={0} />)
  expect(panel()).toBeNull()
  expect(host.textContent).toContain('tasks nobody has taken')
  expect(host.textContent).toContain('unread message')
})

it('keeps Due this week as rows when something is due', async () => {
  const deadlines = [
    { id: 't1', kind: 'task', title: 'Final presentation', due_at: '2099-01-01T00:00:00Z', to: '/x' },
  ] as unknown as Deadline[]
  await show(<DeadlineList deadlines={deadlines} />)
  expect(panel()).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.textContent).toContain('Final presentation')
})
