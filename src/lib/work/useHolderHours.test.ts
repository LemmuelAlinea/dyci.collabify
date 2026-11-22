// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { holderRoom, spacePeopleHours, spacePeopleLoad } from '../api/workload'
import { memberHolderLabels, plannerHolderLabels, useHolderHours, type HolderLabel } from './useHolderHours'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../api/workload', () => ({
  spacePeopleLoad: vi.fn(async () => []),
  spacePeopleHours: vi.fn(async () => []),
  holderRoom: vi.fn(async () => []),
}))

const hours = (user_id: string, available_minutes: number | null) =>
  ({ user_id, weekly_minutes: available_minutes, available_minutes, time_off_minutes: available_minutes == null ? null : 0 })

describe('plannerHolderLabels', () => {
  it('reads load against available hours this week', () => {
    const labels = plannerHolderLabels(
      [
        { user_id: 'ana', project_id: 'p', load_minutes: 600, unestimated: 0 },
        { user_id: 'ben', project_id: 'p', load_minutes: 600, unestimated: 0 },
        { user_id: 'ben', project_id: null, load_minutes: 240, unestimated: 0 },
        { user_id: 'cy', project_id: 'p', load_minutes: 1080, unestimated: 0 },
      ],
      [hours('ana', 960), hours('ben', 960), hours('cy', 960), hours('dee', 960)],
    )
    expect(labels.get('ana')).toEqual({ text: '10 / 16 h this week', tone: 'success', load: 600, available: 960 })
    expect(labels.get('ben')).toEqual({ text: '14 / 16 h this week', tone: 'warning', load: 840, available: 960 })
    expect(labels.get('cy')).toEqual({ text: '18 / 16 h this week', tone: 'danger', load: 1080, available: 960 })
    expect(labels.get('dee')).toEqual({ text: '0 / 16 h this week', tone: 'success', load: 0, available: 960 })
  })

  it('shows unknown hours label as Not set', () => {
    const labels = plannerHolderLabels([{ user_id: 'ana', project_id: 'p', load_minutes: 300, unestimated: 0 }], [hours('ana', null)])
    expect(labels.get('ana')).toEqual({ text: 'Not set', tone: 'pending' })
  })

  it('leaves out people the hours read did not return', () => {
    expect(plannerHolderLabels([], [hours('ana', 960)]).has('ben')).toBe(false)
  })
})

describe('memberHolderLabels', () => {
  it('names only a full person, never hours', () => {
    const labels = memberHolderLabels([
      { user_id: 'ana', room: 'ok' },
      { user_id: 'ben', room: 'full' },
      { user_id: 'cy', room: 'unknown' },
    ])
    expect(labels.get('ben')).toEqual({ text: 'No room this week', tone: 'danger' })
    expect(labels.has('ana')).toBe(false)
    expect(labels.has('cy')).toBe(false)
  })
})

describe('useHolderHours', () => {
  afterEach(() => { vi.mocked(spacePeopleLoad).mockClear(); vi.mocked(spacePeopleHours).mockClear(); vi.mocked(holderRoom).mockClear() })

  async function run(opts: Parameters<typeof useHolderHours>[0]) {
    let out = new Map<string, HolderLabel>()
    function Probe() { out = useHolderHours(opts); return null }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(React.createElement(Probe)))
    await act(async () => {})
    await act(async () => root.unmount())
    return out
  }

  it('reads load and hours once for a planner', async () => {
    vi.mocked(spacePeopleLoad).mockResolvedValueOnce([{ user_id: 'ben', project_id: 'p', load_minutes: 840, unestimated: 0 }])
    vi.mocked(spacePeopleHours).mockResolvedValueOnce([hours('ben', 960)])
    const labels = await run({ spaceId: 's', userIds: ['ben'], taskId: 't', viewer: 'planner' })
    expect(labels.get('ben')?.text).toBe('14 / 16 h this week')
    expect(spacePeopleLoad).toHaveBeenCalledTimes(1)
    expect(holderRoom).not.toHaveBeenCalled()
  })

  it('reads room status for a Member', async () => {
    vi.mocked(holderRoom).mockResolvedValueOnce([{ user_id: 'ben', room: 'full' }])
    const labels = await run({ spaceId: 's', userIds: ['ben'], taskId: 't', viewer: 'member' })
    expect(labels.get('ben')?.text).toBe('No room this week')
    expect(spacePeopleLoad).not.toHaveBeenCalled()
  })

  it('reads again when the holders change', async () => {
    vi.mocked(spacePeopleLoad).mockResolvedValue([])
    vi.mocked(spacePeopleHours).mockResolvedValue([hours('ben', 960)])
    let refresh = 'a'
    function Probe() { useHolderHours({ spaceId: 's', userIds: ['ben'], taskId: 't', viewer: 'planner', refresh }); return null }
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(React.createElement(Probe)))
    refresh = 'a,ben'
    await act(async () => root.render(React.createElement(Probe)))
    await act(async () => root.unmount())
    expect(spacePeopleLoad).toHaveBeenCalledTimes(2)
  })

  it('gives a Member nothing without a task', async () => {
    const labels = await run({ spaceId: 's', userIds: ['ben'], taskId: null, viewer: 'member' })
    expect(labels.size).toBe(0)
    expect(holderRoom).not.toHaveBeenCalled()
  })
})
