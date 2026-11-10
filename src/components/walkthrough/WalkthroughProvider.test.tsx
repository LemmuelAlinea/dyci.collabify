// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WalkthroughProvider } from './WalkthroughProvider'
import { useWalkthrough } from '../../context/walkthrough'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const h = vi.hoisted(() => ({
  auth: { profile: null as unknown },
  nav: { spaces: null as unknown, myProjects: null as unknown, reload: vi.fn() },
  target: { box: null as unknown, dialogOpen: false, missing: false },
  list: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../../context/generalNavigation', () => ({ useGeneralNavigation: () => h.nav }))
vi.mock('../../lib/api/walkthroughs', () => ({
  listMyWalkthroughs: (...a: unknown[]) => h.list(...a),
  saveWalkthroughs: (...a: unknown[]) => h.save(...a),
}))
vi.mock('./useTargetBox', () => ({ useTargetBox: () => h.target, dialogIsOpen: () => false }))

const BOX = { top: 100, left: 200, width: 120, height: 40 }
const student = { id: 'u1', role: 'student', status: 'active', can_teach: false, can_manage_projects: false }
const manager = { id: 'u2', role: 'member', status: 'active', can_teach: false, can_manage_projects: true }
const teacher = { id: 'u3', role: 'member', status: 'active', can_teach: true, can_manage_projects: true }
const admin = { id: 'u4', role: 'admin', status: 'active', can_teach: false, can_manage_projects: false }

const space = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'work',
  name: 'Space',
  description: '',
  created_by: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  class_id: null,
  my_level: 'owner',
  my_role: 'pm',
  member_count: 1,
  project_count: 0,
  archived_count: 0,
  ...over,
})
const klass = space({ id: 'c1', kind: 'education', class_id: 'k1', my_role: null })

const accountDone = { flow: 'account', status: 'done', done_steps: ['account-photo', 'account-look'] }
const row = (flow: string, status = 'active', done_steps: string[] = []) => ({ flow, status, done_steps })

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const seen = {
  go: (() => {}) as (to: string) => void,
  replay: {} as ReturnType<typeof useWalkthrough>,
}

function Probe() {
  const loc = useLocation()
  const navigate = useNavigate()
  const walkthrough = useWalkthrough()
  React.useEffect(() => {
    seen.go = navigate
    seen.replay = walkthrough
  })
  return <p data-testid="path">{loc.pathname}</p>
}
const tree = (path = '/') => (
  <MemoryRouter initialEntries={[path]}>
    <WalkthroughProvider>
      <Probe />
    </WalkthroughProvider>
  </MemoryRouter>
)
const mount = async (path = '/') => {
  await act(async () => root.render(tree(path)))
}
const rerender = async () => {
  await act(async () => root.render(tree()))
}
const text = () => document.body.textContent ?? ''
const pathname = () => document.querySelector('[data-testid="path"]')?.textContent
const press = async (label: string) => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label)
  if (!b) throw new Error(`no button ${label}; page has: ${text()}`)
  await act(async () => b.click())
}
const hasButton = (label: string) => [...document.querySelectorAll('button')].some((x) => x.textContent === label)

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  h.auth.profile = student
  h.nav.spaces = []
  h.nav.myProjects = []
  h.nav.reload = vi.fn().mockResolvedValue(undefined)
  h.target.box = BOX
  h.target.dialogOpen = false
  h.target.missing = false
  h.list.mockReset().mockResolvedValue([])
  h.save.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

it('shows nothing while spaces are loading', async () => {
  h.nav.spaces = null
  await mount()
  expect(text()).not.toContain('Set up your account')
})

it('shows nothing when progress cannot load', async () => {
  h.list.mockRejectedValue(new Error('offline'))
  await mount()
  expect(text()).not.toContain('Set up your account')
  expect(hasButton('Skip')).toBe(false)
})

it("opens a new student's first step", async () => {
  await mount()
  expect(text()).toContain('Set up your account')
  expect(text()).toContain('Step 1 of 4')
  expect(pathname()).toBe('/settings')
})

it('Next saves the step and moves on', async () => {
  await mount()
  await press('Next')
  expect(h.save).toHaveBeenCalledWith('u1', [{ flow: 'account', status: 'active', done_steps: ['account-photo'] }])
  expect(text()).toContain('Pick your look')
})

it('a failed save still advances', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.save.mockRejectedValue(new Error('offline'))
  await mount()
  await press('Next')
  expect(text()).toContain('Pick your look')
  expect(warn).toHaveBeenCalled()
})

it('Skip ends it and saves', async () => {
  await mount()
  await press('Skip')
  expect(h.save).toHaveBeenCalledWith(
    'u1',
    expect.arrayContaining([expect.objectContaining({ flow: 'student', status: 'skipped' })]),
  )
  expect(text()).not.toContain('Set up your account')
  await rerender()
  expect(hasButton('Skip')).toBe(false)
})

it('teaching finishing runs into project manager straight away', async () => {
  h.auth.profile = teacher
  h.nav.spaces = [klass]
  h.list.mockResolvedValue([accountDone, row('teaching')])
  await mount()
  expect(text()).toContain('Share this code with your section')
  await press('Done')
  expect(h.save).toHaveBeenCalledWith('u3', [expect.objectContaining({ flow: 'teaching', status: 'done' })])
  expect(text()).toContain('Create a space')
})

