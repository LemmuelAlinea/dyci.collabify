// @vitest-environment happy-dom
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { QaQueue } from './QaQueue'
import type { GeneralProjectState } from '../general/useGeneralProject'

vi.stubGlobal('React', React)
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('../general/RoleBadge', () => ({ PersonBadge: () => null }))
vi.mock('./QaActions', () => ({ QaActions: () => null }))

it("shows each waiting task's type, the bug type by its project name", async () => {
  const task = (id: string, over: Record<string, unknown>) => ({
    id, title: id, status: 'in_progress', stage: 1, routing_state: 'released', assignee_ids: [], qa_entered_at: '2026-11-20T00:00:00Z', ...over,
  })
  const state = {
    project: {
      id: 'p', class_board_id: null, stages: ['Todo', 'Testing', 'Done'], qa_stage: 'Testing', has_qa: true,
      taskTypeSet: [
        { slot: 'default', name: 'Task', description: '', color: '#2563eb', icon: 'square-check' },
        { slot: 'bug', name: 'Defect', description: '', color: '#dc2626', icon: 'bug' },
      ],
    },
    tasks: [task('a', { kind: 'bug', task_type: null }), task('b', { kind: 'task', task_type: null })],
    readOnly: false, myRole: 'pm', nameOf: (id: string) => id,
  } as unknown as GeneralProjectState
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<QaQueue state={state} onOpenTask={() => {}} />))
  expect([...host.querySelectorAll('[data-type-chip]')].map((c) => c.textContent).sort()).toEqual(['Defect', 'Task'])
  await act(async () => root.unmount())
  host.remove()
})
