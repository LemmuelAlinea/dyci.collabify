// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../lib/types'

const state = vi.hoisted(() => ({
  refresh: null as null | (() => Promise<void>),
  notifications: [] as AppNotification[],
  navigate: vi.fn(),
  markRead: vi.fn(async () => undefined),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'member-1', role: 'member', status: 'active' } }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: (refresh: () => Promise<void>) => { state.refresh = refresh } }))
vi.mock('../../lib/api/notifications', () => ({
  listNotifications: async () => state.notifications,
  unreadCount: async () => state.notifications.length,
  markRead: state.markRead,
  markAllRead: vi.fn(),
}))
vi.mock('../../lib/chime', () => ({ shouldChime: () => false, playChime: vi.fn() }))
import { NotificationBell } from './NotificationBell'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  state.notifications = []
  state.navigate.mockReset()
  state.markRead.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it.each([
  ['meeting_started', 'Join', '/meetings/meeting-1/call'],
  ['meeting_scheduled', 'View', '/meetings?meeting=meeting-1'],
] as const)('alerts an audience member about %s', async (type, action, path) => {
  await act(async () => root.render(<NotificationBell />))
  state.notifications = [{
    id: 'notice-1', type, meeting_id: 'meeting-1',
    title: 'Meeting: Review', preview: 'Project team',
    created_at: new Date(Date.now() + 1000).toISOString(), read_at: null,
  } as AppNotification]
  await act(async () => { await state.refresh?.() })
  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Meeting: Review')
  expect(document.body.querySelector('[role="alert"] button')?.textContent).toBe(action)
  await act(async () => (document.body.querySelector('[role="alert"] button') as HTMLButtonElement).click())
  expect(state.markRead).toHaveBeenCalledWith(['notice-1'])
  expect(state.navigate).toHaveBeenCalledWith(path)
  await act(async () => { await state.refresh?.() })
  expect(document.body.querySelector('[role="alert"]')).toBeNull()
})
