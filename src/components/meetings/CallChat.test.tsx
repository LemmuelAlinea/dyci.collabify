// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('../../lib/api/meetings', () => ({ getMeeting: async () => ({ id: 'meeting' }), listCallMessages: mock.list, sendCallMessage: vi.fn() }))
import { CallChat } from './CallChat'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mock.list.mockResolvedValue([{
    id: 'one', meeting_id: 'meeting', sender_id: 'member', body: '<img src=x onerror=alert(1)>',
    created_at: '2026-11-20T10:00:00Z', sender: { first_name: 'Call', last_name: 'Member' },
  }])
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); mock.list.mockReset() })

it('keeps ended-call history readable as text without a send form', async () => {
  await act(async () => root.render(<CallChat meetingId="meeting" readOnly compact />))
  expect(host.textContent).toContain('Call Member')
  expect(host.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('input[aria-label="Message"]')).toBeNull()
})
