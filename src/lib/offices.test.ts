import { describe, expect, it } from 'vitest'
import { attentionReason, liveOfficeId, officeName, sortOverview } from './offices'
import type { AttentionProject, Office, OfficeOverviewRow } from './offices'

const row = (office_id: string | null, office_name: string): OfficeOverviewRow => ({
  office_id,
  office_name,
  spaces: 0,
  running_projects: 0,
  people: 0,
  needs_attention: 0,
})

const project = (over: Partial<AttentionProject>): AttentionProject => ({
  project_id: 'p',
  project_name: 'Site',
  space_name: 'Web',
  office_id: null,
  office_name: '',
  no_pm: false,
  quiet_since: null,
  ...over,
})

const offices: Office[] = [
  { id: 'a', name: 'IT', description: '', archived_at: null },
  { id: 'b', name: 'Old', description: '', archived_at: '2026-01-01T00:00:00Z' },
]

describe('offices', () => {
  it('sortOverview puts Unassigned last and sorts the rest by name', () => {
    const out = sortOverview([row('1', 'IT'), row(null, ''), row('2', 'events')])
    expect(out.map((r) => r.office_name)).toEqual(['events', 'IT', ''])
  })

  it('attentionReason prefers No project manager over quiet', () => {
    expect(attentionReason(project({ no_pm: true, quiet_since: '2026-10-01T00:00:00Z' }))).toBe(
      'No project manager',
    )
  })

  it('attentionReason names the quiet date', () => {
    expect(attentionReason(project({ quiet_since: '2026-10-01T00:00:00Z' }))).toMatch(
      /^Quiet since /,
    )
  })

  it('officeName returns No office for null and unknown ids', () => {
    expect(officeName(null, offices)).toBe('No office')
    expect(officeName('zzz', offices)).toBe('No office')
    expect(officeName('a', offices)).toBe('IT')
  })

  it('liveOfficeId returns null for an archived or unknown office', () => {
    expect(liveOfficeId('a', offices)).toBe('a')
    expect(liveOfficeId('b', offices)).toBeNull()
    expect(liveOfficeId('zzz', offices)).toBeNull()
    expect(liveOfficeId(null, offices)).toBeNull()
  })
})
