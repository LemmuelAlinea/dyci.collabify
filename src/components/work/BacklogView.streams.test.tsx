// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BacklogView } from './BacklogView'
import { SprintsView } from './SprintsView'
import { DEFAULT_SPRINT_SETTINGS } from '../../lib/work/sprintSettings'
import type { SprintOrganization } from '../../lib/work/sprintSettings'
import type { Sprint, WorkItem, WorkSource } from '../../lib/work/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ Link: () => null }))

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's',
  name: 'Sprint',
  goal: '',
  starts_on: '2026-10-05',
  ends_on: '2026-10-18',
  state: 'planned',
  archived: false,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  milestone_id: null,
  team_id: null,
  ...over,
})

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: 't',
  title: 'Task',
  status: 'todo',
  due_at: null,
  done_at: null,
  sprint_id: null,
  milestone_id: null,
  rank: 1,
  holders: [],
  holderIds: [],
  teamId: null,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

const teams = {
  projectId: 'p1',
  viewerId: 'me',
  teams: [
    { id: 'f', name: 'Frontend', leader_id: 'lead' },
    { id: 'b', name: 'Backend', leader_id: null },
  ],
  members: [],
}

function source(organization: SprintOrganization, sprints: Sprint[], items: WorkItem[], over: Partial<WorkSource> = {}) {
  return {
    items,
    sprints,
    canPlan: true,
    canRunSprints: true,
    canAdd: false,
    readOnlyReason: '',
    sprintSettings: { ...DEFAULT_SPRINT_SETTINGS, organization },
    teams,
    openTask: vi.fn(),
    createSprint: vi.fn(async () => 'new'),
    updateSprint: vi.fn(async () => {}),
    deleteSprint: vi.fn(),
    startSprint: vi.fn(async () => {}),
    finishSprint: vi.fn(),
    archiveSprint: vi.fn(),
    moveToSprint: vi.fn(async () => {}),
    setRank: vi.fn(),
    addToBacklog: vi.fn(),
    ...over,
  } as unknown as WorkSource
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const render = (s: WorkSource) => act(async () => root.render(<BacklogView source={s} />))
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const moveOptions = (title: string) =>
  [...host.querySelector<HTMLSelectElement>(`select[aria-label="Move ${title} to"]`)!.options].map((o) => o.textContent)

const front = sprint({ id: 'sf', name: 'Front 1', team_id: 'f' })
const back = sprint({ id: 'sb', name: 'Back 1', team_id: 'b', state: 'active' })

it('offers a task only its own team sprints in streams', async () => {
  await render(source('streams', [front, back], [item({ id: 't1', title: 'Header', teamId: 'f' })]))
  expect(moveOptions('Header')).toEqual(['Backlog', 'Front 1 · Frontend'])
})

it('offers a team-less task only the backlog in streams and says why', async () => {
  await render(source('streams', [front, back], [item({ id: 't1', title: 'Loose' })]))
  expect(moveOptions('Loose')).toEqual(['Backlog'])
  expect(host.textContent).toContain('Give the task a team before planning it into a sprint.')
})

it('offers every sprint outside streams, naming running teams', async () => {
  await render(source('parallel', [front, back], [item({ id: 't1', title: 'Header', teamId: 'f' })]))
  expect(moveOptions('Header')).toEqual(['Backlog', 'Back 1 · Backend · running', 'Front 1 · Frontend'])
})

it('blocks Start sprint only by the mode rule, with its message', async () => {
  const running = sprint({ id: 'sr', name: 'Front 0', team_id: 'f', state: 'active' })
  await render(source('streams', [front, running], []))
  const start = button('Start sprint')!
  expect(start.disabled).toBe(true)
  expect(start.title).toBe('Frontend is already running Front 0.')
})

it('lets another team start while one team runs in streams', async () => {
  await render(source('streams', [front, back], []))
  expect(button('Start sprint')!.disabled).toBe(false)
})

it('lets a team lead without planning rights start their sprint', async () => {
  await render(source('streams', [front], [], { canPlan: false, canRunSprints: false, canRunSprint: (s) => s.team_id === 'f' }))
  expect(button('Start sprint')).toBeDefined()
})

it('says why a sprint could not start on its own', async () => {
  await render(source('streams', [sprint({ id: 'x', auto_start_blocked_reason: 'Give this sprint a team first.' })], []))
  expect(host.textContent).toContain("Couldn't start on its own: Give this sprint a team first.")
})

it('requires a team for a new sprint in streams and names it after the team', async () => {
  const s = source('streams', [], [])
  await render(s)
  await act(async () => button('Create sprint')!.click())
  const dialogSave = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Create sprint').at(-1)!
  await act(async () => dialogSave.click())
  expect(document.body.textContent).toContain('Choose the team this sprint is for.')
  expect(s.createSprint).not.toHaveBeenCalled()

  const label = [...document.querySelectorAll('label')].filter((l) => l.textContent?.trim() === 'Team').at(-1)!
  const select = document.getElementById(label.htmlFor) as HTMLSelectElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'f')
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => dialogSave.click())
  expect(s.createSprint).toHaveBeenCalledWith(expect.objectContaining({ name: 'Frontend sprint 1', teamId: 'f' }))
})

it('leaves the team optional outside streams', async () => {
  const s = source('sequential', [], [])
  await render(s)
  await act(async () => button('Create sprint')!.click())
  const dialogSave = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Create sprint').at(-1)!
  await act(async () => dialogSave.click())
  expect(s.createSprint).toHaveBeenCalledWith(expect.objectContaining({ teamId: null }))
})

it('shows one running sprint at a time, with the team in its heading, on the Sprints tab', async () => {
  const a = sprint({ id: 'sf', name: 'Front 1', team_id: 'f', state: 'active', ends_on: '2026-12-20' })
  const b = sprint({ id: 'sb', name: 'Back 1', team_id: 'b', state: 'active', ends_on: '2026-12-01' })
  localStorage.clear()
  await act(async () => root.render(<SprintsView source={source('streams', [a, b], [])} onPlan={() => {}} />))
  expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Backend', 'Frontend'])
  expect(host.querySelector('h2')?.textContent).toBe('Back 1')
  expect(host.textContent).toContain('Running sprint · Backend')
})

it('hides Finish from a lead of another team', async () => {
  const a = sprint({ id: 'sf', name: 'Front 1', team_id: 'f', state: 'active', ends_on: '2026-12-20' })
  await act(async () =>
    root.render(<SprintsView source={source('streams', [a], [], { canRunSprints: false, canRunSprint: (s) => s.team_id === 'b' })} onPlan={() => {}} />),
  )
  expect(button('Finish sprint')).toBeUndefined()
})
