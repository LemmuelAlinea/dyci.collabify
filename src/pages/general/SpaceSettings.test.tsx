// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import SpaceLegacyRedirect from './SpaceLegacyRedirect'
import SpaceSettings from './SpaceSettings'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('./SpaceDetails', () => ({ default: () => 'Details content' }))
vi.mock('./GeneralTeams', () => ({ default: () => 'Teams content' }))
vi.mock('./SpaceMembers', () => ({ default: () => 'Members content' }))
vi.mock('./SpaceArchive', () => ({ default: () => 'Archive content' }))

let space: Record<string, unknown> = {}
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({ spaces: [space], currentSpace: space }),
}))

function Where() {
  const location = useLocation()
  return createElement('output', null, `${location.pathname}${location.search}`)
}

async function renderAt(
  url: string,
  mine: Record<string, unknown>,
  check: (container: HTMLDivElement) => Promise<void>,
) {
  space = { id: 's', name: 'Capstone', my_role: 'member', member_count: 4, archived_count: 0, ...mine }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [url] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/spaces/:spaceId/settings', element: createElement(SpaceSettings) }),
            createElement(Route, {
              path: '/spaces/:spaceId/members',
              element: createElement(SpaceLegacyRedirect, { section: 'members' }),
            }),
            createElement(Route, {
              path: '/spaces/:spaceId/teams/archive',
              element: createElement(SpaceLegacyRedirect, { section: 'teams', archived: true }),
            }),
          ),
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

const labels = (container: HTMLElement) => [...container.querySelectorAll('nav button')].map((b) => b.textContent)
const item = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.startsWith(label))!

it('shows every section to a coordinator', async () => {
  await renderAt('/spaces/s/settings', { my_role: 'coordinator', member_count: 0 }, async (container) => {
    expect(labels(container)).toEqual(['Details', 'Teams', 'Members', 'Archive'])
  })
})

it('hides Archive from a member', async () => {
  await renderAt('/spaces/s/settings', { member_count: 0 }, async (container) => {
    expect(labels(container)).toEqual(['Details', 'Teams', 'Members'])
  })
})

it('sends a member opening Archive to Details', async () => {
  await renderAt('/spaces/s/settings?section=archive', { member_count: 0 }, async (container) => {
    expect(container.textContent).toContain('Details content')
    expect(item(container, 'Details').getAttribute('aria-current')).toBe('page')
  })
})

it('opens a section and writes it to the URL', async () => {
  await renderAt('/spaces/s/settings', { my_role: 'pm' }, async (container) => {
    await act(async () => item(container, 'Teams').click())
    expect(container.querySelector('output')?.textContent).toBe('/spaces/s/settings?section=teams')
    expect(container.textContent).toContain('Teams content')
    expect(item(container, 'Teams').getAttribute('aria-current')).toBe('page')
  })
})

it('drops the archived flag when leaving Teams', async () => {
  await renderAt('/spaces/s/settings?section=teams&archived=1', { my_role: 'pm' }, async (container) => {
    await act(async () => item(container, 'Members').click())
    expect(container.querySelector('output')?.textContent).toBe('/spaces/s/settings?section=members')
  })
})

it('counts members and archived projects in the menu', async () => {
  await renderAt('/spaces/s/settings', { my_role: 'pm', member_count: 4, archived_count: 2 }, async (container) => {
    expect(item(container, 'Members').querySelector('span')?.textContent).toBe('4')
    expect(item(container, 'Archive').querySelector('span')?.textContent).toBe('2')
    expect(item(container, 'Teams').querySelector('span')).toBeNull()
  })
  await renderAt('/spaces/s/settings', { my_role: 'pm', member_count: 4, archived_count: 0 }, async (container) => {
    expect(item(container, 'Archive').querySelector('span')).toBeNull()
  })
})

it('redirects the old teams archive link', async () => {
  await renderAt('/spaces/s/teams/archive', {}, async (container) => {
    expect(container.querySelector('output')?.textContent).toBe('/spaces/s/settings?section=teams&archived=1')
    expect(container.textContent).toContain('Teams content')
  })
})

it('redirects the old members link', async () => {
  await renderAt('/spaces/s/members', {}, async (container) => {
    expect(container.querySelector('output')?.textContent).toBe('/spaces/s/settings?section=members')
    expect(container.textContent).toContain('Members content')
  })
})
