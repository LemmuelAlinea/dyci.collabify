import { csvMoment } from '../../lib/report'
import type { ClassReport, StudentWork } from '../../lib/report'
import { fullName } from '../../lib/types'
import type { BoardSummary, ClassMember } from '../../lib/types'

/*
 * Each report sheet's table as rows a spreadsheet can open. Kept apart from the
 * sheets so those files export components only.
 */

/** The same grid as rows a spreadsheet can open. */
export function classRecordCsv(
  members: ClassMember[],
  projects: { id: string; title: string }[],
  rows: StudentWork[],
) {
  const byStudent = new Map<string, StudentWork[]>()
  for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r])

  // Three columns per project rather than one packed cell: a spreadsheet is
  // opened to sort and total, and "4/7 · 46%" can do neither.
  const headers = [
    'Student',
    ...projects.flatMap((p) => [`${p.title} — held`, `${p.title} — finished`, `${p.title} — share %`]),
    'Total held',
    'Total finished',
    'Total late',
  ]

  const body = members.map((m) => {
    const mine = byStudent.get(m.student_id) ?? []
    const cells = projects.flatMap((p) => {
      const row = mine.find((r) => r.project_id === p.id)
      return row
        ? [row.tasks_held, row.tasks_done, Math.round(Number(row.held_pct))]
        : [0, 0, 0]
    })
    return [
      m.profile ? fullName(m.profile) : 'Unknown',
      ...cells,
      mine.reduce((n, r) => n + r.tasks_held, 0),
      mine.reduce((n, r) => n + r.tasks_done, 0),
      mine.reduce((n, r) => n + r.tasks_late, 0),
    ]
  })

  return { headers, body }
}

/** The comparison table, as spreadsheet rows. */
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
    csvMoment(b.submitted_at),
    b.result_verdict ?? '',
  ])
  return { headers, body }
}

/** The term summary table, as spreadsheet rows. */
export function termSummaryCsv(classes: ClassReport[]) {
  const headers = [
    'Class',
    'Code',
    'Section',
    'Year level',
    'Semester',
    'School year',
    'Term started',
    'Term ended',
    'Archived',
    'Students',
    'Projects',
    'Boards',
    'Handed in',
    'Accepted',
    'Returned',
    'Weeks covered',
    'Weeks in syllabus',
    'Tasks',
    'Tasks finished',
    'Tasks late',
  ]
  const body = classes.map((c) => [
    `${c.class_initial} — ${c.class_name}`,
    c.code,
    c.section,
    c.year_level,
    c.semester,
    c.school_year,
    c.term_start ?? '',
    c.term_end ?? '',
    c.archived_at ? 'yes' : 'no',
    c.students,
    c.projects,
    c.boards,
    c.boards_submitted,
    c.boards_accepted,
    c.boards_returned,
    c.weeks_covered,
    c.weeks_total,
    c.tasks,
    c.tasks_done,
    c.tasks_late,
  ])
  return { headers, body }
}
