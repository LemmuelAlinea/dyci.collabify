import type { GeneralSpaceSummary } from '../../lib/general/types'
import { paths } from '../../lib/paths'

export type LiveRow = { id: string; name: string; to: string; tone?: 'education' | 'work' }

/** However many classes crowd the list, a reader with any work spaces still sees at least this many. */
const MIN_WORK_SHOWN = 2
const CAP = 6

/**
 * Your spaces, as rows for the rail.
 *
 * Education opens the class it belongs to; a work space opens itself —
 * joining a project never joins its space, so a class space is the only kind
 * whose own page is somewhere else. A class space with no `class_id` has no
 * page of its own to open, so it is dropped rather than linked to
 * `/classes/<spaceId>`, which does not exist.
 *
 * Education first, then name within a kind — a space holds projects, so the
 * rail reads widest to narrowest, and education leads because a class is
 * where most accounts' work actually sits. The list is capped at six rows,
 * but a reader with any work spaces always sees at least two of them, so a
 * professor teaching six or more classes still sees their own side projects.
 */
export function spaceRows(spaces: GeneralSpaceSummary[]): LiveRow[] {
  const mine = spaces
    .filter((space) => space.my_level && !space.archived_at)
    .filter((space) => space.kind !== 'education' || space.class_id)
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'education' ? -1 : 1,
    )

  const classes = mine.filter((space) => space.kind === 'education')
  const work = mine.filter((space) => space.kind === 'work')

  const workReserve = Math.min(MIN_WORK_SHOWN, work.length)
  const classesShown = classes.slice(0, CAP - workReserve)
  const workShown = work.slice(0, CAP - classesShown.length)

  return [...classesShown, ...workShown].map((space): LiveRow =>
    space.kind === 'education'
      ? { id: space.id, name: space.name, to: paths.class(space.class_id!), tone: 'education' }
      : { id: space.id, name: space.name, to: paths.space(space.id), tone: 'work' },
  )
}
