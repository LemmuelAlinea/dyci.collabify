import type { GeneralSpaceSummary } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export type LiveRow = { id: string; name: string; to: string; tone?: 'education' | 'work' }

/** Three rows per section: the rest are one click away behind the header's All link. */
const CAP = 3
export const PROJECT_CAP = CAP

function mine(spaces: GeneralSpaceSummary[], kind: GeneralSpaceSummary['kind']) {
  return spaces
    .filter((space) => space.kind === kind && space.my_level && !space.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Your classes, as rows for the rail's Classes section.
 *
 * A class space opens the class it belongs to, so one with no `class_id` has
 * no page to open and is dropped rather than linked to `/classes/<spaceId>`,
 * which does not exist.
 */
export function classRows(spaces: GeneralSpaceSummary[], cap = CAP): LiveRow[] {
  return mine(spaces, 'education')
    .filter((space) => space.class_id)
    .slice(0, cap)
    .map((space) => ({ id: space.id, name: space.name, to: paths.class(space.class_id!), tone: 'education' }))
}

/**
 * Your classes and work spaces in one list, by name — the Spaces section for
 * anyone whose classes live under Spaces rather than a Classes section.
 */
export function spaceAndClassRows(spaces: GeneralSpaceSummary[]): LiveRow[] {
  return [...classRows(spaces, Infinity), ...workSpaceRows(spaces, Infinity)]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, CAP)
}

/** Your work spaces, as rows for the rail's Spaces section. */
export function workSpaceRows(spaces: GeneralSpaceSummary[], cap = CAP): LiveRow[] {
  return mine(spaces, 'work')
    .slice(0, cap)
    .map((space) => ({ id: space.id, name: space.name, to: paths.space(space.id), tone: 'work' }))
}
