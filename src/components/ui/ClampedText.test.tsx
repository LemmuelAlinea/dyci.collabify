// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ClampedText } from './ClampedText'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
})

it('expands overflowing text inline and collapses it again', async () => {
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 120 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 40 })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  try {
    await act(async () => root.render(<ClampedText text="A long class description" lines={2} />))
    expect(host.querySelector('p')?.classList.contains('line-clamp-2')).toBe(true)
    await act(async () => host.querySelector('button')?.click())
    expect(host.querySelector('p')?.classList.contains('line-clamp-2')).toBe(false)
    expect(host.querySelector('button')?.textContent).toBe('See less')
    await act(async () => host.querySelector('button')?.click())
    expect(host.querySelector('p')?.classList.contains('line-clamp-2')).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
    if (client) Object.defineProperty(HTMLElement.prototype, 'clientHeight', client)
    else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  }
})
