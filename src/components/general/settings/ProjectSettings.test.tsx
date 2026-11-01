// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { ProjectSettings } from './ProjectSettings'
import type { GeneralProjectState } from '../useGeneralProject'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('./MembersSection', () => ({ MembersSection: () => 'Members content' }))
vi.mock('./GeneralSection', () => ({ GeneralSection: () => 'General content' }))
vi.mock('./TasksSection', () => ({ TasksSection: () => 'Tasks content' }))
vi.mock('./SprintsSection', () => ({ SprintsSection: () => 'Sprints content' }))

function Where() {
  const location = useLocation()
  return createElement('output', null, location.search)
}

async function renderAt(
  query: string,
  check: (container: HTMLDivElement) => Promise<void>,
  state: Partial<GeneralProjectState> = {},
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/projects/p?${query}`] },
          createElement(ProjectSettings, { state: state as GeneralProjectState }),
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
    expect(container.textContent).toContain('General content')
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

it('opens Tasks from its link', async () => {
  await renderAt('tab=settings&section=tasks', async (container) => {
    expect(item(container, 'Tasks').getAttribute('aria-current')).toBe('page')
    expect(container.textContent).toContain('Tasks content')
  })
})

it('puts the chosen section in the URL', async () => {
  await renderAt('tab=settings', async (container) => {
    await act(async () => item(container, 'Sprints').click())
    expect(container.querySelector('output')?.textContent).toBe('?tab=settings&section=sprints')
    expect(container.textContent).toContain('Sprints content')
    expect(item(container, 'Sprints').getAttribute('aria-current')).toBe('page')
    await act(async () => item(container, 'Members & permissions').click())
    expect(container.textContent).toContain('Members content')
  })
})

const requests = [{ status: 'open' }, { status: 'open' }, { status: 'approved' }] as GeneralProjectState['requests']

it('counts the open access requests on Members & permissions for someone who can grant', async () => {
  await renderAt('tab=settings', async (container) => {
    expect(item(container, 'Members & permissions2').querySelector('span')?.textContent).toBe('2')
  }, { canGrant: true, requests, joinRequests: [] })
})

it('adds the open join requests to that count', async () => {
  await renderAt('tab=settings', async (container) => {
    expect(item(container, 'Members & permissions3').querySelector('span')?.textContent).toBe('3')
  }, { canGrant: true, requests, joinRequests: [{ status: 'open' }, { status: 'declined' }] as GeneralProjectState['joinRequests'] })
})

it('shows no count when nobody can grant or none are open', async () => {
  await renderAt('tab=settings', async (container) => {
    expect(item(container, 'Members & permissions')).toBeTruthy()
  }, { canGrant: false, requests, joinRequests: [] })
  await renderAt('tab=settings', async (container) => {
    expect(item(container, 'Members & permissions')).toBeTruthy()
  }, { canGrant: true, requests: [{ status: 'approved' }] as GeneralProjectState['requests'], joinRequests: [] })
})
