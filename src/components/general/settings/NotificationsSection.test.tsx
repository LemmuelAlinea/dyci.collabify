// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NotificationsSection } from './NotificationsSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { updateGeneralProject } from '../../../lib/api/general'
import { DEFAULT_NOTIFICATION_RULES } from '../../../lib/general/notificationRules'
import { useToast } from '../../ui/Toast'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})
vi.mock('../../../lib/api/general', () => ({ updateGeneralProject: vi.fn(async () => {}) }))

const reload = vi.fn(async () => {})

function makeState(over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) {
  return {
    project: {
      id: 'p1',
      name: 'Alpha',
      updated_at: 't1',
      notificationRules: DEFAULT_NOTIFICATION_RULES,
      milestoneRules: { completion: 'automatic', requireDue: true, allowDependencies: true, overdueAlerts: true },
      ...project,
    },
    myRole: 'pm', myOpenRequests: [], myGrants: [], can: () => true, readOnly: false, archived: false, reload,
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

const show = (state: GeneralProjectState) =>
  act(async () => root.render(<MemoryRouter><NotificationsSection state={state} /></MemoryRouter>))
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const labelled = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)
const select = (name: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === name)
  return l ? host.querySelector<HTMLSelectElement>(`select[id="${l.htmlFor}"]`) : null
}
const choose = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })

const SWITCHES = ['Overdue task alerts', 'Overdue milestone alerts', 'Task assignment notices', 'Sprint completion notices']

it('shows the help, both selects with their choices and the four switches, in order', async () => {
  await show(makeState())
  expect(host.textContent).toContain(
    'These decide what this project sends. Each person can still turn notices off for themselves in Account → Notifications.',
  )
  expect([...select('Sprint ending reminder')!.options].map((o) => o.textContent)).toEqual([
    'Off', '1 day before', '2 days before', '3 days before',
  ])
  expect([...select('Milestone due reminder')!.options].map((o) => o.textContent)).toEqual([
    'Off', '1 day before', '2 days before', '3 days before', '1 week before',
  ])
  for (const name of SWITCHES) expect(labelled(name)?.getAttribute('role')).toBe('switch')
  expect(host.textContent).toContain('The project manager and coordinators are told the morning after a missed due date.')
  const text = host.textContent ?? ''
  const order = [
    'Sprint ending reminder', 'Overdue task alerts', 'Milestone due reminder',
    'Overdue milestone alerts', 'Task assignment notices', 'Sprint completion notices',
  ].map((t) => text.indexOf(t))
  expect(order.every((i) => i >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
})

it('starts from the saved rules of the project', async () => {
  await show(
    makeState({}, {
      notificationRules: { sprintEndDays: 3, taskOverdue: false, milestoneDueDays: 7, assignment: false, sprintCompletion: false },
      milestoneRules: { completion: 'automatic', requireDue: true, allowDependencies: true, overdueAlerts: false },
    }),
  )
  expect(select('Sprint ending reminder')!.value).toBe('3')
  expect(select('Milestone due reminder')!.value).toBe('7')
  for (const name of SWITCHES) expect(labelled(name)!.getAttribute('aria-checked')).toBe('false')
})

it('saves the six columns in one call, then reloads and says so', async () => {
  await show(makeState())
  await choose(select('Sprint ending reminder')!, '3')
  await choose(select('Milestone due reminder')!, '7')
  await act(async () => labelled('Overdue task alerts')!.click())
  await act(async () => labelled('Overdue milestone alerts')!.click())
  await act(async () => button('Save notification settings')!.click())
  expect(updateGeneralProject).toHaveBeenCalledTimes(1)
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    sprint_end_reminder_days: 3,
    task_overdue_alerts: false,
    milestone_due_reminder_days: 7,
    milestone_overdue_alerts: false,
    task_assignment_notices: true,
    sprint_completion_notices: true,
  })
  expect(reload).toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Notification settings saved')
})

it('saves Off as null for both reminders', async () => {
  await show(makeState())
  await choose(select('Sprint ending reminder')!, '')
  await choose(select('Milestone due reminder')!, '')
  await act(async () => button('Save notification settings')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith(
    'p1',
    expect.objectContaining({ sprint_end_reminder_days: null, milestone_due_reminder_days: null }),
  )
})

it('shows the error and skips the reload when saving fails', async () => {
  vi.mocked(updateGeneralProject).mockRejectedValueOnce(new Error('boom'))
  await show(makeState())
  await act(async () => button('Save notification settings')!.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('boom')
  expect(reload).not.toHaveBeenCalled()
})

it('disables every control and offers no save to somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, myRole: 'member' }))
  expect(select('Sprint ending reminder')!.disabled).toBe(true)
  expect(select('Milestone due reminder')!.disabled).toBe(true)
  for (const name of SWITCHES) expect(labelled(name)!.disabled).toBe(true)
  expect(button('Save notification settings')).toBeUndefined()
})

it('reads only while the project is archived or read-only', async () => {
  await show(makeState({ readOnly: true, archived: true }))
  expect(select('Sprint ending reminder')!.disabled).toBe(true)
  expect(button('Save notification settings')).toBeUndefined()
})

it('keeps unsaved choices through unrelated project updates and resets for a new project', async () => {
  await show(makeState())
  await choose(select('Sprint ending reminder')!, '3')
  await show(makeState({}, { updated_at: 't2' }))
  expect(select('Sprint ending reminder')!.value).toBe('3')
  await show(makeState({}, { id: 'p2', updated_at: 't2' }))
  expect(select('Sprint ending reminder')!.value).toBe(String(DEFAULT_NOTIFICATION_RULES.sprintEndDays))
})
