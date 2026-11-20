// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Meeting } from '../../lib/meetings'
import { MeetingRow } from './MeetingRow'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function show(canStart: boolean) {
  const meeting = {
    id: 'm1', title: 'Project sync', scope: 'project', platform: 'collabify', call_state: 'starting',
    starts_at: '2026-11-20T10:00:00Z', duration_min: 60, cancelled_at: null, can_start: canStart,
    can_join: false, can_manage: false, audience_label: 'Project',
  } as Meeting
  await act(async () => root.render(<MemoryRouter><ul><MeetingRow meeting={meeting} now={Date.parse('2026-11-20T10:05:00Z')}
    onOpen={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} /></ul></MemoryRouter>))
}

it('offers retry only after the server allows reclaiming a stalled start', async () => {
  await show(false)
  expect(host.textContent).toContain('Starting')
  expect(host.textContent).not.toContain('Retry start')
  await show(true)
  expect(host.textContent).toContain('Retry start')
  expect(host.querySelector('a[href="/meetings/m1/call"]')).not.toBeNull()
})
