// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePresenceHeartbeat } from './usePresenceHeartbeat'
import { touchPresence } from '../lib/api/presence'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../lib/api/presence', () => ({ touchPresence: vi.fn(async () => {}) }))

function Probe({ enabled }: { enabled: boolean }) {
  usePresenceHeartbeat(enabled)
  return null
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(touchPresence).mockClear()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const mount = (enabled = true) => act(() => root.render(<Probe enabled={enabled} />))
const calls = () => vi.mocked(touchPresence).mock.calls.length

it('beats on mount', () => {
  mount()
  expect(calls()).toBe(1)
})

it('beats every 60 seconds while visible', () => {
  mount()
  act(() => vi.advanceTimersByTime(120_000))
  expect(calls()).toBe(3)
})

it('does not beat while hidden', () => {
  mount()
  visibility = 'hidden'
  act(() => vi.advanceTimersByTime(180_000))
  expect(calls()).toBe(1)
  visibility = 'visible'
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(calls()).toBe(2)
})

it('beats when the window regains focus', () => {
  mount()
  act(() => window.dispatchEvent(new Event('focus')))
  expect(calls()).toBe(2)
})

it('does nothing when disabled', () => {
  mount(false)
  act(() => vi.advanceTimersByTime(120_000))
  expect(calls()).toBe(0)
})

it('stops after unmount', () => {
  mount()
  act(() => root.unmount())
  act(() => vi.advanceTimersByTime(120_000))
  expect(calls()).toBe(1)
  root = createRoot(host)
})
