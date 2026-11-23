// Break down and balance: the deterministic half. Shared by the browser
// (review, Rebalance) and the work-ai function (checking the model's rows), so
// it imports nothing from Node, Deno or the DOM.
//
// Minutes everywhere. A position or tag is a label: the name the project uses,
// matched without regard to case.

export type Candidate = {
  id: string
  name: string
  tags: string[]
  /** Position names the person holds in the project. */
  positions: string[]
  /** Existing load in the window, in minutes. */
  loadMinutes: number
  /** Available minutes in the window; null when weekly hours are not set. */
  availableMinutes: number | null
}

export type PlanRow = {
  key: string
  title: string
  description: string
  minutes: number
  tags: string[]
  /** A position name, or null. */
  position: string | null
  dependsOn: string[]
  owner: string | null
  /** The planner chose the owner (null included); Rebalance keeps it. */
  pinned: boolean
}

export type Pick = {
  key: string
  owner: string | null
  reason: 'pinned' | 'fit' | 'fit_partial' | 'fit_untagged' | 'no_skill' | 'unknown_hours' | 'no_room'
  note: string
}

const norm = (s: string) => s.trim().toLowerCase()

/** Minutes as hours with at most one decimal: 120 -> "2 h", 90 -> "1.5 h". */
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} h`

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** "holds Developer and is tagged Auth" */
function hasLabel(row: PlanRow) {
  const parts: string[] = []
  if (row.position) parts.push(`holds ${row.position}`)
  if (row.tags.length) parts.push(`is tagged ${row.tags.join(' and ')}`)
  return parts.join(' and ')
}

/** "No one here is tagged with Auth" */
function nobodyHas(row: PlanRow) {
  const parts: string[] = []
  if (row.position) parts.push(`holds ${row.position}`)
  if (row.tags.length) parts.push(`is tagged with ${row.tags.join(' and ')}`)
  return `No one here ${parts.join(' and ')}`
}

/**
 * How much a full match is preferred: a person who has every label keeps
 * winning a row until their load share (projected ÷ available) is this much
 * times (1 - the other's fit) above a partial match's.
 */
const SKILL_WEIGHT = 0.25

/**
 * A position counts for less than a skill tag: it says what someone is (Junior
 * dev), a tag what they can do (UI).
 */
const POSITION_WEIGHT = 0.5

type Fit = { p: Candidate; fit: number; position: string | null; tags: string[] }
type Group = { qualified: Fit[]; full: Fit[]; kind: 'open' | 'tagged' | 'untagged' }

/** The row's labels a person has: the position (if any) and tags, as the row names them. */
function fitFor(row: PlanRow, p: Candidate): Fit {
  const position = row.position && p.positions.some(x => norm(x) === norm(row.position!)) ? row.position : null
  const tags = row.tags.filter(t => p.tags.some(x => norm(x) === norm(t)))
  const labels = (row.position ? POSITION_WEIGHT : 0) + row.tags.length
  return { p, fit: labels ? ((position ? POSITION_WEIGHT : 0) + tags.length) / labels : 1, position, tags }
}

/**
 * Who may take a row. With no label, everyone. Otherwise anyone with some of
 * its labels (a full match preferred, see SKILL_WEIGHT); when nobody has any,
 * everyone again.
 */
function groupFor(row: PlanRow, people: Candidate[]): Group {
  const everyone = people.map(p => ({ p, fit: 1, position: null, tags: [] }))
  if (!row.position && row.tags.length === 0) return { qualified: everyone, full: everyone, kind: 'open' }
  const fits = people.map(p => fitFor(row, p)).filter(f => f.fit > 0)
  return fits.length
    ? { qualified: fits, full: fits.filter(f => f.fit === 1), kind: 'tagged' }
    : { qualified: everyone, full: everyone, kind: 'untagged' }
}

/** "holds Junior dev and is tagged React": the labels of the row this person has. */
function hasOwn(f: Fit) {
  const parts: string[] = []
  if (f.position) parts.push(`holds ${f.position}`)
  if (f.tags.length) parts.push(`is tagged ${f.tags.join(' and ')}`)
  return parts.join(' and ')
}

/**
 * Recommends an owner for each row. Pinned rows keep their owner and count
 * first. The rest go in order of fewest full matches, then largest estimate,
 * then key. Each goes to whoever has some of its labels and room for it (never
 * past their free minutes), with the lowest projected load ÷ available minutes
 * after taking it plus SKILL_WEIGHT × (1 - fit): the best match first, then,
 * as they fill up, a partial match with more room. Ties go to the better fit,
 * then the lower id. Returns one pick per row, in row order.
 */
export function balanceWorkPlan(rows: PlanRow[], people: Candidate[]): Pick[] {
  const loads = new Map(people.map(p => [p.id, p.loadMinutes]))
  const nameOf = new Map(people.map(p => [p.id, p.name]))
  const picks = new Map<string, Pick>()

  for (const row of rows) {
    if (!row.pinned) continue
    const owner = row.owner
    if (owner !== null && loads.has(owner)) loads.set(owner, loads.get(owner)! + row.minutes)
    const note = owner === null ? 'You left this unassigned.'
      : nameOf.has(owner) ? `You chose ${nameOf.get(owner)}.` : 'You chose this person.'
    picks.set(row.key, { key: row.key, owner, reason: 'pinned', note })
  }

  const pending = rows
    .filter(row => !row.pinned)
    .map(row => ({ row, group: groupFor(row, people) }))
    .sort((a, b) => (a.group.full.length || a.group.qualified.length) - (b.group.full.length || b.group.qualified.length) ||
      b.row.minutes - a.row.minutes || byId(a.row.key, b.row.key))

  for (const { row, group } of pending) {
    const { full, kind } = group
    const ranked = group.qualified.flatMap(f => {
      const next = loads.get(f.p.id)! + row.minutes
      const room = f.p.availableMinutes
      return room !== null && room > 0 && next <= room
        ? [{ f, p: f.p, next, score: next / room + SKILL_WEIGHT * (1 - f.fit) }]
        : []
    }).sort((a, b) => a.score - b.score || b.f.fit - a.f.fit || byId(a.p.id, b.p.id))
    const best = ranked[0]

    if (best) {
      loads.set(best.p.id, best.next)
      const partial = kind === 'tagged' && best.f.fit < 1
      const note = kind === 'untagged' ? `${nobodyHas(row)}.`
        : partial
          ? full.length
            ? `${best.p.name} ${hasOwn(best.f)} and has more room than ${joinNames(full.map(f => f.p.name))}.`
            : `${best.p.name} ${hasOwn(best.f)}, the closest match with room.`
          : kind === 'tagged'
            ? full.length === 1 ? `Only ${best.p.name} ${hasLabel(row)}.` : `${best.p.name} ${hasLabel(row)} and has the most room.`
            : people.length === 1 ? `${best.p.name} has room for it.` : `${best.p.name} has the most room.`
      const reason = kind === 'untagged' ? 'fit_untagged' : partial ? 'fit_partial' : 'fit'
      picks.set(row.key, { key: row.key, owner: best.p.id, reason, note })
      continue
    }

    // Nobody with room: explain against the full matches when there are any.
    const qualified = (full.length ? full : group.qualified).map(f => f.p)
    let reason: Pick['reason']
    let note: string
    const unknown = qualified.filter(p => p.availableMinutes === null)
    if (qualified.length === 0) {
      reason = 'no_skill'
      note = 'Add people to the plan to place this.'
    } else if (unknown.length) {
      reason = 'unknown_hours'
      note = `${joinNames(unknown.map(p => p.name))} ${unknown.length === 1 ? 'has' : 'have'} no weekly hours set.`
    } else {
      reason = 'no_room'
      const only = qualified[0]
      // Free now: after pins and the rows already placed in this run.
      const free = Math.max(0, (only.availableMinutes ?? 0) - loads.get(only.id)!)
      note = kind === 'tagged'
        ? qualified.length === 1
          ? `Only ${only.name} ${hasLabel(row)}, and has ${hours(free)} free.`
          : `No one who ${hasLabel(row)} has ${hours(row.minutes)} free.`
        : kind === 'untagged'
          ? `${nobodyHas(row)}, and no one has ${hours(row.minutes)} free.`
          : qualified.length === 1
            ? `${only.name} has ${hours(free)} free; this needs ${hours(row.minutes)}.`
            : `No one here has ${hours(row.minutes)} free.`
    }
    picks.set(row.key, { key: row.key, owner: null, reason, note })
  }

  return rows.map(row => picks.get(row.key)!)
}

/** Each person's existing load, what the plan's owned rows add, and the sum. */
export function projectedTotals(rows: PlanRow[], people: Candidate[]) {
  return people.map(p => {
    const added = rows.reduce((sum, r) => sum + (r.owner === p.id ? r.minutes : 0), 0)
    return { id: p.id, existing: p.loadMinutes, added, projected: p.loadMinutes + added, available: p.availableMinutes }
  })
}

/** Rows grouped by when they can start: each group waits only on earlier groups. */
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

const MIN_ROWS = 2
const MAX_ROWS = 12
const MIN_MINUTES = 15
const MAX_MINUTES = 4800

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

/**
 * Checks a drafted breakdown (`{ rows }` or the rows alone) against the
 * project's labels. Tags and positions come back in the project's spelling.
 * Refuses, naming the row: a count outside 2 to 12, an estimate outside 15
 * minutes to 80 hours, an unknown tag or position, a reused key, a link to
 * itself or to a key not in the plan, and a circular dependency. The error
 * says what is wrong only; the caller adds what to do next.
 */
export function validateBreakdown(
  raw: unknown,
  labels: { tags: string[]; positions: string[] },
): { rows: PlanRow[] } | { error: string } {
  const list = isRecord(raw) && Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw) ? raw : null
  if (!list) return { error: 'The breakdown came back unreadable.' }
  if (list.length < MIN_ROWS || list.length > MAX_ROWS) {
    return { error: `A breakdown needs ${MIN_ROWS} to ${MAX_ROWS} subtasks; this one has ${list.length}.` }
  }
  const tagOf = new Map(labels.tags.map(t => [norm(t), t.trim()]))
  const positionOf = new Map(labels.positions.map(p => [norm(p), p.trim()]))

  const rows: PlanRow[] = []
  for (const [i, item] of list.entries()) {
    if (!isRecord(item)) return { error: `Row ${i + 1} came back unreadable.` }
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 200) : ''
    if (!title) return { error: `Row ${i + 1} has no title.` }
    const key = typeof item.key === 'string' ? item.key.trim().slice(0, 40) : ''
    if (!key) return { error: `"${title}" has no key.` }
    const minutes = Math.round(Number(item.minutes))
    if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      return { error: `"${title}" needs an estimate from 15 minutes to 80 hours.` }
    }
    const tagsIn = item.tags ?? []
    if (!strings(tagsIn)) return { error: `"${title}" came back with unreadable tags.` }
    const tags: string[] = []
    for (const t of tagsIn) {
      const label = tagOf.get(norm(t))
      if (!label) return { error: `"${title}" uses the tag "${t}", which this project doesn't have.` }
      if (!tags.includes(label)) tags.push(label)
    }
    let position: string | null = null
    if (item.position !== null && item.position !== undefined && item.position !== '') {
      if (typeof item.position !== 'string') return { error: `"${title}" came back with an unreadable position.` }
      const label = positionOf.get(norm(item.position))
      if (!label) return { error: `"${title}" uses the position "${item.position}", which this project doesn't have.` }
      position = label
    }
    const depsIn = item.dependsOn ?? []
    if (!strings(depsIn)) return { error: `"${title}" came back with unreadable links.` }
    const dependsOn = [...new Set(depsIn.map(d => d.trim()).filter(Boolean))]
    const description = typeof item.description === 'string' ? item.description.trim().slice(0, 2000) : ''
    rows.push({ key, title, description, minutes, tags, position, dependsOn, owner: null, pinned: false })
  }

  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.key)) return { error: `"${row.title}" reuses the key "${row.key}".` }
    seen.add(row.key)
  }
  for (const row of rows) {
    if (row.dependsOn.includes(row.key)) return { error: `"${row.title}" depends on itself.` }
    const missing = row.dependsOn.find(d => !seen.has(d))
    if (missing) return { error: `"${row.title}" depends on "${missing}", which isn't in the plan.` }
  }

  // Kahn's order; whatever is left waits on a cycle. Walk links among the
  // leftovers until one repeats: that row is on the cycle itself.
  const done = new Set<string>()
  for (let moved = true; moved;) {
    moved = false
    for (const row of rows) {
      if (!done.has(row.key) && row.dependsOn.every(d => done.has(d))) {
        done.add(row.key)
        moved = true
      }
    }
  }
  const left = rows.filter(row => !done.has(row.key))
  if (left.length) {
    const byKey = new Map(rows.map(row => [row.key, row]))
    const visited = new Set<string>()
    let at = left[0]
    while (!visited.has(at.key)) {
      visited.add(at.key)
      at = byKey.get(at.dependsOn.find(d => !done.has(d))!)!
    }
    return { error: `"${at.title}" is part of a circular dependency.` }
  }
  return { rows }
}

/**
 * The JSON schema properties of one drafted row for work-ai's breakdown. Tags
 * and position are fixed to the project's labels; when the project has none,
 * the field is left out, so the model cannot invent a label validateBreakdown
 * would refuse. `positionKeys` are the masked ids (p1, p2…) the prompt lists.
 */
export function breakdownRowProperties(tags: string[], positionKeys: string[]): Record<string, unknown> {
  const str = { type: 'string' }
  return {
    key: str,
    title: str,
    description: str,
    minutes: { type: 'integer' },
    ...(tags.length ? { tags: { type: 'array', items: { type: 'string', enum: tags } } } : {}),
    ...(positionKeys.length ? { position: { type: 'string', enum: ['', ...positionKeys] } } : {}),
    depends_on: { type: 'array', items: str },
  }
}
