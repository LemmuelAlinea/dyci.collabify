// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CallControls, pushToTalkAllowed } from './CallControls'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const microphone = vi.fn()
const camera = vi.fn()

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  microphone.mockReset()
  camera.mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

const show = (hostMuted = false) => act(async () => root.render(<CallControls microphone={false} camera={false} screen={false}
  hostMuted={hostMuted} onMicrophone={microphone} onCamera={camera} onScreen={vi.fn()} onLeave={vi.fn()}
  onSettings={vi.fn()} onCopy={vi.fn()} />))
const button = (name: string) => host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement

it('shows microphone and camera controls', async () => {
  await show()
  await act(async () => button('Turn on microphone').click())
  await act(async () => button('Turn on camera').click())
  expect(microphone).toHaveBeenCalledWith(true)
  expect(camera).toHaveBeenCalledWith(true)
})

it('remutes after push to talk is released', async () => {
  await show()
  await act(async () => button('Push to talk').dispatchEvent(new Event('pointerdown', { bubbles: true })))
  await act(async () => button('Push to talk').dispatchEvent(new Event('pointerup', { bubbles: true })))
  expect(microphone.mock.calls.map((call) => call[0])).toEqual([true, false])
})

it('ignores Space while typing and blocks a host-muted microphone', async () => {
  await show()
  const chat = document.createElement('textarea')
  document.body.append(chat)
  expect(pushToTalkAllowed(chat)).toBe(false)
  await act(async () => chat.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true })))
  expect(microphone).not.toHaveBeenCalled()
  chat.remove()
  await show(true)
  expect(button('Turn on microphone').disabled).toBe(true)
  expect(button('Push to talk').disabled).toBe(true)
})
