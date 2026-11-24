// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useClassSettings } from './useClassSettings'
import { getClassTaskSettings } from '../../lib/api/projects'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../../lib/api/projects', () => ({
  getClassTaskSettings: vi.fn(async () => ({ task_type_set: [{ slot: 'default', name: 'Task', description: '', color: '#2563eb', icon: 'square-check' }] })),
}))

it('loads the class project settings as soon as the board shows, so cards get their types', async () => {
  let seen: unknown = null
  function Probe() {
    seen = useClassSettings('p1')
    return null
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Probe />))
  expect(getClassTaskSettings).toHaveBeenCalledWith('p1')
  expect(seen).toMatchObject({ task_type_set: [{ name: 'Task' }] })
  await act(async () => root.unmount())
})
