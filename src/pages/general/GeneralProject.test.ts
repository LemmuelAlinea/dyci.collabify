// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import GeneralProject from './GeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../lib/focusMode', () => ({ useFocusMode: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'viewer' } }) }))
vi.mock('../../context/generalNavigation', () => ({ useGeneralNavigation: () => ({ currentSpace: null, reportProjectSpace: () => {} }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../../components/app/DirectoryHero', () => ({ DirectoryHero: () => 'Project heading' }))
vi.mock('../../components/general/SinceLastVisit', () => ({ SinceLastVisit: () => null }))
vi.mock('../../components/general/SaveTemplateButton', () => ({ SaveTemplateButton: () => null }))
vi.mock('../../components/general/OverviewTab', () => ({ OverviewTab: () => 'Project details' }))
vi.mock('../../components/general/ProgressTab', () => ({ ProgressTab: () => 'Progress charts' }))
vi.mock('../../components/general/WorkTab', () => ({ WorkTab: ({ area }: { area: string }) => `${area} work` }))
vi.mock('../../components/general/DiscussionTab', () => ({ DiscussionTab: () => 'Discussion content' }))
vi.mock('../../components/general/FeedbackTab', () => ({ FeedbackTab: () => 'Feedback content' }))
vi.mock('../../components/general/FilesTab', () => ({ FilesTab: () => 'Files content' }))
vi.mock('../../components/general/MembersTab', () => ({ MembersTab: () => 'People content' }))

const state = {
  loading: false,
  error: null,
  missing: false,
  project: {
    id: 'project', name: 'Project', status: 'planning', my_role: 'manager',
    starts_on: null, ends_on: null, member_count: 2, progress_pct: 0,
    space_id: 'space', archived_at: null, class_board_id: null,
  },
  myRole: 'manager', me: { user_id: 'viewer' }, canGrant: false,
  requests: [], members: [], tasks: [], isOwner: false, archived: false,
}
vi.mock('../../components/general/useGeneralProject', () => ({ useGeneralProject: () => state }))

async function renderAt(query: string, check: (container: HTMLDivElement) => Promise<void> | void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [`/projects/project?${query}`] },
      createElement(Routes, null, createElement(Route, { path: '/projects/:projectId', element: createElement(GeneralProject) })))))
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

function selected(container: HTMLDivElement) {
  return container.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')?.textContent
}

describe('project sections', () => {
  it('opens all six sections and their content', async () => {
    await renderAt('', async container => {
      const expected = [
        ['Overview', 'Project details'], ['Plan', 'plan work'], ['Tasks', 'tasks work'],
        ['Conversations', 'Discussion content'], ['Files', 'Files content'], ['People', 'People content'],
      ]
      expect(container.querySelectorAll('[role="tablist"]')[0].querySelectorAll('[role="tab"]')).toHaveLength(6)
      for (const [label, content] of expected) {
        const tab = [...container.querySelectorAll('[role="tablist"]')[0].querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          .find(node => node.textContent === label)!
        await act(async () => tab.click())
        expect(selected(container)).toBe(label)
        expect(container.textContent).toContain(content)
      }
    })
  })

  it('keeps old section links working', async () => {
    for (const [query, label, content] of [
      ['tab=project-progress', 'Overview', 'Project details'],
      ['tab=work&work=backlog', 'Plan', 'plan work'],
      ['tab=work&work=qa', 'Tasks', 'tasks work'],
      ['tab=feedback', 'Conversations', 'Feedback content'],
      ['tab=shared', 'Files', 'Files content'],
      ['tab=members', 'People', 'People content'],
    ]) {
      await renderAt(query, container => {
        expect(selected(container)).toBe(label)
        expect(container.textContent).toContain(content)
        if (query === 'tab=project-progress') expect(container.querySelector('details')?.open).toBe(true)
      })
    }
  })

  it('switches between discussion and feedback within Conversations', async () => {
    await renderAt('tab=conversations', async container => {
      expect(container.textContent).toContain('Discussion content')
      const feedback = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(node => node.textContent === 'Feedback')!
      await act(async () => feedback.click())
      expect(container.textContent).toContain('Feedback content')
      expect(container.textContent).not.toContain('Discussion content')
    })
  })
})
