// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GeneralSection } from './GeneralSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { archiveGeneralProject, updateGeneralProject } from '../../../lib/api/general'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
const looksChanged = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/useProjectLooks', () => ({ notifyLooksChanged: looksChanged }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../lib/api/general', () => ({
  archiveGeneralProject: vi.fn(async () => {}),
  updateGeneralProject: vi.fn(async () => {}),
  clearFieldValue: vi.fn(),
  deleteField: vi.fn(),
  setFieldValue: vi.fn(),
  updateField: vi.fn(),
}))

const reload = vi.fn(async () => {})

function makeState(over: Record<string, unknown> = {}, project: Record<string, unknown> = {}) {
  return {
    project: {
      id: 'p1', name: 'Alpha', description: 'Agreed brief', status: 'planning', starts_on: null, ends_on: null,
      stages: null, qa_stage: null, updated_at: 't1', class_board_id: null, ...project,
    },
    fields: [], values: [], members: [], myRole: 'pm', myOpenRequests: [], myGrants: [],
    can: () => true, readOnly: false, archived: false, isOwner: true,
    nameOf: () => '', reload,
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
  act(async () => root.render(<MemoryRouter><GeneralSection state={state} /></MemoryRouter>))
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)
const type = async (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

it('reads the details and offers no inputs to somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, isOwner: false, myRole: 'member' }))
  expect(host.textContent).toContain('Agreed brief')
  expect(host.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')).toBeNull()
  expect(button(host, 'Edit details')).toBeUndefined()
  expect(button(host, 'Archive project')).toBeUndefined()
})

it('reads only, even with the permission, while the project is read-only', async () => {
  await show(makeState({ readOnly: true, archived: true }))
  expect(host.querySelector('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')).toBeNull()
  expect(button(host, 'Edit details')).toBeUndefined()
})

it('saves the details without touching the stages', async () => {
  await show(makeState())
  await act(async () => button(host, 'Edit details')!.click())
  await type(host.querySelector<HTMLInputElement>('input')!, '  Alpha two ')
  await act(async () => button(host, 'Save details')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    name: 'Alpha two', status: 'planning', starts_on: null, ends_on: null, description: 'Agreed brief',
  })
  expect(reload).toHaveBeenCalled()
})

it('refuses a nameless project', async () => {
  await show(makeState())
  await act(async () => button(host, 'Edit details')!.click())
  await type(host.querySelector<HTMLInputElement>('input')!, ' ')
  await act(async () => button(host, 'Save details')!.click())
  expect(host.textContent).toContain('A project needs a name.')
  expect(updateGeneralProject).not.toHaveBeenCalled()
})

it('archives from the bottom of General after a confirm', async () => {
  await show(makeState())
  expect(button(host, 'Restore project')).toBeUndefined()
  await act(async () => button(host, 'Archive project')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('Archive Alpha?')
  expect(dialog.textContent).toContain('Nothing in it can change until the project manager restores it, and its join code closes.')
  expect(archiveGeneralProject).not.toHaveBeenCalled()
  await act(async () => button(dialog, 'Archive project')!.click())
  expect(archiveGeneralProject).toHaveBeenCalledWith('p1', true)
  expect(reload).toHaveBeenCalled()
})

it('restores an archived project', async () => {
  await show(makeState({ archived: true, readOnly: true }, { archived_at: '2026-10-01' }))
  expect(button(host, 'Archive project')).toBeUndefined()
  await act(async () => button(host, 'Restore project')!.click())
  expect(archiveGeneralProject).toHaveBeenCalledWith('p1', false)
  expect(reload).toHaveBeenCalled()
})

it('shows the archive area to the project manager only', async () => {
  await show(makeState({ isOwner: false, myRole: 'coordinator' }))
  expect(button(host, 'Edit details')).toBeDefined()
  expect(button(host, 'Archive project')).toBeUndefined()
  expect(button(host, 'Restore project')).toBeUndefined()
})

const radio = (group: string, value: string) =>
  host.querySelector<HTMLInputElement>(`input[type="radio"][name$="${group}"][value="${value}"]`)!
const pick = (group: string, value: string) => act(async () => radio(group, value).click())
const defaultView = () => {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Default view')!
  return document.getElementById(label.htmlFor) as HTMLSelectElement
}
const choose = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

it('saves the look, the default view and who can see the project', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Look and access')
  expect(radio('color', '').checked).toBe(true)
  expect(radio('icon', '').checked).toBe(true)
  expect(radio('visibility', 'private').checked).toBe(true)
  await pick('color', 'teal')
  await pick('icon', 'monitor')
  await choose(defaultView(), 'plan')
  await pick('visibility', 'workspace')
  await act(async () => button(host, 'Save look and access')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    color: 'teal', icon: 'monitor', default_view: 'plan', visibility: 'workspace',
  })
  expect(reload).toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('Look and access saved')
  // Lists that are already showing this project (the rail) fetch its look again.
  expect(looksChanged).toHaveBeenCalled()
})

it('starts from what the project already has and can clear a color', async () => {
  await show(makeState({}, { color: 'rose', icon: 'bell', default_view: 'tasks', visibility: 'workspace' }))
  expect(radio('color', 'rose').checked).toBe(true)
  expect(radio('icon', 'bell').checked).toBe(true)
  expect(defaultView().value).toBe('tasks')
  expect(radio('visibility', 'workspace').checked).toBe(true)
  await pick('color', '')
  await act(async () => button(host, 'Save look and access')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    color: null, icon: 'bell', default_view: 'tasks', visibility: 'workspace',
  })
})

it('describes both visibility choices', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Only members and space owners can open it.')
  expect(host.textContent).toContain('Everyone in the space can view it and ask to join.')
})

it('names every control in the look panel', async () => {
  await show(makeState())
  const panel = [...host.querySelectorAll('section')].find((s) => s.textContent?.includes('Look and access'))!
  for (const control of panel.querySelectorAll('input, select')) {
    const labelled =
      control.getAttribute('aria-label') ||
      control.closest('label')?.textContent?.trim() ||
      host.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()
    expect(labelled, control.outerHTML).toBeTruthy()
  }
})

it('shows a member the look controls disabled, with nothing to save', async () => {
  await show(makeState({ can: () => false, isOwner: false, myRole: 'member' }, { color: 'navy', visibility: 'workspace' }))
  const panel = [...host.querySelectorAll('section')].find((s) => s.textContent?.includes('Look and access'))!
  const controls = [...panel.querySelectorAll('input, select')]
  expect(controls.length).toBeGreaterThan(0)
  expect(controls.every((c) => (c as HTMLInputElement).disabled)).toBe(true)
  expect(radio('color', 'navy').checked).toBe(true)
  expect(button(host, 'Save look and access')).toBeUndefined()
})

it('shows the look controls disabled while the project is read-only', async () => {
  await show(makeState({ readOnly: true, archived: true }))
  expect(radio('color', 'teal').disabled).toBe(true)
  expect(button(host, 'Save look and access')).toBeUndefined()
})

it('puts a failed save in the panel and keeps the picks', async () => {
  vi.mocked(updateGeneralProject).mockRejectedValueOnce(new Error('network down'))
  await show(makeState())
  await pick('color', 'orange')
  await act(async () => button(host, 'Save look and access')!.click())
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  expect(radio('color', 'orange').checked).toBe(true)
  expect(reload).not.toHaveBeenCalled()
})
