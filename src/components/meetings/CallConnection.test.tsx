// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { CallChoices } from './CallPrejoin'

const mock = vi.hoisted(() => ({
  setAttributes: vi.fn().mockResolvedValue(undefined),
  background: vi.fn().mockResolvedValue(undefined),
  switchDevice: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RoomAudioRenderer: () => null,
  useRoomContext: () => ({ localParticipant: { setAttributes: mock.setAttributes }, switchActiveDevice: mock.switchDevice }),
  useConnectionState: () => 'connected',
  useLocalParticipant: () => ({ isCameraEnabled: true }),
}))
vi.mock('./CallSettings', () => ({ applyBackground: mock.background }))
import CallConnection from './CallConnection'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('restores camera effects and mirror settings even when another page is open', async () => {
  const choices: CallChoices = { camera: true, microphone: false, cameraId: '', microphoneId: '', speakerId: '', background: 'blur', photoUrl: '', mirror: true }
  await act(async () => root.render(<CallConnection session={{ meetingId: 'meeting-1', serverUrl: 'wss://test', token: 'token', canHost: false }} choices={choices} onError={vi.fn()} onDisconnected={vi.fn()} onMediaDeviceFailure={vi.fn()} onIssue={vi.fn()}><div>Home page</div></CallConnection>))
  expect(host.textContent).toContain('Home page')
  expect(mock.background).toHaveBeenCalledWith(expect.anything(), choices)
  expect(mock.setAttributes).toHaveBeenCalledWith({ 'collabify.mirror': '1' })
})
