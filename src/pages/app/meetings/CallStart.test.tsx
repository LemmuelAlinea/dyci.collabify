// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { paths } from '../../../lib/paths'

const mock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../../lib/api/meetings', () => ({ createMeeting: mock.create }))
import CallStart from './CallStart'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mock.create.mockReset().mockResolvedValue({ id: 'meeting-1' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('creates no meeting until Start is pressed in prejoin', async () => {
  const draft = { scope: 'project', audienceId: 'project-1', input: {
    title: 'Project sync', agenda: '', joinUrl: null, startsAt: '2020-01-01T00:00:00Z', durationMin: 60,
  } }
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: paths.meetingStart, state: { draft } }]}>
    <Routes><Route path={paths.meetingStart} element={<CallStart />} /><Route path="/meetings/:id/call" element={<p>Call room</p>} /></Routes>
  </MemoryRouter>))
  expect(host.textContent).toContain('Check your devices')
  expect(mock.create).not.toHaveBeenCalled()
  const start = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Start call')!
  await act(async () => start.click())
  expect(mock.create).toHaveBeenCalledOnce()
  expect(mock.create.mock.calls[0][2].startsAt).not.toBe('2020-01-01T00:00:00Z')
  expect(host.textContent).toContain('Call room')
})

it('leaves prejoin without creating or notifying anyone', async () => {
  const draft = { scope: 'project', audienceId: 'project-1', input: {
    title: 'Project sync', agenda: '', joinUrl: null, startsAt: '2026-11-20T10:00:00Z', durationMin: 60,
  } }
  await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: paths.meetingStart, state: { draft } }]}>
    <Routes><Route path={paths.meetingStart} element={<CallStart />} /><Route path={paths.meetings} element={<p>Meetings page</p>} /></Routes>
  </MemoryRouter>))
  const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!
  await act(async () => cancel.click())
  expect(host.textContent).toContain('Meetings page')
  expect(mock.create).not.toHaveBeenCalled()
})
