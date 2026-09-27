import type { GeneralSpaceSummary } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export type LiveRow = { id: string; name: string; to: string; tone?: 'education' | 'work' }

/** Two per section: the rest are one click away behind the header's All link. */
const CAP = 2

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
export function classRows(spaces: GeneralSpaceSummary[]): LiveRow[] {
  return mine(spaces, 'education')
    .filter((space) => space.class_id)
    .slice(0, CAP)
    .map((space) => ({ id: space.id, name: space.name, to: paths.class(space.class_id!), tone: 'education' }))
}

/** Your work spaces, as rows for the rail's Spaces section. */
export function workSpaceRows(spaces: GeneralSpaceSummary[]): LiveRow[] {
  return mine(spaces, 'work')
    .slice(0, CAP)
    .map((space) => ({ id: space.id, name: space.name, to: paths.space(space.id), tone: 'work' }))
}
