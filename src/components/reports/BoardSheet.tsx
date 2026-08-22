import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { dayLabel, momentLabel, pct } from '../../lib/report'
import type { BoardTask, ClassReport, StudentWork } from '../../lib/report'
import { resultLabel, taskStatusLabel } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'

/**
 * One group's project, start to finish.
 *
 * The only page that holds the whole of a group's work: who was on it, every
 * task with who held it and when it moved, what was handed in and what the
 * professor answered. It is also what the group itself will get back when the
 * student side of reports is built, which is why the verdict's reason is
 * printed in full rather than summarised.
 */
export function BoardSheet({
  cls,
  board,
  tasks,
  members,
  feedback,
  professor,
}: {
  cls: ClassReport
  board: BoardSummary
  tasks: BoardTask[]
  /** The people on this board, from report_student_work. */
  members: StudentWork[]
  /** The reason given when the board was returned, if it was. */
  feedback: string | null
  professor: string
}) {
  const owner = board.group_name ?? board.student_name ?? 'A board'
  const done = tasks.filter((t) => t.status === 'done').length
  const late = tasks.filter((t) => t.late).length

  return (
    <Sheet
      title="Group project report"
      subject={`${owner} — ${board.project_title}`}
      meta={[
        `${cls.class_initial} — ${cls.class_name}`,
        `${cls.code} ${cls.section}`,
        board.project_due_at ? `Due ${momentLabel(board.project_due_at)}` : 'No deadline set',
      ]}
      professor={professor}
    >
      <Figures
        rows={[
          ['Tasks', tasks.length],
          ['Finished', done],
          ['Finished late', late],
          [
            'Outcome',
            board.result_verdict
              ? resultLabel(board.result_verdict)
              : board.submitted_at
                ? 'Handed in'
                : 'Still going',
          ],
        ]}
      />

      <SheetSection title="Who was on it">
        <ReportTable
          headers={['Member', 'Held', 'Finished', 'Late', 'Share of the board']}
          align={[1, 2, 3, 4]}
          rows={members.map((m) => [
            m.student_name,
            m.tasks_held,
            m.tasks_done,
            m.tasks_late,
            pct(m.held_pct),
          ])}
          empty="Nobody is on this board."
        />
      </SheetSection>

      <SheetSection title="The work">
        <ReportTable
          headers={['#', 'Task', 'Held by', 'Status', 'Due', 'Finished', 'Files']}
          align={[0, 6]}
          rows={tasks.map((t, i) => [
            i + 1,
            t.title,
            t.holders || '— unclaimed —',
            t.late ? `${taskStatusLabel(t.status)} (late)` : taskStatusLabel(t.status),
            t.due_at ? dayLabel(t.due_at) : '—',
            t.done_at ? dayLabel(t.done_at) : '—',
            t.file_count,
          ])}
          empty="No task was ever put on this board."
        />
      </SheetSection>

      <SheetSection title="How it ended">
        <ReportTable
          headers={['', '']}
          rows={[
            [
              'Handed in',
              board.submitted_at
                ? `${momentLabel(board.submitted_at)}${
                    board.submitted_by_name ? ` by ${board.submitted_by_name}` : ''
                  }`
                : 'Not handed in',
            ],
            [
              'Answer',
              board.result_verdict
                ? `${resultLabel(board.result_verdict)} · ${momentLabel(board.result_at)}`
                : 'No answer recorded',
            ],
            ['Reason given', feedback?.trim() ? feedback : '—'],
          ]}
        />
      </SheetSection>
    </Sheet>
  )
}
