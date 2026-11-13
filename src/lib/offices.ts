import { dayLabel } from './report'

export type Office = {
  id: string
  name: string
  description: string
  archived_at: string | null
}

export type OfficePerson = {
  id: string
  name: string
  email: string
  status: 'active' | 'pending' | 'rejected'
  office_id: string | null
}

export type OfficeSpace = {
  id: string
  name: string
  office_id: string | null
  archived: boolean
  running_projects: number
}

export type OfficeOverviewRow = {
  office_id: string | null
  office_name: string
  spaces: number
  running_projects: number
  people: number
  needs_attention: number
}

export type AttentionProject = {
  project_id: string
  project_name: string
  space_name: string
  office_id: string | null
  office_name: string
  no_pm: boolean
  quiet_since: string | null
}

export type OrgSummary = {
  accounts_in_setup: number
  privacy_due: number
}

/** By name, case-insensitive, with the Unassigned row last. */
export function sortOverview(rows: OfficeOverviewRow[]) {
  return [...rows].sort((a, b) => {
    if ((a.office_id === null) !== (b.office_id === null)) return a.office_id === null ? 1 : -1
    return a.office_name.localeCompare(b.office_name, undefined, { sensitivity: 'base' })
  })
}

/** Why a project needs a look. A missing project manager wins over quiet. */
export function attentionReason(p: AttentionProject) {
  if (p.no_pm) return 'No project manager'
  return `Quiet since ${dayLabel(p.quiet_since)}`
}

export function officeName(id: string | null, offices: Office[]) {
  return offices.find((o) => o.id === id)?.name ?? 'No office'
}

/**
 * The id only when it names a live office. The database counts a link to an
 * archived office as Unassigned, so groupings use this to match.
 */
export function liveOfficeId(id: string | null, offices: Office[]) {
  if (!id) return null
  return offices.some((o) => o.id === id && o.archived_at === null) ? id : null
}
