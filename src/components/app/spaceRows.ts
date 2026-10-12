import type { GeneralSpaceSummary } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export type LiveRow = {
  id: string
  name: string
  to: string
  tone?: 'education' | 'work'
  /** A second line under the name on the places card: a class's section, a space's projects. */
  detail?: string
}

/** Three rows per section: the rest are one click away behind the All link under them. */
const CAP = 3
export const PROJECT_CAP = CAP

function mine(spaces: GeneralSpaceSummary[], kind: GeneralSpaceSummary['kind']) {
  return spaces
    .filter((space) => space.kind === kind && space.my_level && !space.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Your classes, as rows for the rail's places card.
 *
 * A class space opens the class it belongs to, so one with no `class_id` has
 * no page to open and is dropped rather than linked to `/classes/<spaceId>`,
 * which does not exist. A class space is named "Course · Section"; the
 * section goes on the second line.
 */
export function classRows(spaces: GeneralSpaceSummary[], cap = CAP): LiveRow[] {
  return mine(spaces, 'education')
    .filter((space) => space.class_id)
    .slice(0, cap)
    .map((space) => {
      const cut = space.name.lastIndexOf(' · ')
      return {
        id: space.id,
        name: cut > 0 ? space.name.slice(0, cut) : space.name,
        detail: cut > 0 ? space.name.slice(cut + 3) : 'Class',
        to: paths.class(space.class_id!),
        tone: 'education',
      }
    })
}

/**
 * Your classes and work spaces in one list, by name — the Spaces kind for
 * anyone whose classes live under Spaces rather than a Classes kind.
 */
export function spaceAndClassRows(spaces: GeneralSpaceSummary[], cap = CAP): LiveRow[] {
  return [...classRows(spaces, Infinity), ...workSpaceRows(spaces, Infinity)]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, cap)
}

/** Your work spaces, as rows for the rail's places card. */
export function workSpaceRows(spaces: GeneralSpaceSummary[], cap = CAP): LiveRow[] {
  return mine(spaces, 'work')
    .slice(0, cap)
    .map((space) => ({
      id: space.id,
      name: space.name,
      detail: `${space.project_count} project${space.project_count === 1 ? '' : 's'}`,
      to: paths.space(space.id),
      tone: 'work',
    }))
}
