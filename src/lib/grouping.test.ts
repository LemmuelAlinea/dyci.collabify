import { describe, expect, it } from 'vitest'
import { pastPairs, placeLeftovers, repeatedPairs, spreadIntoGroups } from './grouping'

const g = (id: string, count: number, limit: number) => ({ id, name: id, count, limit })

describe('placeLeftovers', () => {
  it('fills the emptiest group first', () => {
    const { placed, left } = placeLeftovers([g('a', 3, 4), g('b', 1, 4)], ['x', 'y', 'z'])
    expect(placed.map((p) => p.group.id)).toEqual(['b', 'b', 'a'])
    expect(left).toEqual([])
  })

  it('never goes past a limit, and hands back who did not fit', () => {
    const { placed, left } = placeLeftovers([g('a', 2, 3), g('b', 3, 3)], ['x', 'y'])
    expect(placed.map((p) => p.group.id)).toEqual(['a'])
    expect(left).toEqual(['y'])
  })

  it('with no groups, everyone is left', () => {
    expect(placeLeftovers([], ['x']).left).toEqual(['x'])
  })
})

describe('spreadIntoGroups', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `s${i}`)
  const id = (s: string) => s

  it('keeps sizes within one', () => {
    const buckets = spreadIntoGroups(ids.slice(0, 11), 3, id, new Set())
    const sizes = buckets.map((b) => b.length).sort()
    expect(sizes).toEqual([3, 4, 4])
    expect(buckets.flat().sort()).toEqual(ids.slice(0, 11).sort())
  })

  it('separates last time’s groups when it can', () => {
    // Last time: four groups of three.
    const before = [0, 1, 2, 3].flatMap((gi) =>
      [0, 1, 2].map((k) => ({ group_id: `g${gi}`, student_id: `s${gi * 3 + k}` })),
    )
    const pairs = pastPairs(before)
    expect(pairs.size).toBe(12)
    // Three groups of four from four old groups of three: a repeat is avoidable.
    for (let seed = 0; seed < 20; seed++) {
      let x = seed + 1
      const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647)
      const buckets = spreadIntoGroups(ids, 3, id, pairs, rnd)
      expect(repeatedPairs(buckets, id, pairs)).toBe(0)
    }
  })
})
