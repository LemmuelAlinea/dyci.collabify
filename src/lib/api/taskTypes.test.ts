import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcCalls: { name: string; args: unknown }[] = []
const updates: unknown[] = []
let result: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('../supabase', () => {
  const chain = () => {
    const q: Record<string, unknown> = {}
    q.update = (payload: unknown) => (updates.push(payload), q)
    q.select = () => q
    q.eq = () => q
    q.then = (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad)
    return q
  }
  return {
    supabase: {
      from: () => chain(),
      rpc: (name: string, args: unknown) => (rpcCalls.push({ name, args }), Promise.resolve(result)),
    },
  }
})

import { isStaleTypes, saveTaskTypes, taskTypeCounts } from './taskTypes'
import { updateClassTaskSettings } from './projects'
import type { ClassTaskSettings } from './projects'
import { defaultTypeSet } from '../taskTypes/typeSet'

beforeEach(() => {
  rpcCalls.length = 0
  updates.length = 0
  result = { data: null, error: null }
})

describe('saveTaskTypes', () => {
  it('saves a work project through save_general_task_types', async () => {
    const types = defaultTypeSet('work')
    await saveTaskTypes('work', 'p1', types, 'abc', 'software')
    expect(rpcCalls).toEqual([{ name: 'save_general_task_types', args: { p_project: 'p1', p_types: types, p_shown: 'abc', p_preset: 'software' } }])
  })

  it('saves a class project through save_class_task_types, keeping the preset when none is given', async () => {
    await saveTaskTypes('class', 'c1', defaultTypeSet('class'), 'abc')
    expect(rpcCalls[0]).toMatchObject({ name: 'save_class_task_types', args: { p_project: 'c1', p_preset: null } })
  })

  it('throws what the database said', async () => {
    result = { data: null, error: { message: 'Someone changed these task types. Reload to see them.' } }
    await expect(saveTaskTypes('work', 'p1', [], 'x')).rejects.toMatchObject({ message: expect.stringContaining('Someone changed') })
  })
})

describe('taskTypeCounts', () => {
  it('maps rows to a name → tasks map', async () => {
    result = { data: [{ name: 'Epic', tasks: 2 }, { name: 'Feature', tasks: 1 }], error: null }
    const counts = await taskTypeCounts('work', 'p1')
    expect(rpcCalls[0]).toEqual({ name: 'general_task_type_counts', args: { p_project: 'p1' } })
    expect([...counts]).toEqual([['Epic', 2], ['Feature', 1]])
  })

  it('reads class counts from class_task_type_counts', async () => {
    result = { data: [], error: null }
    await taskTypeCounts('class', 'c1')
    expect(rpcCalls[0].name).toBe('class_task_type_counts')
  })
})

describe('isStaleTypes', () => {
  it('knows the stale refusal only', () => {
    expect(isStaleTypes({ message: 'Someone changed these task types. Reload to see them.' })).toBe(true)
    expect(isStaleTypes(new Error('Keep one default type.'))).toBe(false)
    expect(isStaleTypes(null)).toBe(false)
  })
})

describe('updateClassTaskSettings', () => {
  it('sends only the editable settings, never the types', async () => {
    const settings = {
      stages: null, task_types: ['Review'], default_priority: 'normal', default_stage: 0, allow_subtasks: true,
      allow_dependencies: true, allow_multiple_assignees: true, require_assignee: false, require_subtasks_done: true,
      task_type_set: defaultTypeSet('class'), task_type_set_shown: 'abc', task_type_preset: null,
    } as unknown as ClassTaskSettings
    await updateClassTaskSettings('c1', settings)
    expect(Object.keys(updates[0] as object).sort()).toEqual([
      'allow_dependencies', 'allow_multiple_assignees', 'allow_subtasks', 'default_priority', 'default_stage',
      'require_assignee', 'require_subtasks_done', 'stages',
    ])
  })
})
