// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SprintsSection } from './SprintsSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { saveSprintSettings } from '../../../lib/api/sprints'
import { DEFAULT_SPRINT_SETTINGS } from '../../../lib/work/sprintSettings'
import type { SprintSettings } from '../../../lib/work/sprintSettings'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
const show = vi.fn()
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ show }) }))
vi.mock('../../../lib/api/sprints', () => ({ saveSprintSettings: vi.fn(async () => {}) }))

const reload = vi.fn(async () => {})

function makeState(over: Record<string, unknown> = {}, settings: Partial<SprintSettings> = {}) {
  return {
    project: { id: 'p1', name: 'Alpha' },
    sprints: [],
    sprintSettings: { ...DEFAULT_SPRINT_SETTINGS, ...settings },
    myRole: 'pm',
    readOnly: false,
    reload,
    ...over,
  } as unknown as GeneralProjectState
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const render = (state: GeneralProjectState) => act(async () => root.render(<SprintsSection state={state} />))
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)
const control = <T extends HTMLElement>(label: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent?.trim() === label)
  return document.getElementById(l!.htmlFor) as T
}
const pick = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

it('shows every control disabled to somebody who cannot change them', async () => {
  await render(makeState({ myRole: 'member' }, { autoFinish: true, carry: 'backlog', lengthDays: 10 }))
  const controls = host.querySelectorAll<HTMLInputElement>('input, select, button[role="switch"], button[role="radio"]')
  expect(controls.length).toBeGreaterThan(6)
  for (const c of controls) expect(c.disabled).toBe(true)
  expect(button('Save sprint settings')).toBeUndefined()
  expect(control<HTMLInputElement>('Default sprint length').value).toBe('10')
  expect(button('Finish sprints automatically')!.getAttribute('aria-checked')).toBe('true')
  expect(host.textContent).toContain(
    'Only the project manager and coordinators can change these. Changes apply to this project only.',
  )
})

it('disables the controls while the project is read-only', async () => {
  await render(makeState({ readOnly: true }))
  expect(button('Finish sprints automatically')!.disabled).toBe(true)
})

it('moves unfinished tasks to the next sprint when auto-finish turns on over "Ask on finish"', async () => {
  await render(makeState())
  const carry = control<HTMLSelectElement>('Unfinished tasks at finish')
  expect(carry.value).toBe('ask')
  await act(async () => button('Finish sprints automatically')!.click())
  expect(carry.value).toBe('next')
  expect([...carry.options].find((o) => o.value === 'ask')!.disabled).toBe(true)
  expect(host.textContent).toContain('Unfinished tasks will move to the next sprint. You can choose the backlog instead.')
  await act(async () => button('Finish sprints automatically')!.click())
  expect([...carry.options].find((o) => o.value === 'ask')!.disabled).toBe(false)
  expect(carry.value).toBe('next')
})

it('saves the edited values, keeping the start day derived when it is untouched', async () => {
  await render(makeState())
  await act(async () => button('Start the next sprint automatically')!.click())
  await pick(control<HTMLSelectElement>('Unfinished tasks at finish'), 'backlog')
  await type(control<HTMLInputElement>('Default sprint length'), '7')
  await pick(control<HTMLSelectElement>('Start and finish time'), '17:30')
  await act(async () => button('Save sprint settings')!.click())
  expect(saveSprintSettings).toHaveBeenCalledWith('p1', {
    autoFinish: false, autoStart: true, carry: 'backlog', lengthDays: 7, startWeekday: null, runAt: '17:30',
  })
  expect(reload).toHaveBeenCalled()
  expect(show).toHaveBeenCalledWith('Sprint settings saved')
})

it('saves a start day once somebody picks one', async () => {
  await render(makeState())
  expect(control<HTMLSelectElement>('Sprint start day').value).toBe('1')
  await pick(control<HTMLSelectElement>('Sprint start day'), '3')
  await act(async () => button('Save sprint settings')!.click())
  expect(saveSprintSettings).toHaveBeenCalledWith('p1', expect.objectContaining({ startWeekday: 3 }))
})

it('never sends auto-finish together with "Ask on finish"', async () => {
  await render(makeState())
  await act(async () => button('Finish sprints automatically')!.click())
  await act(async () => button('Save sprint settings')!.click())
  expect(saveSprintSettings).toHaveBeenCalledWith('p1', expect.objectContaining({ autoFinish: true, carry: 'next' }))
})

it('keeps a saved time that is not on the half hour', async () => {
  await render(makeState({}, { runAt: '09:15' }))
  const time = control<HTMLSelectElement>('Start and finish time')
  expect(time.value).toBe('09:15')
  expect([...time.options].map((o) => o.value)).toContain('09:00')
})

it('refuses a length outside 1 to 90 days', async () => {
  await render(makeState())
  await type(control<HTMLInputElement>('Default sprint length'), '91')
  await act(async () => button('Save sprint settings')!.click())
  expect(host.textContent).toContain('Use a length from 1 to 90 days.')
  expect(saveSprintSettings).not.toHaveBeenCalled()
})

it('shows what went wrong when the save fails', async () => {
  vi.mocked(saveSprintSettings).mockRejectedValueOnce(new Error('Those sprint settings did not save.'))
  await render(makeState())
  await act(async () => button('Save sprint settings')!.click())
  expect(host.textContent).toContain('Those sprint settings did not save.')
  expect(show).not.toHaveBeenCalled()
})

it('lists the two later organizations as disabled options and keeps Sequential selected', async () => {
  await render(makeState())
  const soon1 = button('Multiple sprint streams · soon')!
  const soon2 = button('Flexible parallel · soon')!
  expect(soon1.disabled).toBe(true)
  expect(soon2.disabled).toBe(true)
  expect(button('Sequential')!.getAttribute('aria-checked')).toBe('true')
  await act(async () => soon1.click())
  expect(button('Sequential')!.getAttribute('aria-checked')).toBe('true')
})
