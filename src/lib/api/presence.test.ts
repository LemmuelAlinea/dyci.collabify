import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getActiveStatus,
  listActiveContacts,
  setActiveStatus,
  startContactConversation,
  touchPresence,
} from './presence'

type Result = { data: unknown; error: unknown }
const results = new Map<string, Result>()
const rpcCalls: { name: string; args: unknown }[] = []

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(results.get(name) ?? { data: null, error: null })
    },
  },
}))

beforeEach(() => {
  results.clear()
  rpcCalls.length = 0
})

describe('presence api', () => {
  it('stamps the caller', async () => {
    await touchPresence()
    expect(rpcCalls).toEqual([{ name: 'touch_presence', args: undefined }])
  })

  it('sets the switch', async () => {
    await setActiveStatus(false)
    expect(rpcCalls).toEqual([{ name: 'set_active_status', args: { p_show: false } }])
  })

  it('reads the switch', async () => {
    results.set('my_active_status', { data: false, error: null })
    expect(await getActiveStatus()).toBe(false)
  })

  it('lists contacts, empty when nothing comes back', async () => {
    expect(await listActiveContacts()).toEqual([])
    const row = { id: 'a', first_name: 'Ana', last_name: 'Cruz', avatar_url: null, last_seen_at: 't' }
    results.set('my_active_contacts', { data: [row], error: null })
    expect(await listActiveContacts()).toEqual([row])
  })

  it('opens a chat with a person', async () => {
    results.set('start_contact_conversation', { data: { result: 'ok', conversation_id: 'c1' }, error: null })
    expect(await startContactConversation('p1')).toEqual({ result: 'ok', conversation_id: 'c1' })
    expect(rpcCalls).toEqual([{ name: 'start_contact_conversation', args: { p_person: 'p1' } }])
  })

  it('throws an rpc error', async () => {
    results.set('my_active_contacts', { data: null, error: new Error('boom') })
    await expect(listActiveContacts()).rejects.toThrow('boom')
  })
})
