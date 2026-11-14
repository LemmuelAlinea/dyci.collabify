// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { WaitingHome } from './WaitingHome'
import { WorkOverview } from '../general/WorkOverview'
import { StakeholderHomeView } from '../../pages/app/StakeholderHome'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

vi.mock('./ProgramNotices', () => ({ ProgramNotices: () => <div data-testid="notices" /> }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'me', first_name: 'Rhea', role: 'member', status: 'active', can_manage_projects: true, can_teach: false },
  }),
}))
vi.mock('../../context/generalNavigation', () => ({
  useGeneralNavigation: () => ({ myProjects: [], spaces: [], error: null, reload: vi.fn() }),
}))
vi.mock('../../hooks/useGeneralDashboard', () => ({
  useGeneralDashboard: () => ({ data: null, error: null, reload: vi.fn() }),
}))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../lib/api/general', () => ({ listMyProjectVisits: vi.fn(async () => new Map()) }))
vi.mock('../../lib/api/qa', () => ({ listMyQaQueue: vi.fn(async () => []) }))

let root: ReturnType<typeof createRoot> | null = null
function mount(ui: React.ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<MemoryRouter>{ui}</MemoryRouter>))
  return host
}
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

it('WaitingHome shows ProgramNotices', () => {
  expect(mount(<WaitingHome />).querySelectorAll('[data-testid="notices"]')).toHaveLength(1)
})
it('standalone WorkOverview shows ProgramNotices', () => {
  expect(mount(<WorkOverview standalone />).querySelectorAll('[data-testid="notices"]')).toHaveLength(1)
})
it('stacked WorkOverview does not', () => {
  expect(mount(<WorkOverview />).querySelectorAll('[data-testid="notices"]')).toHaveLength(0)
})
it('StakeholderHome shows ProgramNotices', () => {
  expect(mount(<StakeholderHomeView projects={[]} />).querySelectorAll('[data-testid="notices"]')).toHaveLength(1)
})
