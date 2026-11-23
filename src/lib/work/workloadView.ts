// The space Workload tab's filters, sort and summary: plain functions over the
// people the page has already read, so the page stays a view of them.

/** How full someone is in the first week shown. Away is a separate filter. */
export type LoadStatus = 'over' | 'near' | 'room'
export type StatusFilter = 'all' | LoadStatus | 'away'
export type WorkloadSort = 'loaded' | 'free' | 'name'

/** One person in the first week shown. `byProject` keys a null project as other work the viewer can't name. */
export type WorkloadPerson = {
  id: string
  name: string
  role: string | null
  teamIds: string[]
  away: boolean
  load: number
  available: number | null
  byProject: Map<string | null, number>
}

export type WorkloadFilters = {
  q: string
  projects: string[]
  teams: string[]
  roles: string[]
  status: StatusFilter
  sort: WorkloadSort
}

export const EMPTY_FILTERS: WorkloadFilters = { q: '', projects: [], teams: [], roles: [], status: 'all', sort: 'loaded' }

const STATUSES: StatusFilter[] = ['all', 'over', 'near', 'room', 'away']
const SORTS: WorkloadSort[] = ['loaded', 'free', 'name']

/** Near full from 80%, over past 100%: the same lines the bars' tones use. */
export function statusOf(p: Pick<WorkloadPerson, 'load' | 'available'>): LoadStatus {
  if (p.available == null) return 'room'
  if (p.available <= 0) return p.load > 0 ? 'over' : 'room'
  const ratio = p.load / p.available
  return ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'room'
}

// Unknown hours sort as empty; no hours with work sort as the most loaded.
const ratioOf = (p: WorkloadPerson) =>
  p.available == null ? 0 : p.available <= 0 ? (p.load > 0 ? Infinity : 0) : p.load / p.available
const freeOf = (p: WorkloadPerson) => (p.available ?? 0) - p.load

/** The people who match every filter, in the chosen order (ties by name). */
export function filterPeople(people: WorkloadPerson[], f: WorkloadFilters): WorkloadPerson[] {
  const q = f.q.trim().toLowerCase()
  const byName = (a: WorkloadPerson, b: WorkloadPerson) => a.name.localeCompare(b.name)
  return people
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .filter((p) => !f.projects.length || f.projects.some((id) => (p.byProject.get(id) ?? 0) > 0))
    .filter((p) => !f.teams.length || f.teams.some((id) => p.teamIds.includes(id)))
    .filter((p) => !f.roles.length || (p.role !== null && f.roles.includes(p.role)))
    .filter((p) => f.status === 'all' || (f.status === 'away' ? p.away : statusOf(p) === f.status))
    .sort((a, b) =>
      f.sort === 'name' ? byName(a, b)
        : f.sort === 'free' ? freeOf(b) - freeOf(a) || byName(a, b)
          : ratioOf(b) - ratioOf(a) || byName(a, b))
}

/** The chosen projects' hours, and the rest of the person's load. */
export function projectShare(p: WorkloadPerson, projects: string[]): { shown: number; elsewhere: number } {
  if (!projects.length) return { shown: p.load, elsewhere: 0 }
  const shown = projects.reduce((n, id) => n + (p.byProject.get(id) ?? 0), 0)
  return { shown, elsewhere: Math.max(0, p.load - shown) }
}

export type WorkloadSummary = {
  people: number
  load: number
  available: number
  over: number
  near: number
  room: number
  away: number
}

/** Team load and how many people are in each state, over the people given. */
export function summarize(people: WorkloadPerson[]): WorkloadSummary {
  const s: WorkloadSummary = { people: people.length, load: 0, available: 0, over: 0, near: 0, room: 0, away: 0 }
  for (const p of people) {
    s.load += p.load
    s.available += p.available ?? 0
    s[statusOf(p)] += 1
    if (p.away) s.away += 1
  }
  return s
}

const KEYS = ['q', 'project', 'team', 'role', 'status', 'sort'] as const

/** The filters a link carries; anything unknown falls back to the default. */
export function readFilters(params: URLSearchParams): WorkloadFilters {
  const list = (key: string) => (params.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const status = params.get('status') as StatusFilter | null
  const sort = params.get('sort') as WorkloadSort | null
  return {
    q: params.get('q') ?? '',
    projects: list('project'),
    teams: list('team'),
    roles: list('role'),
    status: status && STATUSES.includes(status) ? status : 'all',
    sort: sort && SORTS.includes(sort) ? sort : 'loaded',
  }
}

/** The link's parameters with these filters, leaving any other parameter as it was. */
export function writeFilters(f: WorkloadFilters, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of KEYS) next.delete(key)
  if (f.q.trim()) next.set('q', f.q)
  if (f.projects.length) next.set('project', f.projects.join(','))
  if (f.teams.length) next.set('team', f.teams.join(','))
  if (f.roles.length) next.set('role', f.roles.join(','))
  if (f.status !== 'all') next.set('status', f.status)
  if (f.sort !== 'loaded') next.set('sort', f.sort)
  return next
}

/** Whether anything narrows the list (sort alone does not). */
export function hasFilters(f: WorkloadFilters): boolean {
  return Boolean(f.q.trim()) || f.projects.length > 0 || f.teams.length > 0 || f.roles.length > 0 || f.status !== 'all'
}
