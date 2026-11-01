// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { FinishSprintDialog } from './FinishSprintDialog'
import { DEFAULT_SPRINT_SETTINGS } from '../../lib/work/sprintSettings'
import type { SprintSettings } from '../../lib/work/sprintSettings'
import type { Sprint, WorkItem, WorkSource } from '../../lib/work/types'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's1', name: 'Sprint 1', goal: '', starts_on: '2026-10-05', ends_on: '2026-10-18', state: 'active',
  archived: false, started_at: null, completed_at: null, created_at: '2026-10-01T00:00:00Z', milestone_id: null, ...over,
})
const item: WorkItem = {
  id: 't1', title: 'Open task', status: 'todo', due_at: null, done_at: null, sprint_id: 's1', milestone_id: null, rank: 1,
  holders: [], holderIds: [], teamId: null, kind: 'task', created_at: '2026-10-01T00:00:00Z',
}

function sourceOf(sprints: Sprint[], settings?: SprintSettings) {
  return { items: [item], sprints, sprintSettings: settings, createSprint: vi.fn(), finishSprint: vi.fn() } as unknown as WorkSource
}

async function checkedChoice(source: WorkSource) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<FinishSprintDialog open onClose={vi.fn()} sprint={sprint({})} source={source} />))
    const checked = document.querySelector<HTMLInputElement>('input[name="carry"]:checked')
    return checked?.closest('label')?.textContent ?? null
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const planned = sprint({ id: 's2', name: 'Sprint 2', state: 'planned', starts_on: '2026-10-19', ends_on: '2026-11-01' })

it('starts on the backlog when the project sends unfinished tasks there', async () => {
  const text = await checkedChoice(sourceOf([sprint({}), planned], { ...DEFAULT_SPRINT_SETTINGS, carry: 'backlog' }))
  expect(text).toContain('Back to the backlog')
})

it('starts on the planned sprint when the project carries tasks to the next one', async () => {
  const text = await checkedChoice(sourceOf([sprint({}), planned], { ...DEFAULT_SPRINT_SETTINGS, carry: 'next' }))
  expect(text).toContain('Into a planned sprint')
})

it('falls back to the backlog when carrying to the next sprint but none is planned', async () => {
  const text = await checkedChoice(sourceOf([sprint({})], { ...DEFAULT_SPRINT_SETTINGS, carry: 'next' }))
  expect(text).toContain('Back to the backlog')
})

it('keeps today\'s choice when the project asks each time', async () => {
  const text = await checkedChoice(sourceOf([sprint({}), planned], { ...DEFAULT_SPRINT_SETTINGS, carry: 'ask' }))
  expect(text).toContain('Into a planned sprint')
})
