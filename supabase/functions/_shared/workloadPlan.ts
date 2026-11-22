export type WorkloadCandidate = {
  id: string
  skills: string[]
  positions: string[]
  current: number
  capacity: number | null
}

export type WorkloadRow = {
  key: string
  minutes: number
  skills: string[]
  position?: string
  pinnedOwner?: string | null
}

type Pick = {
  key: string
  owner: string | null
  reason: 'skills' | 'unknown_capacity' | 'capacity' | 'pinned' | 'fit'
}

export function balanceWorkPlan(rows: WorkloadRow[], people: WorkloadCandidate[]): Pick[] {
  const loads = new Map(people.map(person => [person.id, person.current]))
  const picks = new Map<string, Pick>()
  const pending = rows.map(row => ({
    row,
    qualified: people.filter(person =>
      (row.position || row.skills.length > 0) &&
      (!row.position || person.positions.includes(row.position)) &&
      row.skills.every(skill => person.skills.includes(skill))),
  }))
  for (const row of rows) {
    if (row.pinnedOwner === undefined) continue
    const owner = row.pinnedOwner
    if (owner !== null && loads.has(owner)) loads.set(owner, loads.get(owner)! + row.minutes)
    picks.set(row.key, { key: row.key, owner, reason: 'pinned' })
  }
  pending.sort((a, b) => a.qualified.length - b.qualified.length ||
    b.row.minutes - a.row.minutes || a.row.key.localeCompare(b.row.key))
  for (const { row, qualified } of pending) {
    if (picks.has(row.key)) continue
    const ranked = qualified.flatMap(person => {
      const next = loads.get(person.id)! + row.minutes
      return person.capacity !== null && person.capacity > 0 && next <= person.capacity
        ? [{ id: person.id, next, ratio: next / person.capacity }]
        : []
    }).sort((a, b) => a.ratio - b.ratio || a.id.localeCompare(b.id))
    const best = ranked[0]
    if (best) loads.set(best.id, best.next)
    const reason = best ? 'fit' : qualified.length === 0 ? 'skills'
      : qualified.some(person => person.capacity === null) ? 'unknown_capacity' : 'capacity'
    picks.set(row.key, { key: row.key, owner: best?.id ?? null, reason })
  }
  return rows.map(row => picks.get(row.key)!)
}

export function dependencyGroups(rows: { key: string; dependsOn: string[] }[]): string[][] {
  const keys = new Set(rows.map(row => row.key))
  if (keys.size !== rows.length) throw new Error('Use a unique key for each subtask.')
  if (rows.some(row => row.dependsOn.some(key => !keys.has(key)))) {
    throw new Error('Choose a prerequisite that is part of this plan.')
  }
  const groups: string[][] = []
  const complete = new Set<string>()
  while (complete.size < rows.length) {
    const ready = rows.filter(row => !complete.has(row.key) &&
      row.dependsOn.every(key => complete.has(key))).map(row => row.key)
    if (!ready.length) throw new Error('Remove the circular subtask dependency.')
    groups.push(ready)
    for (const key of ready) complete.add(key)
  }
  return groups
}