it('skipping teaching holds project manager until the next open', async () => {
  h.auth.profile = teacher
  h.list.mockResolvedValue([accountDone, row('teaching')])
  await mount()
  expect(text()).toContain('Create a class')
  await press('Skip')
  expect(hasButton('Skip')).toBe(false)
  expect(text()).not.toContain('Create a space')

  await act(async () => root.unmount())
  root = createRoot(host)
  h.list.mockResolvedValue([accountDone, row('teaching', 'skipped')])
  await mount()
  expect(text()).toContain('Create a space')
})

it('does not pull someone back when a dialog navigates before the data arrives', async () => {
  h.auth.profile = manager
  h.list.mockResolvedValue([accountDone])
  await mount('/spaces')
  expect(text()).toContain('Create a space')
  await act(async () => seen.go('/spaces/s1'))
  await rerender()
  expect(pathname()).toBe('/spaces/s1')
})

it('reloads the lists when a dialog closes', async () => {
  await mount()
  expect(h.nav.reload).not.toHaveBeenCalled()
  h.target.dialogOpen = true
  await rerender()
  expect(h.nav.reload).not.toHaveBeenCalled()
  expect(hasButton('Skip')).toBe(false)
  h.target.dialogOpen = false
  await rerender()
  expect(h.nav.reload).toHaveBeenCalledTimes(1)
})

it('offers Take me there once the target is missing', async () => {
  await mount()
  expect(pathname()).toBe('/settings')
  await act(async () => seen.go('/elsewhere'))
  h.target.box = null
  await rerender()
  expect(hasButton('Take me there')).toBe(false)
  h.target.missing = true
  await rerender()
  await press('Take me there')
  expect(pathname()).toBe('/settings')
})

it('the no-code button pauses', async () => {
  h.list.mockResolvedValue([accountDone])
  await mount()
  expect(text()).toContain('Join your class')
  expect(hasButton('Next')).toBe(false)
  await press("I don't have a code yet")
  expect(h.save).toHaveBeenCalledWith('u1', [{ flow: 'student', status: 'paused', done_steps: [] }])
  expect(hasButton('Skip')).toBe(false)
})

it('shows the end card once after a walked project manager finishes', async () => {
  h.auth.profile = manager
  h.list.mockResolvedValue([accountDone, row('project_manager')])
  await mount()
  expect(text()).toContain('Create a space')
  h.nav.spaces = [space({ project_count: 1 })]
  await rerender()
  expect(text()).toContain('Your project is ready')
  expect(text()).toContain('All set')
  expect(document.querySelectorAll('[data-spotlight="scrim"]')).toHaveLength(0)
  expect(h.save).toHaveBeenCalledTimes(1)
  expect(h.save).toHaveBeenCalledWith('u2', [{ flow: 'project_manager', status: 'done', done_steps: [] }])
  await rerender()
  expect(h.save).toHaveBeenCalledTimes(1)
  await press('Done')
  expect(text()).not.toContain('Your project is ready')
})

it('does not show the end card after a walkthrough that was all passed over', async () => {
  h.auth.profile = manager
  h.nav.spaces = [space({ project_count: 1 })]
  h.list.mockResolvedValue([accountDone, row('project_manager')])
  await mount()
  expect(text()).not.toContain('Your project is ready')
  expect(h.save).toHaveBeenCalledTimes(1)
  expect(h.save).toHaveBeenCalledWith('u2', [{ flow: 'project_manager', status: 'done', done_steps: [] }])
})

it('a replay writes nothing and blocks the target', async () => {
  await mount()
  expect(seen.replay.canReplay).toBe(true)
  await act(async () => seen.replay.startReplay())
  for (const title of ['Set up your account', 'Pick your look', 'Join your class', 'Find your work']) {
    expect(text()).toContain(title)
    expect(document.querySelectorAll('[data-spotlight="block"]')).toHaveLength(1)
    expect(hasButton('Skip')).toBe(true)
    expect(hasButton("I don't have a code yet")).toBe(false)
    await press('Next')
  }
  expect(h.save).not.toHaveBeenCalled()
  expect(text()).toContain('Set up your account')
  expect(document.querySelectorAll('[data-spotlight="block"]')).toHaveLength(0)
  expect(hasButton('Next')).toBe(true)
})

it('canReplay is false for an account with no walkthroughs', async () => {
  h.auth.profile = admin
  await mount()
  expect(seen.replay.canReplay).toBe(false)
})

it('offers Done on the Inbox step and finishing writes the member flow done', async () => {
  h.auth.profile = { id: 'u5', role: 'member', status: 'active', can_teach: false, can_manage_projects: false }
  h.list.mockResolvedValue([accountDone, row('member')])
  await mount()
  expect(text()).toContain('Invitations land in your Inbox')
  await press('Done')
  expect(h.save).toHaveBeenCalledWith('u5', [expect.objectContaining({ flow: 'member', done_steps: ['watch-inbox'] })])
  expect(h.save).toHaveBeenCalledWith('u5', [{ flow: 'member', status: 'done', done_steps: ['watch-inbox'] }])
  expect(hasButton('Skip')).toBe(false)
})

it('offers no primary action on a step with no press', async () => {
  h.auth.profile = manager
  h.list.mockResolvedValue([accountDone])
  await mount()
  expect(text()).toContain('Create a space')
  expect(hasButton('Next')).toBe(false)
  expect(hasButton('Done')).toBe(false)
  expect(hasButton('Skip')).toBe(true)
})
