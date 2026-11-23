import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  filterPeople,
  hasFilters,
  projectShare,
  readFilters,
  statusOf,
  summarize,
  writeFilters,
  type WorkloadPerson,
} from './workloadView'

const person = (over: Partial<WorkloadPerson> & { id: string }): WorkloadPerson => ({
  name: over.id.toUpperCase(),
  role: 'member',
  teamIds: [],
  away: false,
  load: 0,
  available: 2400,
  byProject: new Map(),
  ...over,
})

const team = [
  person({ id: 'ivan', name: 'Ivan Caburnay', load: 2760, byProject: new Map([['p1', 1800], [null, 960]]), teamIds: ['dev'] }),
  person({ id: 'wilson', name: 'Wilson Mendoza', load: 1680, available: 2160, away: true, byProject: new Map([['p1', 1680]]), teamIds: ['dev'] }),
  person({ id: 'keneth', name: 'Keneth Ramos', load: 840, byProject: new Map([['p2', 840]]), teamIds: ['dev', 'qa'] }),
  person({ id: 'luke', name: 'Luke Perry Mendoza', role: 'coordinator', load: 2000, byProject: new Map([['p1', 2000]]) }),
]

describe('statusOf', () => {
  it('reads over, near full and room from load against available hours', () => {
    expect(statusOf(team[0])).toBe('over')
    expect(statusOf(team[3])).toBe('near')
    expect(statusOf(team[2])).toBe('room')
    // Away is its own filter; the load status still holds.
    expect(statusOf(team[1])).toBe('room')
  })
})

describe('summarize', () => {
  it('counts the people shown and their team load', () => {
    expect(summarize(team)).toEqual({ people: 4, load: 7280, available: 9360, over: 1, near: 1, room: 2, away: 1 })
  })
})

describe('filterPeople', () => {
  it('finds names in any case and order', () => {
    expect(filterPeople(team, { ...EMPTY_FILTERS, q: 'mendoza' }).map((p) => p.id)).toEqual(['luke', 'wilson'])
  })

  it('keeps people who work on any chosen project', () => {
    expect(filterPeople(team, { ...EMPTY_FILTERS, projects: ['p2'] }).map((p) => p.id)).toEqual(['keneth'])
  })

  it('filters by team, role and status together', () => {
    const f = { ...EMPTY_FILTERS, teams: ['dev'], roles: ['member'], status: 'away' as const }
    expect(filterPeople(team, f).map((p) => p.id)).toEqual(['wilson'])
    expect(filterPeople(team, { ...EMPTY_FILTERS, status: 'over' }).map((p) => p.id)).toEqual(['ivan'])
  })

  it('sorts by most loaded, most free hours or name', () => {
    expect(filterPeople(team, { ...EMPTY_FILTERS, sort: 'loaded' }).map((p) => p.id)).toEqual(['ivan', 'luke', 'wilson', 'keneth'])
    expect(filterPeople(team, { ...EMPTY_FILTERS, sort: 'free' }).map((p) => p.id)).toEqual(['keneth', 'wilson', 'luke', 'ivan'])
    expect(filterPeople(team, { ...EMPTY_FILTERS, sort: 'name' }).map((p) => p.id)).toEqual(['ivan', 'keneth', 'luke', 'wilson'])
  })
})

describe('projectShare', () => {
  it('splits a person into the chosen projects and the rest', () => {
    expect(projectShare(team[0], ['p1'])).toEqual({ shown: 1800, elsewhere: 960 })
    expect(projectShare(team[0], [])).toEqual({ shown: 2760, elsewhere: 0 })
  })
})

describe('filters in the link', () => {
  it('reads and writes the same filters', () => {
    const f = { q: 'ivan', projects: ['p1', 'p2'], teams: ['dev'], roles: ['qa'], status: 'near' as const, sort: 'free' as const }
    expect(readFilters(new URLSearchParams(writeFilters(f, new URLSearchParams('tab=x')).toString()))).toEqual(f)
    expect(writeFilters(f, new URLSearchParams('tab=x')).get('tab')).toBe('x')
  })

  it('drops what is empty or unknown', () => {
    expect(readFilters(new URLSearchParams('status=bogus&sort=bogus'))).toEqual(EMPTY_FILTERS)
    expect(writeFilters(EMPTY_FILTERS, new URLSearchParams('q=old&away=x')).toString()).toBe('away=x')
    expect(hasFilters(EMPTY_FILTERS)).toBe(false)
    expect(hasFilters({ ...EMPTY_FILTERS, q: 'a' })).toBe(true)
  })
})
