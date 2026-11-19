import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mentionBlindSpots, resolveMentions, searchMentionables } from './mentions'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()
const rpcCalls: { name: string; args: unknown }[] = []
const reads: string[] = []

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(results.get(`rpc:${name}`) ?? { data: [], error: null })
    },
    from: (table: string) => ({
      select: () => ({
        in: (col: string) => {
          reads.push(`${table}.${col}`)
          return Promise.resolve(results.get(`${table}.${col}`) ?? { data: [], error: null })
        },
      }),
    }),
  },
}))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const P = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  results.clear()
  rpcCalls.length = 0
  reads.length = 0
})

describe('mention api', () => {
  it('searchMentionables calls the function with the query and chat', async () => {
    results.set('rpc:search_mentionables', { data: [{ kind: 't', id: A, title: 'Login', project_id: P, project_title: 'Web' }], error: null })
    expect(await searchMentionables('log', 'c1')).toHaveLength(1)
    expect(rpcCalls).toEqual([{ name: 'search_mentionables', args: { p_query: 'log', p_conversation: 'c1' } }])
  })

  it('mentionBlindSpots sends refs as json', async () => {
    await mentionBlindSpots('c1', [{ kind: 't', id: A }])
    expect(rpcCalls).toEqual([{ name: 'mention_blind_spots', args: { p_conversation: 'c1', p_refs: [{ kind: 't', id: A }] } }])
  })

  it("resolveMentions opens what comes back and locks what doesn't", async () => {
    results.set('general_tasks.id', { data: [{ id: A, title: 'Login page', project_id: P, archived_at: null }], error: null })
    const out = await resolveMentions([
      { kind: 't', id: A },
      { kind: 't', id: B },
    ])
    expect(out.get(`t:${A}`)).toEqual({ state: 'open', title: 'Login page', href: `/projects/${P}?task=${A}`, archived: false })
    expect(out.get(`t:${B}`)).toEqual({ state: 'locked' })
  })

  it("resolveMentions opens a teacher's set task on the Tasks tab", async () => {
    results.set('project_tasks.origin_id', {
      data: [
        { id: A, title: 'Essay', origin_id: B, archived_at: null, board: { project_id: P } },
        { id: P, title: 'Essay', origin_id: B, archived_at: null, board: { project_id: P } },
      ],
      error: null,
    })
    const out = await resolveMentions([{ kind: 'co', id: B }])
    expect(out.get(`co:${B}`)).toEqual({ state: 'open', title: 'Essay', href: `/class-projects/${P}?tab=tasks`, archived: false })
  })

  it("resolveMentions opens a student's own copy of a set task", async () => {
    results.set('project_tasks.origin_id', {
      data: [{ id: A, title: 'Essay', origin_id: B, archived_at: null, board: [{ project_id: P }] }],
      error: null,
    })
    const out = await resolveMentions([{ kind: 'co', id: B }])
    expect(out.get(`co:${B}`)).toEqual({ state: 'open', title: 'Essay', href: `/class-projects/${P}?task=${A}`, archived: false })
  })

  it('resolveMentions marks archived rows', async () => {
    results.set('general_projects.id', { data: [{ id: P, name: 'Web', archived_at: '2026-01-01' }], error: null })
    results.set('projects.id', { data: [{ id: B, title: 'Capstone', archived_at: null }], error: null })
    const out = await resolveMentions([
      { kind: 'p', id: P },
      { kind: 'cp', id: B },
    ])
    expect(out.get(`p:${P}`)).toEqual({ state: 'open', title: 'Web', href: `/projects/${P}`, archived: true })
    expect(out.get(`cp:${B}`)).toEqual({ state: 'open', title: 'Capstone', href: `/class-projects/${B}`, archived: false })
  })

  it('resolveMentions leaves a kind out when its read fails', async () => {
    results.set('general_tasks.id', { data: null, error: new Error('offline') })
    results.set('projects.id', { data: [{ id: B, title: 'Capstone', archived_at: null }], error: null })
    const out = await resolveMentions([
      { kind: 't', id: A },
      { kind: 'cp', id: B },
    ])
    expect(out.has(`t:${A}`)).toBe(false)
    expect(out.get(`cp:${B}`)?.state).toBe('open')
  })
})
