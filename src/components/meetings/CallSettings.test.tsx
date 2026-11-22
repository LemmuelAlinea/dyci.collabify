// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Room } from 'livekit-client'
import { afterEach, expect, it, vi } from 'vitest'
import { CallSettings } from './CallSettings'
import type { CallChoices } from './CallPrejoin'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [] } })
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('publishes a mirror preference to the other call participants', async () => {
  const setAttributes = vi.fn().mockResolvedValue(undefined)
  const room = { localParticipant: { setAttributes } } as unknown as Room
  const onChange = vi.fn()
  const choices = { camera: true, microphone: false, cameraId: '', microphoneId: '', speakerId: '', background: 'off', photoUrl: '', mirror: false } satisfies CallChoices
  await act(async () => root.render(<CallSettings room={room} choices={choices} onChange={onChange} onClose={vi.fn()} />))
  const mirror = host.querySelector('input[type="checkbox"]') as HTMLInputElement
  await act(async () => { mirror.click() })
  expect(onChange).toHaveBeenCalledWith({ ...choices, mirror: true })
  expect(setAttributes).toHaveBeenCalledWith({ 'collabify.mirror': '1' })
})
