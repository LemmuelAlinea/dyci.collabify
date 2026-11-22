// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CallChoices } from '../components/meetings/CallPrejoin'

const mock = vi.hoisted(() => ({ joins: vi.fn(), mounts: vi.fn(), unmounts: vi.fn() }))
vi.mock('../components/meetings/CallConnection', () => ({
  default: function MockConnection({ children, onDisconnected }: { children: React.ReactNode; onDisconnected: () => void }) {
    useEffect(() => { mock.mounts(); return () => mock.unmounts() }, [])
    return <div data-room>{children}<button onClick={onDisconnected}>Disconnect</button></div>
  },
}))
vi.mock('../lib/api/meetingCall', () => ({ callAction: mock.joins }))
import { CallSessionProvider, useCallSession } from './CallSessionContext'

const choices: CallChoices = { camera: true, microphone: false, cameraId: '', microphoneId: '', speakerId: '', background: 'off', photoUrl: '', mirror: false }
function Probe() {
  const call = useCallSession()
  const navigate = useNavigate()
  return <div>{call.active?.meetingId ?? 'none'}
    <button onClick={() => call.begin({ meetingId: 'meeting-1', title: 'Review', choices, session: { meetingId: 'meeting-1', serverUrl: 'wss://test', token: 'token', canHost: true } })}>Begin</button>
    <button onClick={() => call.updateMedia('microphone', true)}>Mic on</button>
    <button onClick={() => navigate('/home')}>Home</button>
  </div>
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  mock.joins.mockReset()
  mock.mounts.mockClear()
  mock.unmounts.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('keeps one LiveKit room mounted while navigating to other pages', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/meetings/meeting-1/call']}><CallSessionProvider profileId="member-1"><Routes><Route path="/meetings/:id/call" element={<Probe />} /><Route path="/home" element={<Probe />} /></Routes></CallSessionProvider></MemoryRouter>))
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Begin')!.click())
  expect(mock.mounts).toHaveBeenCalledOnce()
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Home')!.click())
  expect(host.textContent).toContain('meeting-1')
  expect(host.textContent).toContain('Return to call')
  expect(mock.unmounts).not.toHaveBeenCalled()
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Mic on')!.click())
  expect(JSON.parse(sessionStorage.getItem('collabify.active-call')!).choices.microphone).toBe(true)
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Leave')!.click())
  expect(host.querySelector('[data-room]')).toBeNull()
  expect(sessionStorage.getItem('collabify.active-call')).toBeNull()
})

it('rejoins a saved meeting with a fresh token after refresh', async () => {
  sessionStorage.setItem('collabify.active-call', JSON.stringify({ meetingId: 'meeting-1', title: 'Review', profileId: 'member-1', choices }))
  mock.joins.mockResolvedValue({ meetingId: 'meeting-1', serverUrl: 'wss://test', token: 'fresh', canHost: true })
  await act(async () => root.render(<MemoryRouter initialEntries={['/home']}><CallSessionProvider profileId="member-1"><Probe /></CallSessionProvider></MemoryRouter>))
  expect(mock.joins).toHaveBeenCalledWith('join', 'meeting-1')
  expect(host.querySelector('[data-room]')).not.toBeNull()
  expect(host.textContent).toContain('Return to call')
})

it('drops the old account call when the signed-in account changes', async () => {
  const show = (profileId: string) => <MemoryRouter initialEntries={['/home']}><CallSessionProvider profileId={profileId}><Probe /></CallSessionProvider></MemoryRouter>
  await act(async () => root.render(show('member-1')))
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Begin')!.click())
  await act(async () => root.render(show('member-2')))
  expect(host.querySelector('[data-room]')).toBeNull()
  expect(sessionStorage.getItem('collabify.active-call')).toBeNull()
})

it('clears a call that disconnects while another page is open', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/home']}><CallSessionProvider profileId="member-1"><Probe /></CallSessionProvider></MemoryRouter>))
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Begin')!.click())
  await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Disconnect')!.click())
  expect(host.querySelector('[data-room]')).toBeNull()
  expect(sessionStorage.getItem('collabify.active-call')).toBeNull()
})
