// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RunningSprintTabs } from './RunningSprintTabs'
import { useRunningSprint } from './useRunningSprint'
import type { SprintOrganization } from '../../lib/work/sprintSettings'
import type { Sprint } from '../../lib/work/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's',
  name: 'Sprint',
  goal: '',
  starts_on: '2026-10-05',
  ends_on: '2026-10-18',
  state: 'active',
  archived: false,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  milestone_id: null,
  team_id: null,
  ...over,
})

const teams = [
  { id: 'f', name: 'Frontend', leader_id: null },
  { id: 'b', name: 'Backend', leader_id: null },
]
const sprints = [
  sprint({ id: 'sf', name: 'Front 1', team_id: 'f', ends_on: '2026-11-20' }),
  sprint({ id: 'sb', name: 'Back 1', team_id: 'b', ends_on: '2026-11-01' }),
]

function Harness({ organization }: { organization: SprintOrganization }) {
  const r = useRunningSprint({ projectId: 'p1', sprints, organization, teams, viewerTeamIds: ['f'] })
  return (
    <div>
      <RunningSprintTabs tabs={r.tabs} activeKey={r.activeKey} onPick={r.pick} />
      <p data-testid="shown">{r.sprint?.name ?? 'none'}</p>
    </div>
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

const render = (organization: SprintOrganization) => act(async () => root.render(<Harness organization={organization} />))
const tabs = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())
const shown = () => host.querySelector('[data-testid="shown"]')?.textContent
const tab = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.trim() === label)!

it('renders nothing in sequential and shows the first running sprint', async () => {
  await render('sequential')
  expect(tabs()).toEqual([])
  expect(shown()).toBe('Back 1')
})

it('shows team tabs in streams, opening on the viewer own team', async () => {
  await render('streams')
  expect(tabs()).toEqual(['Frontend', 'Backend'])
  expect(shown()).toBe('Front 1')
  expect(tab('Frontend').getAttribute('aria-selected')).toBe('true')
})

it('shows sprint tabs in parallel, opening on the sprint ending soonest', async () => {
  await render('parallel')
  expect(tabs()).toEqual(['Back 1', 'Front 1'])
  expect(shown()).toBe('Back 1')
})

it('switches on a pick and remembers it on this device', async () => {
  await render('streams')
  await act(async () => tab('Backend').click())
  expect(shown()).toBe('Back 1')
  await act(async () => root.unmount())
  root = createRoot(host)
  await render('streams')
  expect(shown()).toBe('Back 1')
})

it('still renders when storage fails', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  await render('streams')
  await act(async () => tab('Backend').click())
  expect(shown()).toBe('Back 1')
})

it('greys a team with no running sprint', async () => {
  const idle = { id: 'd', name: 'Design', leader_id: null }
  function Idle() {
    const r = useRunningSprint({ projectId: 'p1', sprints, organization: 'streams', teams: [...teams, idle], viewerTeamIds: [] })
    return <RunningSprintTabs tabs={r.tabs} activeKey={r.activeKey} onPick={r.pick} />
  }
  await act(async () => root.render(<Idle />))
  expect(tab('Design').disabled).toBe(true)
  expect(tab('Design').title).toBe('No sprint running')
})
