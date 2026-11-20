// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  meeting: { id: 'meeting-1', title: 'Review', platform: 'collabify', call_state: 'live', can_start: true, can_join: true, can_host: true },
  room: { localParticipant: { setAttributes: vi.fn().mockResolvedValue(undefined), setMicrophoneEnabled: vi.fn(), setCameraEnabled: vi.fn(), setScreenShareEnabled: vi.fn() }, switchActiveDevice: vi.fn() },
}))
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRoomContext: () => mock.room,
  useConnectionState: () => 'connected',
  useLocalParticipant: () => ({ localParticipant: mock.room.localParticipant, isCameraEnabled: false, isMicrophoneEnabled: false, isScreenShareEnabled: false }),
  useLocalParticipantPermissions: () => null,
  useParticipantAttribute: () => undefined,
}))
vi.mock('../../../components/meetings/CallPrejoin', () => ({ CallPrejoin: ({ onEnter }: { onEnter: (choices: unknown) => void }) => <button onClick={() => onEnter({ camera: false, microphone: false, cameraId: '', microphoneId: '', speakerId: '', background: 'off', photoUrl: '', mirror: false })}>Enter</button> }))
vi.mock('../../../components/meetings/CallStage', () => ({ CallStage: () => <div aria-label="Video stage">Video stage</div> }))
vi.mock('../../../components/meetings/CallRecording', () => ({ CallRecording: () => null }))
vi.mock('../../../components/meetings/CallSettings', () => ({ applyBackground: vi.fn(), CallSettings: () => <aside aria-label="Call settings">Settings panel</aside> }))
vi.mock('../../../components/meetings/CallPeople', () => ({ CallPeople: () => <aside aria-label="People in call">People panel</aside> }))
vi.mock('../../../components/meetings/CallChat', () => ({ CallChat: () => <aside aria-label="Meeting chat">Chat panel</aside> }))
vi.mock('../../../hooks/useLive', () => ({ useLive: vi.fn() }))
vi.mock('../../../hooks/useNow', () => ({ useNow: () => Date.now() }))
vi.mock('../../../lib/api/meetingCall', () => ({ callAction: async () => ({ serverUrl: 'wss://example.test', token: 'token' }) }))
vi.mock('../../../lib/api/meetings', () => ({ getMeeting: async () => mock.meeting }))
import CallRoom from './CallRoom'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('replaces and dismisses call panels while anchoring settings and people above their controls', async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={['/meetings/meeting-1/call']}><Routes><Route path="/meetings/:id/call" element={<CallRoom />} /></Routes></MemoryRouter>))
  await act(async () => { (host.querySelector('button') as HTMLButtonElement).click() })
  const click = async (label: string) => act(async () => (host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click())
  await click('Settings')
  expect(host.querySelector('[aria-label="Call settings"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Call settings"]')?.parentElement?.classList.contains('bottom-full')).toBe(true)
  await click('People')
  expect(host.querySelector('[aria-label="Call settings"]')).toBeNull()
  expect(host.querySelector('[aria-label="People in call"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="People in call"]')?.parentElement?.classList.contains('bottom-full')).toBe(true)
  await click('Chat')
  expect(host.querySelector('[aria-label="People in call"]')).toBeNull()
  expect(host.querySelector('[aria-label="Meeting chat"]')?.parentElement?.classList.contains('fixed')).toBe(true)
  await click('Settings')
  expect(host.querySelector('[aria-label="Meeting chat"]')).toBeNull()
  expect(host.querySelector('[aria-label="Call settings"]')).not.toBeNull()
  const press = (element: Element) => act(async () => element.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  await press(host.querySelector('[aria-label="Call settings"]')!)
  expect(host.querySelector('[aria-label="Call settings"]')).not.toBeNull()
  await press(host.querySelector('button[aria-label="Settings"]')!)
  await click('Settings')
  expect(host.querySelector('[aria-label="Call settings"]')).toBeNull()
  await click('Settings')
  await press(host.querySelector('[aria-label="Video stage"]')!)
  expect(host.querySelector('[aria-label="Call settings"]')).toBeNull()
  await click('People')
  await press(host.querySelector('[aria-label="Video stage"]')!)
  expect(host.querySelector('[aria-label="People in call"]')).toBeNull()
  await click('Chat')
  await press(host.querySelector('[aria-label="Video stage"]')!)
  expect(host.querySelector('[aria-label="Meeting chat"]')).toBeNull()
})
