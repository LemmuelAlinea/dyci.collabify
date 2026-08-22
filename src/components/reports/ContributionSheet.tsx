import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { dayLabel, momentLabel, ownerName, pct } from '../../lib/report'
import type { ClassReport, StudentWork } from '../../lib/report'
import { resultLabel } from '../../lib/types'
import type { ReassignmentRow, ReassignmentStatus } from '../../lib/types'

/** The status as a sentence rather than a database label. */
const RULING: Record<ReassignmentStatus, string> = {
  pending: 'Waiting on a decision',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn by the asker',
}

/**
 * One student, across everything they were part of in a class.
 *
 * The evidence behind an individual mark in group work — which is the hardest
 * thing to defend and the reason this report exists. It says what they held,
 * what they finished, and how much of each board that was. It does not say
 * whether any of it was good: that judgement is the professor's, and putting a
 * figure next to it here would quietly turn effort into a grade.
 */
export function ContributionSheet({
  cls,
  rows,
  reassignments,
  professor,
}: {
  cls: ClassReport
  /** Every board this student is on, in this class. */
  rows: StudentWork[]
  reassignments: ReassignmentRow[]
  professor: string
}) {
  const student = rows[0]?.student_name ?? 'This student'
  const held = rows.reduce((n, r) => n + r.tasks_held, 0)
  const done = rows.reduce((n, r) => n + r.tasks_done, 0)
  const late = rows.reduce((n, r) => n + r.tasks_late, 0)

  return (
    <Sheet
      title="Student contribution"
      subject={student}
      meta={[
        `${cls.class_initial} — ${cls.class_name}`,
        `${cls.code} ${cls.section}`,
        `${cls.semester} semester · ${cls.school_year}`,
      ]}
      professor={professor}
      footnote="A share is of the board's weight, not of a mark. Shared tasks are split evenly between the people on them."
    >
      <Figures
        rows={[
          ['Boards they are on', rows.length],
          ['Tasks held', held],
          ['Tasks finished', done],
          ['Finished late', late],
        ]}
      />

      <SheetSection title="Board by board">
        <ReportTable
          headers={['Project', 'Board', 'Held', 'Finished', 'Late', 'Share of board', 'Outcome']}
          align={[2, 3, 4, 5]}
          rows={rows.map((r) => [
            r.project_title,
            ownerName(r),
            r.tasks_held,
            r.tasks_done,
            r.tasks_late,
            pct(r.held_pct),
            r.result_verdict
              ? resultLabel(r.result_verdict)
              : r.submitted_at
                ? 'Handed in'
                : 'Still going',
          ])}
          empty="This student is on no board in this class."
        />
      </SheetSection>

      <SheetSection title="When they worked">
        <ReportTable
          headers={['Project', 'First task started', 'Last task finished', 'Board handed in']}
          rows={rows.map((r) => [
            r.project_title,
            r.first_activity ? dayLabel(r.first_activity) : 'Never started',
            r.last_finish ? dayLabel(r.last_finish) : '—',
            r.submitted_at ? momentLabel(r.submitted_at) : '—',
          ])}
          empty="Nothing to date."
        />
      </SheetSection>

      {reassignments.length > 0 && (
        <SheetSection title="Work that changed hands">
          <ReportTable
            headers={['Task', 'Asked for', 'By', 'Ruling', 'When']}
            rows={reassignments.map((r) => [
              r.task_title,
              r.wants === 'take_over' ? 'Take it on' : 'Release to the group',
              r.requested_by_name,
              RULING[r.status],
              dayLabel(r.decided_at ?? r.created_at),
            ])}
          />
        </SheetSection>
      )}
    </Sheet>
  )
}
