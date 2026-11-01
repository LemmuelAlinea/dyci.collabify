// @vitest-environment happy-dom
import { Fragment, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GeneralProject from './GeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('../../lib/focusMode', () => ({ useFocusMode: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'viewer' } }) }))
vi.mock('../../context/generalNavigation', () => ({ useGeneralNavigation: () => ({ currentSpace: null, reportProjectSpace: () => {} }) }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ show: () => {} }) }))
vi.mock('../../components/app/DirectoryHero', () => ({ DirectoryHero: () => 'Project heading' }))
vi.mock('../../components/general/SinceLastVisit', () => ({ SinceLastVisit: () => null }))
vi.mock('../../components/general/SaveTemplateButton', () => ({ SaveTemplateButton: () => null }))
vi.mock('../../components/general/WorkTab', () => ({ WorkTab: ({ area }: { area: string }) => `${area} work` }))
vi.mock('../../components/general/DiscussionTab', () => ({ DiscussionTab: () => 'Discussion content' }))
vi.mock('../../components/general/FeedbackTab', () => ({ FeedbackTab: () => 'Feedback content' }))
vi.mock('../../components/general/FilesTab', () => ({ FilesTab: () => 'Files content' }))
vi.mock('../../components/general/settings/ProjectSettings', () => ({ ProjectSettings: () => 'Settings content' }))

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
  requests: [], joinRequests: [] as unknown[], members: [], tasks: [], isOwner: false, archived: false,
  viewerId: 'viewer', readOnly: false,
}
vi.mock('../../components/general/useGeneralProject', () => ({ useGeneralProject: () => state }))

/** Shows the address's query, so a test can read what a click wrote to it. */
function SearchProbe() {
  return createElement('output', { 'data-search': useLocation().search })
}
const search = (container: HTMLDivElement) => container.querySelector('output')!.getAttribute('data-search')
const tabButton = (container: HTMLDivElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')].find(node => node.textContent === label)!

async function renderAt(query: string, check: (container: HTMLDivElement) => Promise<void> | void) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [`/projects/project?${query}`] },
      createElement(Routes, null, createElement(Route, {
        path: '/projects/:projectId',
        element: createElement(Fragment, null, createElement(GeneralProject), createElement(SearchProbe)),
      })))))
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
        ['Overview', 'overview work'], ['Plan', 'plan work'], ['Tasks', 'tasks work'],
        ['Conversations', 'Discussion content'], ['Files', 'Files content'], ['Settings', 'Settings content'],
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
      ['tab=project-progress', 'Overview', 'overview work'],
      ['tab=work&work=backlog', 'Plan', 'plan work'],
      ['tab=work&work=sprints', 'Plan', 'plan work'],
      ['tab=tasks&work=sprints', 'Plan', 'plan work'],
      ['tab=work&work=qa', 'Tasks', 'tasks work'],
      ['tab=feedback', 'Conversations', 'Feedback content'],
      ['tab=shared', 'Files', 'Files content'],
      ['tab=members', 'Settings', 'Settings content'],
      ['tab=people', 'Settings', 'Settings content'],
    ]) {
      await renderAt(query, container => {
        expect(selected(container)).toBe(label)
        expect(container.textContent).toContain(content)
        if (query === 'tab=project-progress') expect(container.textContent).not.toContain('Detailed progress')
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

  describe('a Workspace viewer with no role', () => {
    const shape = state as unknown as Record<string, unknown> & { project: Record<string, unknown> }
    beforeEach(() => {
      Object.assign(shape, { myRole: null, me: null, readOnly: true })
      shape.project.visibility = 'workspace'
      shape.project.my_role = null
    })
    afterEach(() => {
      Object.assign(shape, { myRole: 'manager', me: { user_id: 'viewer' }, readOnly: false })
      delete shape.project.visibility
      shape.project.my_role = 'manager'
    })

    it('hides Conversations and keeps the Ask to join banner', async () => {
      await renderAt('', container => {
        const labels = [...container.querySelectorAll('[role="tablist"]')[0].querySelectorAll('[role="tab"]')].map(node => node.textContent)
        expect(labels).toEqual(['Overview', 'Plan', 'Tasks', 'Files', 'Settings'])
        expect(container.textContent).toContain("You're viewing this project as a member of its space.")
        expect([...container.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Ask to join')).toBe(true)
        expect(container.textContent).toContain('overview work')
      })
    })

    it('sends a Conversations or Discussion link back to the project', async () => {
      for (const query of ['tab=conversations', 'tab=discussion']) {
        await renderAt(query, container => {
          expect(search(container)).toBe('')
          expect(container.textContent).not.toContain('Discussion content')
        })
      }
    })
  })

  describe('default view', () => {
    const project = state.project as { default_view?: string }
    afterEach(() => {
      delete project.default_view
    })

    it('opens the default view when the address names no tab', async () => {
      project.default_view = 'plan'
      await renderAt('', container => {
        expect(selected(container)).toBe('Plan')
        expect(container.textContent).toContain('plan work')
      })
      project.default_view = 'tasks'
      await renderAt('', container => {
        expect(selected(container)).toBe('Tasks')
      })
    })

    it('lets a named tab, a task link or a Work link win over it', async () => {
      project.default_view = 'plan'
      await renderAt('tab=files', container => expect(selected(container)).toBe('Files'))
      await renderAt('task=t1', container => expect(selected(container)).toBe('Tasks'))
      await renderAt('work=summary', container => expect(selected(container)).toBe('Overview'))
    })

    it('names Overview in the address when the default view is not Overview', async () => {
      project.default_view = 'plan'
      await renderAt('', async container => {
        await act(async () => tabButton(container, 'Overview').click())
        expect(search(container)).toBe('?tab=overview')
        expect(selected(container)).toBe('Overview')
      })
    })

    it('leaves the address bare for Overview when that is the default view', async () => {
      await renderAt('tab=plan', async container => {
        await act(async () => tabButton(container, 'Overview').click())
        expect(search(container)).toBe('')
        expect(selected(container)).toBe('Overview')
      })
    })
  })
})
