// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MilestonesSection } from './MilestonesSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { updateGeneralProject } from '../../../lib/api/general'
import { DEFAULT_MILESTONE_RULES } from '../../../lib/general/milestoneRules'
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
    project: { id: 'p1', name: 'Alpha', updated_at: 't1', ...project },
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
  act(async () => root.render(<MemoryRouter><MilestonesSection state={state} /></MemoryRouter>))
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
const labelled = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)
const completion = () => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === 'Completion')
  return l ? host.querySelector<HTMLSelectElement>(`select[id="${l.htmlFor}"]`) : null
}
const choose = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })

const SWITCHES = ['Require a due date', 'Allow milestone dependencies']

it('shows the completion select with both choices and the two switches', async () => {
  await show(makeState())
  expect([...completion()!.options].map((o) => o.textContent)).toEqual([
    'Automatic — when all its tasks are done',
    'Manual — when someone marks it',
  ])
  expect(completion()!.value).toBe('automatic')
  for (const name of SWITCHES) expect(labelled(name)?.getAttribute('role')).toBe('switch')
  expect(labelled('Overdue milestone alerts')).toBeNull()
  expect(host.textContent).not.toContain('Overdue milestone alerts')
})

it('starts from the saved rules of the project', async () => {
  await show(
    makeState({}, { milestoneRules: { completion: 'manual', requireDue: false, allowDependencies: false, overdueAlerts: false } }),
  )
  expect(completion()!.value).toBe('manual')
  for (const name of SWITCHES) expect(labelled(name)!.getAttribute('aria-checked')).toBe('false')
})

it('saves the rules as snake_case columns in one call, then reloads and says so', async () => {
  await show(makeState())
  await choose(completion()!, 'manual')
  await act(async () => labelled('Require a due date')!.click())
  await act(async () => button('Save milestone settings')!.click())
  expect(updateGeneralProject).toHaveBeenCalledTimes(1)
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    milestone_completion: 'manual',
    require_milestone_due: false,
    allow_milestone_dependencies: true,
  })
  expect(reload).toHaveBeenCalled()
  expect(useToast().show).toHaveBeenCalledWith('Milestone settings saved')
})

it('shows the error and skips the reload when saving fails', async () => {
  vi.mocked(updateGeneralProject).mockRejectedValueOnce(new Error('boom'))
  await show(makeState())
  await act(async () => button('Save milestone settings')!.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('boom')
  expect(reload).not.toHaveBeenCalled()
})

it('disables every control and offers no save to somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, myRole: 'member' }))
  expect(completion()!.disabled).toBe(true)
  for (const name of SWITCHES) expect(labelled(name)!.disabled).toBe(true)
  expect(button('Save milestone settings')).toBeUndefined()
})

it('reads only while the project is read-only', async () => {
  await show(makeState({ readOnly: true }))
  expect(completion()!.disabled).toBe(true)
  expect(button('Save milestone settings')).toBeUndefined()
})

it('keeps unsaved choices through unrelated project updates and resets for a new project', async () => {
  await show(makeState())
  await choose(completion()!, 'manual')
  await show(makeState({}, { updated_at: 't2' }))
  expect(completion()!.value).toBe('manual')
  await show(makeState({}, { id: 'p2', updated_at: 't2' }))
  expect(completion()!.value).toBe(DEFAULT_MILESTONE_RULES.completion)
})
