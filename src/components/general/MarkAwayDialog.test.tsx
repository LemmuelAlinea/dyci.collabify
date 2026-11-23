// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarkAwayDialog } from './MarkAwayDialog'
import { saveTimeOffRange } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({ saveTimeOffRange: vi.fn(async () => 3) }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

const field = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const typeInto = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!

async function render(initial?: { from: string; to: string }) {
  const onSaved = vi.fn()
  await act(async () => root.render(
    <MarkAwayDialog open userId="ivan" name="Ivan Cruz" initial={initial} onClose={vi.fn()} onSaved={onSaved} />,
  ))
  return onSaved
}

it('mark away saves', async () => {
  const onSaved = await render()
  expect(document.body.textContent).toContain('Best guess is fine. You can extend it.')
  await typeInto(field('First day away'), '2026-11-26')
  await typeInto(field('Last day away'), '2026-11-28')
  await act(async () => button('Mark away').click())
  expect(saveTimeOffRange).toHaveBeenCalledWith('ivan', '2026-11-26', '2026-11-28', null)
  expect(onSaved).toHaveBeenCalled()
})

it('hours a day', async () => {
  await render()
  await typeInto(field('First day away'), '2026-11-26')
  await typeInto(field('Last day away'), '2026-11-26')
  await typeInto(field('Hours away each day'), '4')
  await act(async () => button('Mark away').click())
  expect(saveTimeOffRange).toHaveBeenCalledWith('ivan', '2026-11-26', '2026-11-26', 240)
})

it('extends from the current leave', async () => {
  await render({ from: '2026-11-26', to: '2026-11-28' })
  expect(field('First day away').value).toBe('2026-11-26')
  expect(field('Last day away').value).toBe('2026-11-28')
})

it('refuses a backwards range', async () => {
  await render()
  await typeInto(field('First day away'), '2026-11-28')
  await typeInto(field('Last day away'), '2026-11-26')
  await act(async () => button('Mark away').click())
  expect(saveTimeOffRange).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Choose a start date on or before the end date.')
})
