import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { dayLabel } from '../../lib/report'
import type { ClassReport } from '../../lib/report'

/**
 * Every class at once: the faculty-load attachment.
 *
 * Archived classes are listed with the term they belonged to rather than
 * dropped, because a load report covers what was taught, not what is still
 * running.
 */
export function TermSummarySheet({
  classes,
  professor,
}: {
  classes: ClassReport[]
  professor: string
}) {
  const total = classes.reduce(
    (a, c) => ({
      students: a.students + c.students,
      projects: a.projects + c.projects,
      tasks: a.tasks + c.tasks,
      done: a.done + c.tasks_done,
      late: a.late + c.tasks_late,
    }),
    { students: 0, projects: 0, tasks: 0, done: 0, late: 0 },
  )

  return (
    <Sheet
      title="Term summary"
      subject={professor}
      meta={[
        `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}`,
        `${classes.filter((c) => c.archived_at).length} of them ended`,
      ]}
      professor={professor}
    >
      <Figures
        rows={[
          ['Students taught', total.students],
          ['Projects run', total.projects],
          ['Tasks set', total.tasks],
          ['Tasks finished', total.done],
        ]}
      />

      <SheetSection title="Class by class">
        <ReportTable
          headers={[
            'Class',
            'Section',
            'Term',
            'Students',
            'Projects',
            'Syllabus',
            'Finished',
            'Late',
          ]}
          align={[3, 4, 5, 6, 7]}
          rows={classes.map((c) => [
            `${c.class_initial} — ${c.class_name}`,
            c.section,
            c.archived_at ? `Ended ${dayLabel(c.archived_at)}` : `${c.semester} · ${c.school_year}`,
            c.students,
            c.projects,
            `${c.weeks_covered}/${c.weeks_total}`,
            `${c.tasks_done}/${c.tasks}`,
            c.tasks_late,
          ])}
          empty="You have no classes."
        />
      </SheetSection>

      {total.late > 0 && (
        <p className="text-[12px] text-muted">
          {total.late} {total.late === 1 ? 'task was' : 'tasks were'} finished after their
          deadline across every class.
        </p>
      )}
    </Sheet>
  )
}

/** The same table, as spreadsheet rows. */
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
