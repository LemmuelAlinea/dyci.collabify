// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { WorkTab } from './WorkTab'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../work/MilestonesView', () => ({ MilestonesView: () => 'Milestone content' }))
vi.mock('../work/BacklogView', () => ({ BacklogView: () => 'Planned sprints and backlog' }))
vi.mock('../work/SprintsView', () => ({ SprintsView: () => 'Active and finished sprints' }))
vi.mock('../work/QaQueue', () => ({ QaQueue: () => 'QA content' }))
vi.mock('./TasksTab', () => ({ TasksTab: () => 'Task content' }))
vi.mock('./TaskDialog', () => ({ TaskDialog: () => null }))
vi.mock('./WorkSummary', () => ({ WorkSummary: () => 'Summary content' }))
vi.mock('./workSource', () => ({ generalWorkSource: () => ({}), generalMilestoneSource: () => ({}) }))

const state = { project: { has_qa: false }, sprints: [] } as unknown as GeneralProjectState

async function renderAt(query: string, check: (container: HTMLDivElement) => Promise<void> | void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [`/?${query}`] }, createElement(WorkTab, { state, area: 'plan' }))))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

describe('Plan tabs', () => {
  it('shows milestones and sprints separately', async () => {
    await renderAt('tab=plan', async container => {
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      expect(tabs.map(tab => tab.textContent)).toEqual(['Milestones', 'Sprints'])
      expect(container.textContent).toContain('Milestone content')
      expect(container.textContent).not.toContain('Planned sprints and backlog')
      await act(async () => tabs[1].click())
      expect(tabs[1].getAttribute('aria-selected')).toBe('true')
      expect(container.textContent).toContain('Planned sprints and backlog')
      expect(container.textContent).toContain('Active and finished sprints')
      expect(container.textContent).not.toContain('Milestone content')
      await act(async () => tabs[0].click())
      expect(tabs[0].getAttribute('aria-selected')).toBe('true')
      expect(container.textContent).toContain('Milestone content')
      expect(container.textContent).not.toContain('Planned sprints and backlog')
    })
  })

  it('opens legacy sprint and backlog links in the Sprint tab', async () => {
    for (const query of ['tab=work&work=sprints', 'tab=tasks&work=sprints', 'tab=work&work=backlog']) {
      await renderAt(query, container => {
        expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Sprints')
        expect(container.textContent).toContain('Planned sprints and backlog')
      })
    }
  })
})
