// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TasksSection } from './TasksSection'
import type { GeneralProjectState } from '../useGeneralProject'
import { updateGeneralProject } from '../../../lib/api/general'

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
    project: { id: 'p1', name: 'Alpha', stages: null, qa_stage: null, updated_at: 't1', ...project },
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
  act(async () => root.render(<MemoryRouter><TasksSection state={state} /></MemoryRouter>))
const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || b.getAttribute('aria-label') === text)

it('reads the stages and offers no editing to somebody who cannot edit', async () => {
  await show(makeState({ can: () => false, myRole: 'qa' }, { stages: ['Plan', 'Build', 'Ship'] }))
  expect(host.textContent).toContain('Plan → Build → Ship')
  expect(host.querySelector('input, select')).toBeNull()
  expect(button('Edit stages')).toBeUndefined()
})

it('reads only while the project is read-only', async () => {
  await show(makeState({ readOnly: true }))
  expect(button('Edit stages')).toBeUndefined()
})

it('saves stages and the QA stage together, and nothing else', async () => {
  await show(makeState())
  await act(async () => button('Edit stages')!.click())
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === 'System development')!.click())
  await act(async () => button('Save stages')!.click())
  expect(updateGeneralProject).toHaveBeenCalledWith('p1', {
    stages: ['Planning', 'Development', 'Testing', 'Revision', 'Completed'],
    qa_stage: null,
  })
  expect(reload).toHaveBeenCalled()
})

it('keeps the stage validation message', async () => {
  await show(makeState())
  await act(async () => button('Edit stages')!.click())
  await act(async () => button('Add a stage')!.click())
  await act(async () => button('Save stages')!.click())
  expect(host.textContent).toContain('Progress stages: Every stage needs a name.')
  expect(updateGeneralProject).not.toHaveBeenCalled()
})
