// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { BacklogView } from './BacklogView'
import { useToast } from '../ui/Toast'
import type { WorkSource } from '../../lib/work/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => {
  const show = vi.fn()
  return { useToast: () => ({ show }) }
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

async function addTask(extra: Partial<WorkSource>) {
  const addToBacklog = vi.fn(async () => {})
  const source = {
    items: [],
    sprints: [],
    canPlan: false,
    canRunSprints: false,
    canAdd: true,
    readOnlyReason: '',
    openTask: vi.fn(),
    addToBacklog,
    ...extra,
  } as unknown as WorkSource
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<BacklogView source={source} />))
  const input = host.querySelector<HTMLInputElement>('input[aria-label="New backlog task"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Draft the survey')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')!.click())
  await act(async () => root.unmount())
  return addToBacklog
}

it('says where a task went when its source says so', async () => {
  const add = await addTask({ addedMessage: 'Sent to planners for review' })
  expect(add).toHaveBeenCalledWith('Draft the survey')
  expect(useToast().show).toHaveBeenCalledWith('Sent to planners for review')
})

it('stays quiet when the new task simply appears in the list', async () => {
  await addTask({})
  expect(useToast().show).not.toHaveBeenCalled()
})

it('uses the source placeholder when it has one', async () => {
  const render = async (extra: Partial<WorkSource>) => {
    const source = {
      items: [], sprints: [], canPlan: false, canRunSprints: false, canAdd: true,
      readOnlyReason: '', openTask: vi.fn(), addToBacklog: vi.fn(), ...extra,
    } as unknown as WorkSource
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<BacklogView source={source} />))
    const placeholder = host.querySelector<HTMLInputElement>('input[aria-label="New backlog task"]')!.placeholder
    await act(async () => root.unmount())
    return placeholder
  }
  expect(await render({ addPlaceholder: 'Suggest a task for the planners' })).toBe('Suggest a task for the planners')
  expect(await render({})).toBe('Add a task to the backlog')
})

it('puts the backlog before planned sprints', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const source = { items: [], sprints: [], canPlan: false, canAdd: false, readOnlyReason: '' } as unknown as WorkSource
  try {
    await act(async () => root.render(<BacklogView source={source} />))
    expect([...host.querySelectorAll('h3')].map((heading) => heading.textContent?.trim())).toEqual(['Backlog 0', 'Coming up'])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
