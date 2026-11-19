// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActiveNowStrip } from './ActiveNowStrip'
import type { ActiveContact } from '../../lib/api/presence'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const NOW = Date.parse('2026-11-20T10:00:00Z')
const person = (id: string, first: string, last: string, secsAgo: number): ActiveContact => ({
  id,
  first_name: first,
  last_name: last,
  avatar_url: null,
  last_seen_at: new Date(NOW - secsAgo * 1000).toISOString(),
})
const ana = person('a', 'Ana', 'Cruz', 30)
const ben = person('b', 'Ben', 'Reyes', 12 * 60)

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const draw = (contacts: ActiveContact[], onOpen = vi.fn(), busyId: string | null = null) =>
  act(() => root.render(<ActiveNowStrip contacts={contacts} onOpen={onOpen} busyId={busyId} />))
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

it('renders nothing when empty', () => {
  draw([])
  expect(host.innerHTML).toBe('')
})

it('shows a dot for active now and a minute label otherwise', () => {
  draw([ana, ben])
  expect(button('Ana Cruz, active now')?.querySelector('[data-presence-dot]')).not.toBeNull()
  expect(button('Ana Cruz, active now')?.textContent).not.toMatch(/\dm/)
  expect(button('Ben Reyes, active 12m ago')?.querySelector('[data-presence-dot]')).toBeNull()
  expect(button('Ben Reyes, active 12m ago')?.textContent).toContain('12m')
})

it("calls onOpen with the person's id", () => {
  const onOpen = vi.fn()
  draw([ana, ben], onOpen)
  act(() => button('Ben Reyes, active 12m ago')?.click())
  expect(onOpen).toHaveBeenCalledWith('b')
})

it("disables the busy person's button", () => {
  draw([ana, ben], vi.fn(), 'a')
  expect(button('Ana Cruz, active now')?.disabled).toBe(true)
  expect(button('Ben Reyes, active 12m ago')?.disabled).toBe(false)
})

it('names each person with their status', () => {
  draw([ana])
  expect(button('Ana Cruz, active now')).not.toBeNull()
  expect(host.textContent).toContain('Active now')
})
