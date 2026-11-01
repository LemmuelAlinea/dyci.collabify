// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RoleGuide } from './RoleGuide'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

async function open(props: React.ComponentProps<typeof RoleGuide>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<RoleGuide {...props} />))
  await act(async () => host.querySelector('button')!.click())
  const cell = (action: string, column: number) =>
    [...host.querySelectorAll('tbody tr')]
      .find((tr) => tr.querySelector('th')?.textContent?.startsWith(action))!
      .querySelectorAll('td')[column].textContent
  return {
    cell,
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

// Columns: 0 PM, 1 Coordinator, 2 Team lead, 3 Member, 4 QA, 5 Stakeholder.
const LEAD = 2
const MEMBER = 3

it('keeps working without a project in scope', async () => {
  const { cell, close } = await open({})
  expect(cell('Create tasks', MEMBER)).toBe('')
  expect(cell('Plan sprints and milestones', MEMBER)).toBe('If granted')
  await close()
})

it('shows the Member allowed to create tasks, set by the project manager, when the switch is on', async () => {
  const { cell, close } = await open({ memberRules: { manageMilestones: false, createTasks: true } })
  expect(cell('Create tasks', MEMBER)).toContain('Yes')
  expect(cell('Create tasks', MEMBER)).toContain('set by the project manager')
  expect(cell('Create tasks', LEAD)).toBe(cell('Create tasks', MEMBER))
  expect(cell('Plan sprints and milestones', MEMBER)).toBe('If granted')
  await close()
})

it('shows the Member allowed to manage milestones, set by the project manager, when that switch is on', async () => {
  const { cell, close } = await open({ memberRules: { manageMilestones: true, createTasks: false } })
  expect(cell('Plan sprints and milestones', MEMBER)).toBe('Milestones: yes; sprints: with a grantset by the project manager')
  expect(cell('Plan sprints and milestones', LEAD)).toBe(cell('Plan sprints and milestones', MEMBER))
  expect(cell('Create tasks', MEMBER)).toBe('')
  expect(cell('Create tasks', LEAD)).toBe('')
  await close()
})
