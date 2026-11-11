// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageZoom } from './PageZoom'
import { ZOOM_GLIDE_MS, ZOOM_KEY } from '../../lib/zoom'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
// happy-dom does not know `zoom`; a browser that does is the case under test.
vi.stubGlobal('CSS', { supports: () => true })

const h = vi.hoisted(() => ({ reduce: false }))
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  useReducedMotion: () => h.reduce,
}))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const html = document.documentElement
const zoomVar = () => html.style.getPropertyValue('--zoom')
const slider = () => host.querySelector<HTMLInputElement>('input[type="range"]')!
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const resetButton = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Reset'))!
const pointer = (type: string) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, pointerType: 'touch' })

async function mount() {
  await act(async () => root.render(<PageZoom />))
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  })
  window.localStorage.clear()
  html.style.removeProperty('zoom')
  html.style.removeProperty('--zoom')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  h.reduce = false
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

it('steps one percent per tap and glides the page there', async () => {
  await mount()
  await act(async () => button('Zoom in').click())
  expect(slider().value).toBe('101')
  expect(window.localStorage.getItem(ZOOM_KEY)).toBe('101')

  await advance(16)
  const first = Number(zoomVar())
  expect(first).toBeGreaterThan(1)
  expect(first).toBeLessThan(1.01)

  await advance(ZOOM_GLIDE_MS)
  expect(zoomVar()).toBe('1.01')
})

it('passes through the sizes between, easing out', async () => {
  window.localStorage.setItem(ZOOM_KEY, '130')
  html.style.setProperty('--zoom', '1.3')
  await mount()
  expect(slider().value).toBe('130')

  await act(async () => resetButton().click())
  const drawn: number[] = []
  for (let t = 0; t < ZOOM_GLIDE_MS + 32; t += 16) {
    await advance(16)
    drawn.push(Number(zoomVar() || '1'))
  }
  // Shrinking all the way, never back up, with frames between the two ends.
  expect(drawn.every((z, i) => i === 0 || z <= drawn[i - 1])).toBe(true)
  expect(drawn.filter((z) => z < 1.3 && z > 1).length).toBeGreaterThan(5)
  // Quicker at the start than at the end.
  expect(1.3 - drawn[0]).toBeGreaterThan(drawn[drawn.length - 4] - 1)
  expect(zoomVar()).toBe('')
  expect(window.localStorage.getItem(ZOOM_KEY)).toBeNull()
})

it('jumps straight there with reduced motion', async () => {
  h.reduce = true
  await mount()
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(slider(), '120')
    slider().dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(zoomVar()).toBe('1.2')
})

it('keeps stepping while a button is held, without an extra step on release', async () => {
  await mount()
  const plus = button('Zoom in')
  await act(async () => plus.dispatchEvent(pointer('pointerdown')))
  await advance(399)
  expect(slider().value).toBe('100')

  await advance(1 + 45 * 10)
  expect(slider().value).toBe('111')

  await act(async () => {
    plus.dispatchEvent(pointer('pointerup'))
    plus.click()
  })
  await advance(500)
  expect(slider().value).toBe('111')

  // The next plain tap counts again.
  await act(async () => plus.click())
  expect(slider().value).toBe('112')
})

it('stops at the top of the range', async () => {
  window.localStorage.setItem(ZOOM_KEY, '130')
  await mount()
  await act(async () => button('Zoom in').click())
  expect(slider().value).toBe('130')
  expect(button('Zoom in').getAttribute('aria-disabled')).toBe('true')
})
