// @vitest-environment happy-dom
import * as React from 'react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SpaceProjectRequests } from './SpaceProjectRequests'
import { NewProjectDialog } from './NewProjectDialog'
import SpaceProjects from '../../pages/general/SpaceProjects'
import { listProjectRequests, listProjectRequestMessages, postProjectRequestMessage, setProjectRequestStatus, createProjectFromRequest } from '../../lib/api/projectRequests'
import { listSpaceMembers } from '../../lib/api/spaces'
import { listMyTemplates, listSpaceTeams } from '../../lib/api/general'

vi.mock('../../lib/api/projectRequests', () => ({
  listProjectRequests: vi.fn(), listProjectRequestMessages: vi.fn(),
  postProjectRequestMessage: vi.fn(), setProjectRequestStatus: vi.fn(),
  createProjectFromRequest: vi.fn(), createProjectRequest: vi.fn(), editProjectRequest: vi.fn(),
}))
vi.mock('../../lib/api/spaces', () => ({ listSpaceMembers: vi.fn() }))
vi.mock('../../lib/api/general', () => ({ listMyTemplates: vi.fn(), listSpaceTeams: vi.fn() }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'author' }, profile: { role: 'member', status: 'active', can_manage_projects: true } }) }))
vi.mock('../../context/generalNavigation', () => ({ useGeneralNavigation: () => ({ currentSpace: { id: 'space', name: 'Design', my_level: 'manager', kind: 'work' }, projects: [], error: null, reload: vi.fn() }) }))
vi.mock('../../pages/general/spaceOutlet', () => ({ useSpaceOutlet: () => ({ all: [], canStart: true, openNewProject: vi.fn() }) }))
const navigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => navigate }))
vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const request = { id: 'request', space_id: 'space', author_id: 'author', title: 'Customer portal', brief: 'Let customers see orders', desired_outcome: 'Fewer support tickets', target_date: '2026-12-01', status: 'open' as const, converted_project_id: null, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = '' })

it('keeps Requests reachable when the Space has no projects', async () => {
  vi.mocked(listProjectRequests).mockResolvedValue([])
  vi.mocked(listSpaceMembers).mockResolvedValue([])
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(SpaceProjects)))
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === 'Requests')!.click())
  expect(document.body.textContent).toContain('No requests yet')
  expect(document.body.textContent).toContain('New request')
  await act(async () => root.unmount())
})

it('opens a request discussion and posts a message', async () => {
  vi.mocked(listProjectRequests).mockResolvedValue([request])
  vi.mocked(listProjectRequestMessages).mockResolvedValue([])
  vi.mocked(listSpaceMembers).mockResolvedValue([{ user_id: 'author', first_name: 'Alex', last_name: 'Lee', level: 'member', avatar_url: null, joined_at: '', is_student: false }])
  vi.mocked(postProjectRequestMessage).mockResolvedValue('message')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(SpaceProjectRequests, { spaceId: 'space', onCreateProject: vi.fn() })))
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Customer portal'))!.click())
  expect(document.body.textContent).toContain('Fewer support tickets')
  const body = document.querySelector('textarea')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'Can we include exports?'); body.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Send message')!.click())
  expect(postProjectRequestMessage).toHaveBeenCalledWith('request', 'Can we include exports?')
  await act(async () => root.unmount())
})

it('keeps messages and drafts attached to their request when switching during a send', async () => {
  const second = { ...request, id: 'second', title: 'Mobile app' }
  const firstMessages = [{ id: 'first-message', request_id: request.id, author_id: 'author', body: 'First discussion', created_at: request.created_at }]
  const secondMessages = [{ ...firstMessages[0], id: 'second-message', request_id: second.id, body: 'Second discussion' }]
  const pendingSend = deferred<string>()
  vi.mocked(listProjectRequests).mockResolvedValue([request, second])
  vi.mocked(listSpaceMembers).mockResolvedValue([])
  vi.mocked(listProjectRequestMessages).mockImplementation(async (id) => id === request.id ? firstMessages : secondMessages)
  vi.mocked(postProjectRequestMessage).mockReturnValue(pendingSend.promise)
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(SpaceProjectRequests, { spaceId: 'space', onCreateProject: vi.fn() })))
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Customer portal'))!.click())
  expect(document.body.textContent).toContain('First discussion')
  await act(async () => { const body = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'Draft for first'); body.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Send message')!.click())
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Mobile app'))!.click())
  expect(document.body.textContent).toContain('Second discussion')
  expect(document.body.textContent).not.toContain('First discussion')
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  await act(async () => { const body = document.querySelector('textarea')!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(body, 'Draft for second'); body.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => pendingSend.resolve('sent'))
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Draft for second')
  expect(document.body.textContent).toContain('Second discussion')
  expect(document.body.textContent).not.toContain('First discussion')
  await act(async () => root.unmount())
})

it('hides the previous Space and ignores its late refresh', async () => {
  const other = { ...request, id: 'other', space_id: 'other-space', title: 'Other Space request' }
  const oldRefresh = deferred<typeof request[]>()
  const newLoad = deferred<typeof request[]>()
  vi.mocked(listProjectRequests).mockResolvedValueOnce([request]).mockReturnValueOnce(oldRefresh.promise).mockReturnValueOnce(newLoad.promise)
  vi.mocked(listSpaceMembers).mockResolvedValue([])
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const props = { onCreateProject: vi.fn() }
  await act(async () => root.render(createElement(SpaceProjectRequests, { ...props, spaceId: 'space' })))
  expect(document.body.textContent).toContain('Customer portal')
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Refresh')!.click())
  await act(async () => root.render(createElement(SpaceProjectRequests, { ...props, spaceId: 'other-space' })))
  expect(document.body.textContent).not.toContain('Customer portal')
  await act(async () => newLoad.resolve([other]))
  expect(document.body.textContent).toContain('Other Space request')
  await act(async () => oldRefresh.resolve([request]))
  expect(document.body.textContent).toContain('Other Space request')
  expect(document.body.textContent).not.toContain('Customer portal')
  await act(async () => root.unmount())
})

it('marks a request ready and offers project creation', async () => {
  vi.mocked(listProjectRequests).mockResolvedValue([request])
  vi.mocked(listProjectRequestMessages).mockResolvedValue([])
  vi.mocked(listSpaceMembers).mockResolvedValue([])
  vi.mocked(setProjectRequestStatus).mockResolvedValue()
  const onCreateProject = vi.fn()
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(SpaceProjectRequests, { spaceId: 'space', onCreateProject })))
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Customer portal'))!.click())
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Mark ready')!.click())
  expect(setProjectRequestStatus).toHaveBeenCalledWith('request', 'ready')
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Create project')!.click())
  expect(onCreateProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'request', status: 'ready' }))
  await act(async () => root.unmount())
})

it('converts with the agreed request values and navigates to the project', async () => {
  vi.mocked(listMyTemplates).mockResolvedValue([])
  vi.mocked(listSpaceTeams).mockResolvedValue([])
  vi.mocked(createProjectFromRequest).mockResolvedValue('project')
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  await act(async () => root.render(createElement(NewProjectDialog, { open: true, onClose: vi.fn(), spaceId: 'space', request: { ...request, status: 'ready' } })))
  expect((document.querySelector('input[value="Customer portal"]') as HTMLInputElement).readOnly).toBe(true)
  await act(async () => (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(createProjectFromRequest).toHaveBeenCalledWith('request', expect.objectContaining({ preset: null, spaceTeamId: null }))
  expect(navigate).toHaveBeenCalledWith(expect.stringContaining('project'))
  await act(async () => root.unmount())
})
