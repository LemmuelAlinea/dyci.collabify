// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { getGeneralProject } from '../../lib/api/general'
import { useGeneralProject, type GeneralProjectState } from './useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../hooks/useLive', () => ({ useLive: () => {} }))
vi.mock('../../lib/api/general', () => ({ getGeneralProject: vi.fn() }))

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
