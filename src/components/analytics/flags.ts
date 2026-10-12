import type { StudentFlag, Tone } from '../../lib/analyticsMath'
import type { RosterRow } from '../../lib/types'

export type RosterEntry = RosterRow & {
  flags: StudentFlag[]
  lowestShare: number | null
  trend: number[]
  idle: number | null
  groups: string[]
}

/** One student in one class. The global page lists a student once per class. */
export const entryKey = (e: Pick<RosterEntry, 'class_id' | 'student_id'>) => `${e.class_id}:${e.student_id}`

export const FLAG_META: Record<StudentFlag, { word: (e: RosterEntry) => string; tone: Tone }> = {
  no_group: { word: () => 'In no group', tone: 'danger' },
  holding_nothing: { word: () => 'Holding nothing', tone: 'danger' },
  low_share: { word: () => 'Low share', tone: 'warning' },
  inactive: { word: (e) => (e.idle === null ? 'Never active' : `Inactive ${e.idle} days`), tone: 'warning' },
  often_late: { word: () => 'Often late', tone: 'warning' },
}
