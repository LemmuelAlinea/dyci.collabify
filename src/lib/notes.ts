import type { Tone } from './analyticsMath'
import type { Action } from './insight'
import type { ClassNote, ClassNoteKind } from './types'

export const NOTE_KIND_META: Record<ClassNoteKind, { label: string; tone: Tone }> = {
  note: { label: 'Note', tone: 'pending' },
  meeting: { label: 'Meeting', tone: 'success' },
  follow_up: { label: 'Follow-up', tone: 'warning' },
  nudge: { label: 'Reminder', tone: 'pending' },
  peer_reminder: { label: 'Peer reminder', tone: 'pending' },
}

/** What a professor can add by hand. Reminders are logged when they are sent. */
export const ADDABLE_KINDS = ['note', 'meeting', 'follow_up'] as const
export type AddableNoteKind = (typeof ADDABLE_KINDS)[number]

/** A student's notes and their boards' notes, or one board's, newest first. */
export function notesAbout(
  notes: ClassNote[],
  about: { classId: string; studentId?: string | null; boardIds?: string[] },
): ClassNote[] {
  const boards = new Set(about.boardIds ?? [])
  return notes
    .filter((n) => n.class_id === about.classId)
    .filter(
      (n) =>
        (about.studentId ? n.student_id === about.studentId : false) ||
        (n.board_id !== null && boards.has(n.board_id) && (!about.studentId || n.student_id === null || n.student_id === about.studentId)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

const dayFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })

/**
 * Open notes whose follow-up date has come, as Needs attention cards. `today`
 * is a Manila day (YYYY-MM-DD), compared as a string with follow_up_on.
 */
export function followUpActions(notes: ClassNote[], today: string, nameOf: (n: ClassNote) => string): Action[] {
  return notes
    .filter((n) => !n.resolved_at && n.follow_up_on !== null && n.follow_up_on <= today)
    .map((n) => ({
      key: `follow_up_due-${n.id}`,
      kind: 'follow_up_due' as const,
      severity: 2,
      title: `Follow up with ${nameOf(n)}`,
      evidence: `Due ${dayFmt.format(new Date(`${n.follow_up_on}T00:00:00+08:00`))}. You noted: ${n.body}`,
      to: null,
      classId: n.class_id,
      boardId: n.board_id,
      projectId: null,
      studentId: n.student_id,
    }))
}
