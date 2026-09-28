/**
 * The arithmetic behind grouping helpers. Pure, so the previews can run it as
 * often as they like and the tests can pin it down.
 */

export type OpenGroup = { id: string; name: string; count: number; limit: number }
export type Placement<S> = { student: S; group: OpenGroup }

/**
 * Put students with no group into the groups that have room, emptiest first, so
 * sizes even out rather than the first group filling up. Whoever does not fit
 * anywhere comes back in `left`, to be said out loud rather than dropped.
 */
export function placeLeftovers<S>(groups: OpenGroup[], students: S[]) {
  const sizes = new Map(groups.map((g) => [g.id, g.count]))
  const placed: Placement<S>[] = []
  const left: S[] = []
  for (const student of students) {
    let best: OpenGroup | null = null
    for (const g of groups) {
      const n = sizes.get(g.id) ?? 0
      if (n >= g.limit) continue
      if (!best || n < (sizes.get(best.id) ?? 0)) best = g
    }
    if (!best) {
      left.push(student)
      continue
    }
    sizes.set(best.id, (sizes.get(best.id) ?? 0) + 1)
    placed.push({ student, group: best })
  }
  return { placed, left }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Every pair of students who have shared a group, from membership rows. */
export function pastPairs(rows: { group_id: string; student_id: string }[]) {
  const byGroup = new Map<string, string[]>()
  for (const r of rows) byGroup.set(r.group_id, [...(byGroup.get(r.group_id) ?? []), r.student_id])
  const pairs = new Set<string>()
  for (const members of byGroup.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) pairs.add(pairKey(members[i], members[j]))
    }
  }
  return pairs
}

/**
 * Random groups that keep apart people who were grouped together before.
 *
 * Shuffled first, then dealt one at a time: each student goes to whichever of
 * the currently smallest groups holds the fewest of their past groupmates.
 * Choosing only among the smallest keeps sizes within one of each other, same
 * as a plain deal; with no history it is a plain deal. Swaps then undo what
 * the greedy deal could not avoid.
 */
export function spreadIntoGroups<T>(
  students: T[],
  groupCount: number,
  idOf: (s: T) => string,
  pairs: Set<string>,
  random: () => number = Math.random,
): T[][] {
  const pool = [...students]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const buckets: T[][] = Array.from({ length: Math.max(1, groupCount) }, () => [])
  for (const s of pool) {
    const smallest = Math.min(...buckets.map((b) => b.length))
    let best = -1
    let bestClash = Infinity
    buckets.forEach((b, i) => {
      if (b.length !== smallest) return
      const clash = b.filter((o) => pairs.has(pairKey(idOf(s), idOf(o)))).length
      if (clash < bestClash) {
        best = i
        bestClash = clash
      }
    })
    buckets[best].push(s)
  }

  // The deal is greedy, so an early choice can force a later clash. Swapping
  // two students between groups keeps every size, so try each swap and keep
  // the ones that lower the count until none does.
  const clashIn = (b: T[], s: T, skip: T) =>
    b.filter((o) => o !== skip && pairs.has(pairKey(idOf(s), idOf(o)))).length
  if (pairs.size > 0) {
    for (let improved = true, rounds = 0; improved && rounds < 50; rounds++) {
      improved = false
      for (let x = 0; x < buckets.length; x++) {
        for (let y = x + 1; y < buckets.length; y++) {
          for (let i = 0; i < buckets[x].length; i++) {
            for (let j = 0; j < buckets[y].length; j++) {
              const a = buckets[x][i]
              const b = buckets[y][j]
              const now = clashIn(buckets[x], a, a) + clashIn(buckets[y], b, b)
              const swapped = clashIn(buckets[x], b, a) + clashIn(buckets[y], a, b)
              if (swapped < now) {
                buckets[x][i] = b
                buckets[y][j] = a
                improved = true
              }
            }
          }
        }
      }
    }
  }
  return buckets
}

/** How many pairs in an arrangement have been grouped together before. */
export function repeatedPairs<T>(buckets: T[][], idOf: (s: T) => string, pairs: Set<string>) {
  let n = 0
  for (const b of buckets) {
    for (let i = 0; i < b.length; i++) {
      for (let j = i + 1; j < b.length; j++) if (pairs.has(pairKey(idOf(b[i]), idOf(b[j])))) n++
    }
  }
  return n
}
