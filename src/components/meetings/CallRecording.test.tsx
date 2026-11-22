// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ list: vi.fn(), action: vi.fn() }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => undefined }))
vi.mock('../../hooks/useNow', () => ({ useNow: () => Date.parse('2026-11-20T10:00:00Z') }))
vi.mock('../../lib/api/meetings', () => ({ listMeetingRecordings: mock.list }))
vi.mock('../../lib/api/meetingCall', () => ({ callAction: mock.action }))
import { CallRecording } from './CallRecording'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mock.list.mockReset().mockResolvedValue([{
    id: 'recording-1', meeting_id: 'meeting-1', status: 'recording',
    started_at: '2026-11-20T10:00:00Z', ended_at: null, expires_at: null,
  }])
  mock.action.mockReset().mockResolvedValue({ result: 'processing' })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('shows the recording notice to everyone but only a host can stop it', async () => {
  await act(async () => root.render(<CallRecording meetingId="meeting-1" canHost={false} inCall />))
  expect(host.textContent).toContain('Recording in progress')
  expect(host.textContent).toContain('Audio, video and screen shares may be captured.')
  expect(host.textContent).not.toContain('Stop recording')
  await act(async () => root.render(<CallRecording meetingId="meeting-1" canHost inCall />))
  vi.stubGlobal('confirm', vi.fn(() => true))
  const stop = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Stop recording')!
  await act(async () => stop.click())
  expect(mock.action).toHaveBeenCalledWith('record_stop', 'meeting-1')
})

it('hides a recording after its expiry even before cleanup runs', async () => {
  mock.list.mockResolvedValue([{
    id: 'recording-1', meeting_id: 'meeting-1', status: 'ready',
    started_at: '2026-10-20T09:00:00Z', ended_at: '2026-10-20T10:00:00Z',
    expires_at: '2026-11-19T10:00:00Z',
  }])
  await act(async () => root.render(<CallRecording meetingId="meeting-1" canHost={false} />))
  expect(host.textContent).toContain('No recordings for this meeting.')
  expect(host.textContent).not.toContain('Play video')
})
