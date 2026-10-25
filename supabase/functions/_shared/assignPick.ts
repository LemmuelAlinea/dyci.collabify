// Pure and import-free so the Deno edge function and Vite (tests) both load it.

export type AssignCandidate = {
  userId: string
  name: string
  load: number
  teams: string[]
  positions: string[]
  tags: string[]
}
export type AssignPosition = { id: string; name: string }
export type AssignTaskIn = { key: string; title: string; description: string; teamId: string | null }
export type AssignMatch = { key: string; kind: 'position' | 'tag' | 'none'; match: string; reason: string }
export type AssignPick = {
  key: string
  userId: string | null
  kind: 'position' | 'tag' | 'none'
  label: string
  reason: string
}

/** Counts how many of a person's tags appear in the wording, ignoring case. */
function tagHits(tags: string[], wording: string): number {
  return tags.filter((t) => t.trim() !== '' && wording.includes(t.trim().toLowerCase())).length
}

/**
 * Turns the AI's position or tag per task into a person: the least loaded holder,
 * preferring the task's team, then tag hits in the wording, then name. Load grows as
 * tasks are given out, and a match that names nobody real becomes "none".
 */
export function pickAssignees(
  tasks: AssignTaskIn[],
  matches: AssignMatch[],
  candidates: AssignCandidate[],
  positions: AssignPosition[],
): AssignPick[] {
  const load = new Map<string, number>(candidates.map((c) => [c.userId, c.load]))
  const matchOf = new Map<string, AssignMatch>()
  for (const m of matches) if (!matchOf.has(m.key)) matchOf.set(m.key, m)

  return tasks.map((task): AssignPick => {
    const none: AssignPick = { key: task.key, userId: null, kind: 'none', label: '', reason: '' }
    const m = matchOf.get(task.key)
    if (!m || m.kind === 'none') return { ...none, reason: m?.reason ?? '' }

    const position = m.kind === 'position' ? positions.find((p) => p.id === m.match) : undefined
    if (m.kind === 'position' && !position) return none

    let pool: AssignCandidate[]
    if (m.kind === 'position') {
      pool = candidates.filter((c) => c.positions.includes(m.match))
    } else {
      const want = m.match.trim().toLowerCase()
      pool = candidates.filter((c) => c.tags.some((t) => t.trim().toLowerCase() === want))
    }
    if (pool.length === 0) return none

    if (task.teamId) {
      const inTeam = pool.filter((c) => c.teams.includes(task.teamId as string))
      if (inTeam.length > 0) pool = inTeam
    }

    const wording = `${task.title} ${task.description}`.toLowerCase()
    const ranked = pool
      .map((c) => ({ c, hits: tagHits(c.tags, wording), load: load.get(c.userId) ?? 0 }))
      .sort(
        (a, b) =>
          a.load - b.load ||
          b.hits - a.hits ||
          a.c.name.localeCompare(b.c.name) ||
          (a.c.userId < b.c.userId ? -1 : a.c.userId > b.c.userId ? 1 : 0),
      )
    const chosen = ranked[0].c
    load.set(chosen.userId, (load.get(chosen.userId) ?? 0) + 1)

    if (m.kind === 'position') {
      return { key: task.key, userId: chosen.userId, kind: 'position', label: position?.name ?? '', reason: m.reason }
    }
    const want = m.match.trim().toLowerCase()
    const label = chosen.tags.find((t) => t.trim().toLowerCase() === want) ?? m.match
    return { key: task.key, userId: chosen.userId, kind: 'tag', label, reason: m.reason }
  })
}
