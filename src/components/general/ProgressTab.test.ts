// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProgressTab } from './ProgressTab'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const state = {
  milestones: [],
  teams: [{ id: 'X', name: 'Design' }, { id: 'Y', name: 'Build' }],
  teamMembers: [{ team_id: 'X', user_id: 'A' }, { team_id: 'Y', user_id: 'A' }],
  members: ['A', 'QA', 'Stakeholder'].map(user_id => ({ user_id, profile: { first_name: user_id, last_name: '' } })),
  tasks: [
    { id: 'inside', title: 'Inside task', team_id: 'X', status: 'todo', assignee_ids: ['A'], archived_at: null, due_at: null },
    { id: 'outside', title: 'Outside task', team_id: null, status: 'done', assignee_ids: ['A'], archived_at: null, due_at: '2026-10-25T00:00:00Z', completed_at: '2026-10-20T04:00:00Z' },
  ],
} as unknown as GeneralProjectState

async function render(data: GeneralProjectState, check: (container: HTMLDivElement) => Promise<void>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/?tab=project-progress&milestone=old'] }, createElement(ProgressTab, { state: data }))))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const section = (container: HTMLDivElement, title: string) => [...container.querySelectorAll('section')].find(node => node.querySelector('h2')?.textContent === title)!

describe('Progress team and member details', () => {
  it('switches team counts and member rows while all members keeps all assigned tasks', async () => {
    await render(state, async container => {
      const teams = section(container, 'Teams')
      expect(teams).toBeDefined()
      expect(teams.textContent).toContain('0 of 1')
      expect(teams.querySelectorAll('details')).toHaveLength(2)
      expect(teams.querySelector('details')?.textContent).not.toContain('Outside task')
      const all = section(container, 'All members')
      expect(all.querySelectorAll('details')).toHaveLength(3)
      expect(all.textContent).toContain('1 of 2')
      expect(all.textContent).toContain('To do')
      expect(all.textContent).toContain('Done')
      expect(all.textContent).toContain('Due Oct 25')
      expect(all.textContent).toContain('No due date')
      expect(all.textContent).toContain('Design, Build')
      expect(all.textContent).toContain('QA')
      expect(all.textContent).toContain('Stakeholder')
      expect(all.textContent).toContain('No assigned tasks')
      const before = all.textContent
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="Team task basis"]')!
      expect(select).not.toBeNull()
      await act(async () => { select.value = 'member_tasks'; select.dispatchEvent(new Event('change', { bubbles: true })) })
      expect(teams.textContent).toContain('1 of 2')
      expect(teams.querySelector('details')?.textContent).toContain('Outside task')
      expect(all.textContent).toBe(before)
      const link = all.querySelector<HTMLAnchorElement>('a')!
      const params = new URL(link.href).searchParams
      expect(params.get('tab')).toBe('work')
      expect(params.get('work')).toBe('tasks')
      expect(params.get('task')).toBe('inside')
      expect(params.has('milestone')).toBe(false)
    })
  })

  it('shows zero-task teams and omits archived tasks', async () => {
    await render({ ...state, tasks: state.tasks.map(task => ({ ...task, archived_at: '2026-10-25T00:00:00Z' })) }, async container => {
      expect(section(container, 'Teams').textContent).toContain('No matching tasks')
      expect(section(container, 'All members').textContent).toContain('0 of 0')
      expect(container.querySelectorAll('details a')).toHaveLength(0)
    })
  })

  it('shows empty teams and members without editing controls', async () => {
    await render({ ...state, teams: [], teamMembers: [], tasks: [], members: [] }, async container => {
      expect(section(container, 'Teams').textContent).toContain('No teams yet')
      expect(section(container, 'All members').textContent).toContain('No project members')
      expect(container.querySelectorAll('button')).toHaveLength(0)
    })
  })
})

