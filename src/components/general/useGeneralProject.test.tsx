// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { getGeneralProject, listGeneralMembers } from '../../lib/api/general'
import { useGeneralProject, type GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../lib/api/general', () => {
  const none = async () => []
  return {
    getGeneralProject: vi.fn(), listGeneralMembers: vi.fn(none), listJoinRequests: vi.fn(none),
    listGrants: none, listAccessRequests: none, listTeams: none, listTeamMembers: none, listPositions: none,
    listPositionHolders: none, listMemberSkills: none, listFields: none, listTasks: none, listFieldValues: none,
    getCommitRights: async () => ({ commit: false, grant: false, board: false, committers: [] }),
  }
})
vi.mock('../../lib/api/milestones', () => ({ listMilestones: async () => [] }))
vi.mock('../../lib/api/sprints', async importOriginal => ({ ...await importOriginal<object>(), listSprints: async () => [], getSprintSettings: async () => ({}) }))

it('keeps background reload errors in state and rejects an explicitly strict reload', async () => {
  vi.mocked(getGeneralProject).mockRejectedValue(new Error('Offline'))
  let state: GeneralProjectState
  function Harness() { state = useGeneralProject('project', 'viewer'); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness />))
    expect(state!.error).toBe('Offline')
    await act(async () => { await expect(state!.reload()).resolves.toBeUndefined() })
    await act(async () => { await expect(state!.reload({ throwOnError: true })).rejects.toThrow('Offline') })
  } finally { await act(async () => root.unmount()) }
})

it('is read-only for somebody with no role on a work project, but not on a class board Files project', async () => {
  const project = { id: 'project', archived_at: null, class_board_id: null as string | null }
  vi.mocked(getGeneralProject).mockResolvedValue(project as never)
  let state: GeneralProjectState
  function Harness() { state = useGeneralProject('project', 'viewer'); return null }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness />))
    expect(state!.myRole).toBeNull()
    expect(state!.readOnly).toBe(true)

    vi.mocked(listGeneralMembers).mockResolvedValueOnce([{ user_id: 'viewer', role: 'member', level: 'member' }] as never)
    await act(async () => { await state!.reload() })
    expect(state!.myRole).toBe('member')
    expect(state!.readOnly).toBe(false)

    vi.mocked(getGeneralProject).mockResolvedValue({ ...project, class_board_id: 'board' } as never)
    await act(async () => { await state!.reload() })
    expect(state!.myRole).toBeNull()
    expect(state!.readOnly).toBe(false)
  } finally { await act(async () => root.unmount()) }
})
