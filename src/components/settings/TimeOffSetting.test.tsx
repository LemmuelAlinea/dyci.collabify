// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TimeOffSetting } from './TimeOffSetting'
import { deleteTimeOff, listMyTimeOff, saveTimeOff, saveTimeOffRange } from '../../lib/api/workload'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/workload', () => ({
  listMyTimeOff: vi.fn(),
  saveTimeOff: vi.fn(),
  deleteTimeOff: vi.fn(),
  saveTimeOffRange: vi.fn(async () => 3),
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }))

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.mocked(listMyTimeOff).mockReset().mockResolvedValue([
    { id: 'a', off_on: '2026-11-24', minutes: 240 },
    { id: 'b', off_on: '2026-11-25', minutes: null, added_by: 'pm', added_by_name: 'Lemmuel Alinea' },
  ])
  vi.mocked(saveTimeOff).mockReset().mockResolvedValue(undefined)
  vi.mocked(deleteTimeOff).mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const draw = () => act(async () => root.render(<TimeOffSetting />))
const typeInto = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const dateInput = () => host.querySelector<HTMLInputElement>('input[type="date"]')!
const hoursInput = () => host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!

it('lists upcoming entries', async () => {
  await draw()
  expect(host.textContent).toContain('Tue 24 Nov · 4 h')
  expect(host.textContent).toContain('Wed 25 Nov · Full day')
})

it('adds a full day', async () => {
  await draw()
  await typeInto(dateInput(), '2026-11-25')
  await act(async () => button('Add time off').click())
  expect(saveTimeOff).toHaveBeenCalledWith('2026-11-25', null)
})

it('adds hours', async () => {
  await draw()
  await typeInto(dateInput(), '2026-11-26')
  await typeInto(hoursInput(), '4')
  await act(async () => button('Add time off').click())
  expect(saveTimeOff).toHaveBeenCalledWith('2026-11-26', 240)
})

it('refuses hours that are not a number', async () => {
  await draw()
  await typeInto(dateInput(), '2026-11-26')
  await typeInto(hoursInput(), 'abc')
  await act(async () => button('Add time off').click())
  expect(saveTimeOff).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Enter hours as a number')
})

it('removes an entry', async () => {
  await draw()
  await act(async () => button('Remove').click())
  expect(deleteTimeOff).toHaveBeenCalledWith('a')
})

it('says the space sees away days, never a reason', async () => {
  await draw()
  expect(host.textContent).toContain('see the days you are away, never a reason')
})

it('refuses more than 24 hours for one day', async () => {
  await draw()
  await typeInto(dateInput(), '2026-11-26')
  await typeInto(hoursInput(), '25')
  await act(async () => button('Add time off').click())
  expect(saveTimeOff).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Enter up to 24 hours for one day.')
})

it('range saves through RPC', async () => {
  await draw()
  await typeInto(dateInput(), '2026-11-26')
  await typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Last day off"]')!, '2026-11-28')
  await act(async () => button('Add time off').click())
  expect(saveTimeOffRange).toHaveBeenCalledWith('me', '2026-11-26', '2026-11-28', null)
  expect(saveTimeOff).not.toHaveBeenCalled()
})

it('added by shown', async () => {
  await draw()
  expect(host.textContent).toContain('Wed 25 Nov · Full day · Added by Lemmuel Alinea')
  expect(host.textContent).not.toContain('Tue 24 Nov · 4 h · Added by')
})
