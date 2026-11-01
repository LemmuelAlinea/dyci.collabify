// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { ProjectSettings } from './ProjectSettings'
import type { GeneralProjectState } from '../useGeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('./MembersSection', () => ({ MembersSection: () => 'Members content' }))

function Where() {
  const location = useLocation()
  return createElement('output', null, location.search)
}

async function renderAt(query: string, check: (container: HTMLDivElement) => Promise<void>) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/projects/p?${query}`] },
          createElement(ProjectSettings, { state: {} as GeneralProjectState }),
          createElement(Where),
        ),
      ),
    )
    await check(container)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
}

const item = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent === label)!

it('lists the four sections and opens General by default', async () => {
  await renderAt('tab=settings', async (container) => {
    expect([...container.querySelectorAll('nav button')].map((b) => b.textContent)).toEqual([
      'General', 'Sprints', 'Tasks', 'Members & permissions',
    ])
    expect(item(container, 'General').getAttribute('aria-current')).toBe('page')
    expect(container.textContent).toContain('This section is being moved here.')
    expect(container.textContent).not.toContain('Members content')
  })
})

it('opens Members from an old People link', async () => {
  for (const query of ['tab=members', 'tab=people', 'tab=settings&section=members']) {
    await renderAt(query, async (container) => {
      expect(item(container, 'Members & permissions').getAttribute('aria-current')).toBe('page')
      expect(container.textContent).toContain('Members content')
    })
  }
})

it('puts the chosen section in the URL', async () => {
  await renderAt('tab=settings', async (container) => {
    await act(async () => item(container, 'Sprints').click())
    expect(container.querySelector('output')?.textContent).toBe('?tab=settings&section=sprints')
    expect(item(container, 'Sprints').getAttribute('aria-current')).toBe('page')
    await act(async () => item(container, 'Members & permissions').click())
    expect(container.textContent).toContain('Members content')
  })
})
