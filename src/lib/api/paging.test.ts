import { describe, expect, it } from 'vitest'
import { pageAll, pageAllIn } from './paging'

/**
 * Supabase hands back at most a thousand rows per select. A term of daily
 * activity passes that in a few weeks, and a truncated read draws a chart that
 * simply stops — wrong, and nothing on screen says so.
 */
describe('pageAll', () => {
  const source = Array.from({ length: 2503 }, (_, i) => i)
  const fetchPage = async (from: number, to: number) => source.slice(from, to + 1)

  it('reads every row across pages', async () => {
    expect(await pageAll(fetchPage, 1000)).toEqual(source)
  })

  it('stops after a short page without asking again', async () => {
    let calls = 0
    await pageAll(async (from, to) => {
      calls++
      return source.slice(from, to + 1)
    }, 1000)
    expect(calls).toBe(3)
  })

  it('makes one extra call when the total is an exact multiple', async () => {
    let calls = 0
    const rows = await pageAll(async (from, to) => {
      calls++
      return source.slice(0, 2000).slice(from, to + 1)
    }, 1000)
    expect(rows).toHaveLength(2000)
    expect(calls).toBe(3)
  })

  it('returns an empty list for an empty source', async () => {
    expect(await pageAll(async () => [], 1000)).toEqual([])
  })
})

describe('pageAllIn', () => {
  // 250 boards with 9 rows each: 2250 rows, past one page, over three chunks.
  const ids = Array.from({ length: 250 }, (_, i) => `b${i}`)
  const rows = ids.flatMap((id) => Array.from({ length: 9 }, (_, n) => ({ id, n })))

  it('sends at most 100 ids a call and reads every row of each chunk', async () => {
    const sent: number[] = []
    const got = await pageAllIn(ids, async (chunk, from, to) => {
      sent.push(chunk.length)
      return rows.filter((r) => chunk.includes(r.id)).slice(from, to + 1)
    })
    expect(Math.max(...sent)).toBeLessThanOrEqual(100)
    expect(got).toHaveLength(rows.length)
    expect(new Set(got.map((r) => `${r.id}:${r.n}`)).size).toBe(rows.length)
  })

  it('drops repeated ids and asks nothing for none', async () => {
    let calls = 0
    expect(await pageAllIn([], async () => (calls++, []))).toEqual([])
    expect(calls).toBe(0)
    const seen: string[][] = []
    await pageAllIn(['a', 'a', 'b'], async (chunk) => (seen.push(chunk), []))
    expect(seen).toEqual([['a', 'b']])
  })
})
