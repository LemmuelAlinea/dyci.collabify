// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GeneralSection } from './GeneralSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { ProjectDeletedError } from '../../../lib/general/projectDeleted'
import { archiveGeneralProject, deleteGeneralProject, updateGeneralProject } from '../../../lib/api/general'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const toast = vi.hoisted(() => vi.fn())
const looksChanged = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/useProjectLooks', () => ({ notifyLooksChanged: looksChanged }))
vi.mock('../../ui/Toast', () => ({ useToast: () => ({ show: toast }) }))
vi.mock('../../../lib/api/general', () => ({
  archiveGeneralProject: vi.fn(async () => {}),
  deleteGeneralProject: vi.fn(async () => {}),
  handOverProject: vi.fn(async () => {}),
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
  act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/p']}>
        <Routes>
          <Route path="/p" element={<GeneralSection state={state} />} />
          <Route path="/spaces/:id/projects" element={<p>Space projects list</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  )
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

it('saves a custom color picked or typed as a hex code', async () => {
  await show(makeState())
  expect(host.querySelector('input[aria-label="Hex code"]')).toBeNull()
  await pick('color', 'custom')
  const hex = host.querySelector<HTMLInputElement>('input[aria-label="Hex code"]')!
  await type(hex, '#1F9E89')
  await act(async () => hex.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  await act(async () => button(host, 'Save look and access')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    color: '#1f9e89', icon: null, default_view: 'overview', visibility: 'private',
  })
})

it('keeps the color in use when the hex box holds no color', async () => {
  await show(makeState({}, { color: '#1f9e89' }))
  expect(radio('color', 'custom').checked).toBe(true)
  const hex = host.querySelector<HTMLInputElement>('input[aria-label="Hex code"]')!
  await type(hex, 'not a color')
  await act(async () => hex.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(hex.value).toBe('#1f9e89')
  expect(button(host, 'Save look and access')!.disabled).toBe(true)
})

it('previews the picked color and icon before saving', async () => {
  await show(makeState())
  const preview = host.querySelector<HTMLElement>('section[aria-label="Preview"]')!
  expect(preview.textContent).toContain('Project card')
  expect(preview.textContent).toContain('Side menu')
  expect(preview.textContent).toContain('Project banner')
  await pick('color', 'custom')
  await pick('icon', 'bell')
  const tiles = [...preview.querySelectorAll<HTMLElement>('span[aria-hidden][style]')]
  expect(tiles.length).toBeGreaterThanOrEqual(3)
  expect(tiles.every((t) => t.style.background !== '')).toBe(true)
  expect(preview.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)
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

const archivedState = () =>
  makeState({ archived: true, readOnly: true }, { archived_at: '2026-10-01', space_id: 's1' })

it('titles the zone Danger zone and offers transfer ownership to the project manager only', async () => {
  await show(makeState())
  expect(host.textContent).toContain('Danger zone')
  expect(button(host, 'Transfer ownership')).toBeDefined()
  await act(async () => root.unmount())
  root = createRoot(host)
  await show(makeState({ isOwner: false, myRole: 'coordinator' }))
  expect(button(host, 'Transfer ownership')).toBeUndefined()
  expect(host.textContent).not.toContain('Danger zone')
})

it('opens the hand-over dialog from transfer ownership', async () => {
  await show(makeState())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => button(host, 'Transfer ownership')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain('Hand over project')
})

it('hides delete while the project is active', async () => {
  await show(makeState())
  expect(button(host, 'Delete project')).toBeUndefined()
})

it('keeps delete disabled until the exact project name is typed, then deletes and leaves', async () => {
  await show(archivedState())
  await act(async () => button(host, 'Delete project')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.textContent).toContain(
    'Delete Alpha? This removes its tasks, files, sprints and milestones for good. Type the project name to confirm.',
  )
  const confirm = button(dialog, 'Delete project') as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  const input = dialog.querySelector<HTMLInputElement>('input')!
  for (const wrong of ['alpha', 'Alpha ', 'Alph']) {
    await type(input, wrong)
    expect(confirm.disabled).toBe(true)
  }
  await act(async () => confirm.click())
  expect(deleteGeneralProject).not.toHaveBeenCalled()
  await type(input, 'Alpha')
  expect(confirm.disabled).toBe(false)
  await act(async () => confirm.click())
  expect(deleteGeneralProject).toHaveBeenCalledWith('p1')
  expect(toast).toHaveBeenCalledWith('Project deleted')
  expect(host.textContent).toContain('Space projects list')
})

it('keeps a failed delete inside the dialog', async () => {
  vi.mocked(deleteGeneralProject).mockRejectedValueOnce(new Error('network down'))
  await show(archivedState())
  await act(async () => button(host, 'Delete project')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await type(dialog.querySelector<HTMLInputElement>('input')!, 'Alpha')
  await act(async () => button(dialog, 'Delete project')!.click())
  expect(dialog.querySelector('[role="alert"]')).not.toBeNull()
  expect(host.textContent).not.toContain('Space projects list')
  expect(toast).not.toHaveBeenCalledWith('Project deleted')
})

it('leaves a deleted project even when its file cleanup fails', async () => {
  const message = 'The project is deleted. Some of its uploaded files could not be cleared from storage, but nobody can open them.'
  vi.mocked(deleteGeneralProject).mockRejectedValueOnce(new ProjectDeletedError(message))
  await show(archivedState())
  await act(async () => button(host, 'Delete project')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await type(dialog.querySelector<HTMLInputElement>('input')!, 'Alpha')
  await act(async () => button(dialog, 'Delete project')!.click())
  expect(toast).toHaveBeenCalledWith(message, 'error')
  expect(host.textContent).toContain('Space projects list')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('deletes on Enter in the name box only once the name matches', async () => {
  await show(archivedState())
  await act(async () => button(host, 'Delete project')!.click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  const input = dialog.querySelector<HTMLInputElement>('input')!
  const form = dialog.querySelector('form')!
  await type(input, 'Alph')
  await act(async () => form.requestSubmit())
  expect(deleteGeneralProject).not.toHaveBeenCalled()
  await type(input, 'Alpha')
  await act(async () => form.requestSubmit())
  expect(deleteGeneralProject).toHaveBeenCalledWith('p1')
})

it('reopens the delete dialog empty, with no earlier error', async () => {
  vi.mocked(deleteGeneralProject).mockRejectedValueOnce(new Error('network down'))
  await show(archivedState())
  await act(async () => button(host, 'Delete project')!.click())
  let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  await type(dialog.querySelector<HTMLInputElement>('input')!, 'Alpha')
  await act(async () => button(dialog, 'Delete project')!.click())
  expect(dialog.querySelector('[role="alert"]')).not.toBeNull()
  await act(async () => button(dialog, 'Cancel')!.click())
  await act(async () => button(host, 'Delete project')!.click())
  dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.querySelector<HTMLInputElement>('input')!.value).toBe('')
  expect(dialog.querySelector('[role="alert"]')).toBeNull()
  expect((button(dialog, 'Delete project') as HTMLButtonElement).disabled).toBe(true)
})
