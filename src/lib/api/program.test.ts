import { expect, it, vi } from 'vitest'

const orders = vi.hoisted(() => [] as string[])
vi.mock('../supabase', () => {
  const q: Record<string, unknown> = {
    select: () => q,
    order: (col: string) => {
      orders.push(col)
      return q
    },
    then: (res: (v: unknown) => void) => res({ data: [], error: null }),
  }
  return { supabase: { from: () => q } }
})

import { listAllNotices } from './program'

it('lists notices without asking for an expired column', async () => {
  await listAllNotices()
  expect(orders).toEqual(['pinned', 'created_at'])
})
