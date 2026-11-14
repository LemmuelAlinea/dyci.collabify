export type OfficeHead = { office_id: string; head_id: string; head_name: string }

export type HeadedOffice = { office_id: string; office_name: string }

export type OfficeOverview = {
  spaces: number
  running_projects: number
  people: number
  needs_attention: number
}

export type OfficeAttention = {
  project_id: string
  project_name: string
  space_name: string
  no_pm: boolean
  quiet_since: string | null
  i_am_on: boolean
}

export type OfficeSpaceRow = { space_id: string; space_name: string; running_projects: number }

export type OfficePersonRow = { id: string; name: string }

/** Office id to the head's id, for the Head select. */
export function headByOffice(heads: OfficeHead[]) {
  return new Map(heads.map((h) => [h.office_id, h.head_id]))
}

/** Office id to the head's name, for Admin Home. */
export function headNameByOffice(heads: OfficeHead[]) {
  return new Map(heads.map((h) => [h.office_id, h.head_name]))
}
