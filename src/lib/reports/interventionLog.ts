import { manilaDay } from '../analyticsMath'
import { NOTE_KIND_META } from '../notes'
import type { ClassNoteKind, NoteLogRow } from '../types'
import type { Block, Cell, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

export type LogFilters = { kinds: ClassNoteKind[]; status: 'open' | 'resolved' | 'all'; studentId: string; boardId: string }

const KIND_ORDER: ClassNoteKind[] = ['note', 'meeting', 'follow_up', 'nudge', 'peer_reminder']

export function interventionLogDoc(input: ReportHead & {
  range: DayRange
  /** Today, a Manila day: what "overdue" is measured against. */
  asOf: string
  notes: NoteLogRow[]
  filters: LogFilters
}): ReportDoc {
  const { range, filters } = input
  const shown = input.notes
    .filter((n) => {
      const day = manilaDay(n.created_at)
      return day >= range.from && day <= range.to
    })
    .filter((n) => filters.kinds.length === 0 || filters.kinds.includes(n.kind))
    .filter((n) => (filters.status === 'open' ? !n.resolved_at : filters.status === 'resolved' ? !!n.resolved_at : true))
    .filter((n) => !filters.studentId || n.student_id === filters.studentId)
    .filter((n) => !filters.boardId || n.board_id === filters.boardId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  const count = (k: ClassNoteKind) => shown.filter((n) => n.kind === k).length
  const openFollowUps = shown.filter((n) => !n.resolved_at && n.follow_up_on !== null)
  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        ...KIND_ORDER.filter((k) => count(k) > 0).map((k) => ({ label: NOTE_KIND_META[k].label, value: count(k) })),
        { label: 'Open follow-ups', value: openFollowUps.length },
        { label: 'Overdue follow-ups', value: openFollowUps.filter((n) => (n.follow_up_on as string) < input.asOf).length },
        { label: 'Reminders sent', value: count('nudge') + count('peer_reminder') },
      ],
    },
  ]

  if (shown.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No notes in these dates. Widen the dates or add notes from Analytics.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'log',
      title: 'Log',
      columns: [
        { key: 'date', label: 'Date', type: 'datetime' },
        { key: 'kind', label: 'Kind', type: 'status' },
        { key: 'about', label: 'About', type: 'text' },
        { key: 'note', label: 'Note', type: 'text' },
        { key: 'followUp', label: 'Follow up by', type: 'date' },
        { key: 'resolved', label: 'Resolved', type: 'date' },
        { key: 'outcome', label: 'Outcome', type: 'text' },
        { key: 'by', label: 'Written by', type: 'text' },
      ],
      rows: shown.map<Cell[]>((n) => [
        n.created_at,
        { value: NOTE_KIND_META[n.kind].label, tone: NOTE_KIND_META[n.kind].tone },
        n.student_name ?? (n.group_name ? `${n.group_name}${n.project_title ? ` · ${n.project_title}` : ''}` : null),
        n.body,
        n.follow_up_on,
        n.resolved_at,
        n.outcome || null,
        n.author_name,
      ]),
    })
  }

  const parts = [
    filters.kinds.length ? filters.kinds.map((k) => NOTE_KIND_META[k].label).join(', ') : null,
    filters.status !== 'all' ? (filters.status === 'open' ? 'Open only' : 'Resolved only') : null,
  ].filter(Boolean)

  return {
    header: {
      title: 'Intervention log',
      subtitle: rangeText(range),
      classLine: input.classLine,
      rangeLabel: parts.length ? parts.join(' · ') : null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: ['Only teaching staff can read these notes.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
