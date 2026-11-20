// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CallPrejoin } from './CallPrejoin'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => { localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('offers the supplied photo without accessing media before Start', async () => {
  const enter = vi.fn()
  await act(async () => root.render(<CallPrejoin title="Call" canStart onEnter={enter} busy={false} error={null} />))
  const background = [...host.querySelectorAll('select')].find((element) => element.parentElement?.textContent?.includes('Background'))!
  await act(async () => { background.value = 'photo'; background.dispatchEvent(new Event('change', { bubbles: true })) })
  const start = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Start call')!
  await act(async () => start.click())
  expect(enter).toHaveBeenCalledWith(expect.objectContaining({ background: 'photo', photoUrl: '/video/call-background.png' }))
})
