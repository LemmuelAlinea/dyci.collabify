import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { WorkSummary } from './WorkSummary'
import { TasksTab } from './TasksTab'
import { QaQueue } from '../work/QaQueue'
import { generalWorkItems } from './workSource'
import type { GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../hooks/useNow', () => ({ useNow: () => Date.parse('2026-10-28T00:00:00Z') }))
vi.mock('../ui/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../work/useTeamFilter', () => ({ useTeamFilter: () => ['', vi.fn()] }))
vi.mock('./TaskRoutingPanel', () => ({ TaskRoutingPanel: () => null }))
vi.mock('../work/TaskCalendar', () => ({ TaskCalendar: ({ events }: { events: { title: string; done: boolean }[] }) => <span>{events.map(e => `${e.title}: ${e.done}`).join(',')}</span> }))
vi.mock('./ForecastPanel', () => ({ ForecastPanel: ({ state }: { state: GeneralProjectState }) => <span>Forecast: {state.tasks.map(t => t.title).join(',')}</span> }))
vi.mock('./PressurePanel', () => ({ PressurePanel: ({ state }: { state: GeneralProjectState }) => <span>Pressure: {state.tasks.map(t => t.title).join(',')}</span> }))
vi.mock('./OverviewTab', () => ({ OverviewTab: () => null }))
vi.mock('./NoPmNotice', () => ({ NoPmNotice: () => null }))
vi.mock('../work/WorkGlance', () => ({ WorkGlance: () => null }))

const state = {
  project: { id: 'p', class_board_id: null, starts_on: null, ends_on: null },
  viewerId: 'pm', can: () => true, members: [], teams: [], teamMembers: [], sprints: [], milestones: [], nameOf: (id: string) => id,
  tasks: [
    { id: 'live', title: 'Released', routing_state: 'released', status: 'todo', assignee_ids: [], logged_minutes: 0 },
    { id: 'private', title: 'Private plan', routing_state: 'planning', status: 'done', assignee_ids: ['pm'], logged_minutes: 120 },
    { id: 'review', title: 'Private review', routing_state: 'coordinator_review', status: 'done', assignee_ids: [], logged_minutes: 0 },
  ],
} as unknown as GeneralProjectState

it('counts only released work in Summary, forecast and pressure', () => {
  const html = renderToStaticMarkup(<WorkSummary state={state} onOpenTask={() => {}} onSection={() => {}} />)
  expect(html).toContain('0 of 1 tasks done')
  expect(html).toContain('Forecast: Released')
  expect(html).toContain('Pressure: Released')
  expect(html).not.toContain('Private')
})

it('keeps unsent tasks out of sprint, milestone and glance progress', () => {
  expect(generalWorkItems(state).map(t => t.id)).toEqual(['live'])
  expect(generalWorkItems({ ...state, project: { ...state.project!, class_board_id: 'board' } }).map(t => t.id)).toEqual(['live', 'private', 'review'])
})

it('keeps private tasks out of the Tasks calendar and progress', () => {
  const html = renderToStaticMarkup(<TasksTab state={state} layout="calendar" scope="all" onLayout={() => {}} onScope={() => {}} onViewBoard={() => {}} onOpenTask={() => {}} />)
  expect(html).not.toContain('Private')
  expect(html).toContain('0 of 1')
})

it('keeps private planning work out of the QA queue even for planners', () => {
  const html = renderToStaticMarkup(<QaQueue state={{ ...state, readOnly: true, tasks: [{ ...state.tasks[1], status: 'in_progress', stage: 1 }] }} onOpenTask={() => {}} />)
  expect(html).toContain('Nothing is waiting for QA.')
  expect(html).not.toContain('Private plan')
})
