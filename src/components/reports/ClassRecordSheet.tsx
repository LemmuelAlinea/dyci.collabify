import { ReportTable, Sheet, SheetSection } from './Sheet'
import { pct } from '../../lib/report'
import type { ClassReport, StudentWork } from '../../lib/report'
import { fullName } from '../../lib/types'
import type { ClassMember } from '../../lib/types'

/**
 * Every student in the class against every project: what they held, what they
 * finished, and how much of the board it was.
 *
 * The one report that is really a spreadsheet, and the reason CSV exists here.
 * Collabify holds no grades, so this is the sheet a professor takes into
 * whatever record actually carries the marks.
 *
 * Students on no board at all still get a row. They are the ones this is most
 * useful for, and leaving them out would quietly make the class look complete.
 */
export function ClassRecordSheet({
  cls,
  members,
  projects,
  rows,
  professor,
}: {
  cls: ClassReport
  members: ClassMember[]
  projects: { id: string; title: string }[]
  rows: StudentWork[]
  professor: string
}) {
  const byStudent = new Map<string, StudentWork[]>()
  for (const r of rows) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) ?? []), r])

  return (
    <Sheet
      title="Class record"
      subject={`${cls.class_initial} — ${cls.class_name}`}
      meta={[
        `${cls.code} ${cls.section}`,
        `${cls.semester} semester · ${cls.school_year}`,
        `${members.length} students · ${projects.length} projects`,
      ]}
      professor={professor}
      footnote="Each cell is finished / held on that project, with the share of the board beside it. No cell is a mark."
    >
      <SheetSection title="Finished / held, by project">
        <ReportTable
          headers={['Student', ...projects.map((p) => p.title), 'Held', 'Finished', 'Late']}
          align={projects.map((_, i) => i + 1).concat([
            projects.length + 1,
            projects.length + 2,
            projects.length + 3,
          ])}
          rows={members.map((m) => {
            const mine = byStudent.get(m.student_id) ?? []
            const cells = projects.map((p) => {
              const row = mine.find((r) => r.project_id === p.id)
              if (!row || row.tasks_held === 0) return '—'
              return `${row.tasks_done}/${row.tasks_held} · ${pct(row.held_pct)}`
            })
            return [
              m.profile ? fullName(m.profile) : 'Unknown',
              ...cells,
              mine.reduce((n, r) => n + r.tasks_held, 0),
              mine.reduce((n, r) => n + r.tasks_done, 0),
              mine.reduce((n, r) => n + r.tasks_late, 0),
            ]
          })}
          empty="Nobody is enrolled in this class."
        />
      </SheetSection>
    </Sheet>
  )
}

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
