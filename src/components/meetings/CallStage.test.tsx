// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ speaking: false, microphone: false, muted: false, remote: false }))
const participant = { identity: 'member-1', name: 'Member One', isLocal: true }
const remoteParticipant = { identity: 'member-2', name: 'Member Two', isLocal: false }
vi.mock('@livekit/components-react', () => ({
  RoomAudioRenderer: () => null,
  VideoTrack: ({ trackRef }: { trackRef: { participant: { name: string } } }) => <span>{trackRef.participant.name} video</span>,
  useTracks: () => [{ participant, source: 'camera' }, ...(state.remote ? [{ participant: remoteParticipant, source: 'camera', publication: { track: {} } }] : [])],
  useSpeakingParticipants: () => [],
  useParticipantAttribute: () => undefined,
  useIsSpeaking: () => state.speaking,
  useParticipantTracks: () => state.microphone ? [{ participant, source: 'microphone', publication: {} }] : [],
  useIsMuted: () => state.muted,
}))
import { CallStage } from './CallStage'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  state.speaking = false
  state.microphone = false
  state.muted = false
  state.remote = false
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

it('renders a subscribed remote camera beside the local tile', async () => {
  state.remote = true
  await act(async () => root.render(<CallStage />))
  expect(host.textContent).toContain('Member Two video')
  expect(host.textContent).toContain('2 video tiles')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('shows microphone status and highlights the tile while speaking', async () => {
  await act(async () => root.render(<CallStage />))
  expect(host.querySelector('[aria-label="Microphone off"]')).not.toBeNull()
  expect(host.querySelector('.border-success-500')).toBeNull()

  state.microphone = true
  state.speaking = true
  await act(async () => root.render(<CallStage />))
  expect(host.querySelector('[aria-label="Microphone on"]')).not.toBeNull()
  expect(host.querySelector('.border-success-500')).not.toBeNull()

  state.muted = true
  state.speaking = false
  await act(async () => root.render(<CallStage />))
  expect(host.querySelector('[aria-label="Microphone off"]')).not.toBeNull()
  expect(host.querySelector('.border-success-500')).toBeNull()
})
