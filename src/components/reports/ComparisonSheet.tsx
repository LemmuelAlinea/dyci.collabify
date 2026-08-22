import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { momentLabel } from '../../lib/report'
import type { ClassReport } from '../../lib/report'
import { resultLabel } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'

/**
 * One project, every group side by side.
 *
 * Answers "how did the class do on Activity 3" on one page, which is the
 * question a professor asks the moment a deadline passes and the one that
 * otherwise means opening twelve boards.
 */
export function ComparisonSheet({
  cls,
  boards,
  projectTitle,
  professor,
}: {
  cls: ClassReport
  boards: BoardSummary[]
  projectTitle: string
  professor: string
}) {
  const submitted = boards.filter((b) => b.submitted_at).length
  const accepted = boards.filter((b) => b.result_verdict === 'accepted').length
  const late = boards.reduce((n, b) => n + b.late_count, 0)

  return (
    <Sheet
      title="Project comparison"
      subject={projectTitle}
      meta={[
        `${cls.class_initial} — ${cls.class_name}`,
        `${cls.code} ${cls.section}`,
        boards[0]?.project_due_at ? `Due ${momentLabel(boards[0].project_due_at)}` : 'No deadline',
      ]}
      professor={professor}
      footnote="Completion is the share of the board's weight that is finished. It is not a mark, and a board finished late still reads 100%."
    >
      <Figures
        rows={[
          ['Boards', boards.length],
          ['Handed in', submitted],
          ['Accepted', accepted],
          ['Tasks finished late', late],
        ]}
      />

      <SheetSection title="Group by group">
        <ReportTable
          headers={['Board', 'Members', 'Tasks', 'Finished', 'Late', 'Completion', 'Outcome']}
          align={[1, 2, 3, 4, 5]}
          rows={[...boards]
            .sort((a, b) => Number(b.done_pct) - Number(a.done_pct))
            .map((b) => [
              b.group_name ?? b.student_name ?? 'A board',
              b.group_id ? b.member_count : 1,
              b.task_count,
              b.done_count,
              b.late_count,
              `${Math.round(Number(b.done_pct))}%`,
              b.result_verdict
                ? resultLabel(b.result_verdict)
                : b.submitted_at
                  ? 'Handed in'
                  : 'Still going',
            ])}
          empty="This project has no boards."
        />
      </SheetSection>
    </Sheet>
  )
}

/** The same table, as spreadsheet rows. */
export function comparisonCsv(boards: BoardSummary[]) {
  const headers = [
    'Board',
    'Members',
    'Tasks',
    'Finished',
    'Late',
    'Completion %',
    'Handed in',
    'Outcome',
  ]
  const body = boards.map((b) => [
    b.group_name ?? b.student_name ?? 'A board',
    b.group_id ? b.member_count : 1,
    b.task_count,
    b.done_count,
    b.late_count,
    Math.round(Number(b.done_pct)),
    b.submitted_at ?? '',
    b.result_verdict ?? '',
  ])
  return { headers, body }
}
