// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SprintHoursLine } from './SprintHoursLine'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('sprint hours line', async () => {
  const load = vi.fn(async () => ({ available_minutes: 3840, away_minutes: 480, planned_minutes: 4200, unassigned: 2, people_without_hours: 1 }))
  await act(async () => root.render(<SprintHoursLine sprintId="s1" load={load} />))
  await act(async () => {})
  expect(load).toHaveBeenCalledWith('s1')
  expect(host.textContent).toContain('Team hours 64 h (8 h away) · Planned 70 h')
  expect(host.textContent).toContain('2 tasks have no holder')
  expect(host.textContent).toContain('1 person has no weekly hours')
})

it('class source shows no sprint hours', async () => {
  await act(async () => root.render(<SprintHoursLine sprintId="s1" />))
  expect(host.innerHTML).toBe('')
})

it('planned over hours warns', async () => {
  const load = vi.fn(async () => ({ available_minutes: 600, away_minutes: 0, planned_minutes: 900, unassigned: 0, people_without_hours: 0 }))
  await act(async () => root.render(<SprintHoursLine sprintId="s1" load={load} />))
  await act(async () => {})
  expect(host.textContent).toBe('Team hours 10 h · Planned 15 h')
  expect(host.querySelector('[data-over]')).not.toBeNull()
})
