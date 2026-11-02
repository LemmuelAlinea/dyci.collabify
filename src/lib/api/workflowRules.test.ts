import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addWorkflowRule,
  deleteWorkflowRule,
  listWorkflowRules,
  setWorkflowRuleEnabled,
  updateWorkflowRule,
} from './workflowRules'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()
const selects: string[] = []
const inserts: unknown[] = []
const updates: unknown[] = []
const orders: string[] = []

function chain(key: string) {
  const q: Record<string, unknown> = {}
  for (const m of ['eq', 'select']) q[m] = () => q
  q.order = (col: string) => {
    orders.push(col)
    return q
  }
  q.then = (ok: (r: Result | undefined) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(results.get(key)).then(ok, bad)
  return q
}

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => {
        selects.push(`${table}:${cols}`)
        return chain(`${table}:select`)
      },
      insert: (row: unknown) => {
        inserts.push(row)
        return chain(`${table}:insert`)
      },
      update: (patch: unknown) => {
        updates.push(patch)
        return chain(`${table}:update`)
      },
      delete: () => chain(`${table}:delete`),
    }),
  },
}))

const missingTable = { code: 'PGRST205', message: "Could not find the table 'public.general_workflow_rules' in the schema cache" }
const row = {
  id: 'r1', project_id: 'p1', name: 'N', enabled: true, position: 1, trigger_kind: 'task_released', trigger_stage: null,
  trigger_priority: null, action_kind: 'notify', notify_to: 'qa', person_id: null, action_priority: null, action_stage: null,
  created_by: null, created_at: 'c', updated_at: 'u', last_skipped_at: null, last_skip_reason: null,
}
const payload = {
  name: 'N', trigger_kind: 'task_released', trigger_stage: null, trigger_priority: null, action_kind: 'notify',
  notify_to: 'qa', person_id: null, action_priority: null, action_stage: null,
} as const

beforeEach(() => {
  results.clear()
  selects.length = 0
  inserts.length = 0
  updates.length = 0
  orders.length = 0
})

describe('listWorkflowRules', () => {
  it('returns the rules in running order, as camelCase', async () => {
    results.set('general_workflow_rules:select', { data: [row], error: null })
    const rules = await listWorkflowRules('p1')
    expect(orders).toEqual(['position'])
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ id: 'r1', projectId: 'p1', triggerKind: 'task_released', notifyTo: 'qa', lastSkipReason: null })
  })

  it('returns none while the table is missing, and rethrows any other error', async () => {
    results.set('general_workflow_rules:select', { data: null, error: missingTable })
    expect(await listWorkflowRules('p1')).toEqual([])
    const denied = { code: '42501', message: 'permission denied' }
    results.set('general_workflow_rules:select', { data: null, error: denied })
    await expect(listWorkflowRules('p1')).rejects.toBe(denied)
  })
})

describe('writing rules', () => {
  it('adds a rule to its project', async () => {
    results.set('general_workflow_rules:insert', { data: null, error: null })
    await addWorkflowRule('p1', payload)
    expect(inserts).toEqual([{ project_id: 'p1', ...payload }])
  })

  it('throws the database refusal as it is', async () => {
    const refusal = { code: '23514', message: 'A project can have up to 20 rules.' }
    results.set('general_workflow_rules:insert', { data: null, error: refusal })
    await expect(addWorkflowRule('p1', payload)).rejects.toBe(refusal)
  })

  it('updates, switches and deletes, and says so when nothing changed', async () => {
    results.set('general_workflow_rules:update', { data: [{ id: 'r1' }], error: null })
    results.set('general_workflow_rules:delete', { data: [{ id: 'r1' }], error: null })
    await updateWorkflowRule('r1', payload)
    await setWorkflowRuleEnabled('r1', false)
    await deleteWorkflowRule('r1')
    expect(updates).toEqual([payload, { enabled: false }])

    results.set('general_workflow_rules:update', { data: [], error: null })
    results.set('general_workflow_rules:delete', { data: [], error: null })
    await expect(updateWorkflowRule('r1', payload)).rejects.toThrow('could not change')
    await expect(setWorkflowRuleEnabled('r1', true)).rejects.toThrow('could not change')
    await expect(deleteWorkflowRule('r1')).rejects.toThrow('could not be deleted')
  })
})
