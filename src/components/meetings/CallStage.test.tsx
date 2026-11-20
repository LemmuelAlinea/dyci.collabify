// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ speaking: false, microphone: false, muted: false, remote: false, screen: false, mirrored: false }))
const participant = { identity: 'member-1', name: 'Member One', isLocal: true }
const remoteParticipant = { identity: 'member-2', name: 'Member Two', isLocal: false }
vi.mock('@livekit/components-react', () => ({
  RoomAudioRenderer: () => null,
  VideoTrack: ({ trackRef, className }: { trackRef: { participant: { name: string }, source: string }, className: string }) => <span className={className}>{trackRef.participant.name} {trackRef.source === 'screen_share' ? 'screen' : 'video'}</span>,
  useTracks: () => [{ participant, source: 'camera' }, ...(state.remote ? [{ participant: remoteParticipant, source: 'camera', publication: { track: {} } }] : []), ...(state.screen ? [{ participant: remoteParticipant, source: 'screen_share', publication: { track: {} } }] : [])],
  useSpeakingParticipants: () => [],
  useParticipantAttribute: (key: string, { participant: who }: { participant: { isLocal: boolean } }) => key === 'collabify.mirror' && !who.isLocal && state.mirrored ? '1' : undefined,
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
  state.screen = false
  state.mirrored = false
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

it('keeps other participants beside a pin and restores grid when unpinned', async () => {
  state.remote = true
  await act(async () => root.render(<CallStage />))
  expect(host.querySelectorAll('.aspect-video')).toHaveLength(2)
  await act(async () => (host.querySelector('[aria-label="Pin Member Two"]') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Featured video"]')?.textContent).toContain('Member Two video')
  expect(host.querySelector('[aria-label="Featured video"]')?.parentElement?.className).toContain('flex-1')
  expect(host.querySelector('[aria-label="Other participants"]')?.textContent).toContain('Member One')
  expect(host.querySelector('[aria-label="Featured video"]')?.querySelector('.border-2')).not.toBeNull()
  expect(host.querySelector('[aria-label="Other participants"]')?.querySelector('.border-2')).not.toBeNull()
  await act(async () => (host.querySelector('[aria-label="Unpin Member Two"]') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Featured video"]')).toBeNull()
  expect(host.querySelectorAll('.aspect-video')).toHaveLength(2)
})

it('enlarges video inside the call and restores the previous layout', async () => {
  state.remote = true
  await act(async () => root.render(<CallStage />))
  await act(async () => (host.querySelector('[aria-label="Maximize Member Two"]') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Featured video"]')?.textContent).toContain('Member Two video')
  expect(host.querySelector('[aria-label="Other participants"]')?.textContent).toContain('Member One')
  expect(host.querySelector('.fixed.inset-0')).toBeNull()
  await act(async () => (host.querySelector('[aria-label="Restore Member Two"]') as HTMLButtonElement).click())
  expect(host.querySelector('[aria-label="Featured video"]')).toBeNull()
})

it('mirrors only the remote participant camera when requested', async () => {
  state.remote = true
  state.screen = true
  state.mirrored = true
  await act(async () => root.render(<CallStage />))
  const remote = [...host.querySelectorAll('video,span')].find((element) => element.textContent === 'Member Two video')!
  expect(remote.classList.contains('scale-x-[-1]')).toBe(true)
  const screen = [...host.querySelectorAll('video,span')].find((element) => element.textContent === 'Member Two screen')!
  expect(screen.classList.contains('scale-x-[-1]')).toBe(false)
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
