import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { dayLabel, termLabel } from '../../lib/report'
import type { ClassReport, WeekCoverage } from '../../lib/report'

/**
 * One class, one page: what was run in it and how much of it finished.
 *
 * The sheet a chair is handed at the end of term. It answers the three
 * questions they actually ask — was the syllabus covered, did the work get
 * done, and was any of it late — and nothing else.
 */
export function ClassTermSheet({
  cls,
  weeks,
  professor,
}: {
  cls: ClassReport
  weeks: WeekCoverage[]
  professor: string
}) {
  const gaps = weeks.filter((w) => w.project_count === 0 && w.assessments.trim() !== '')
  const finished = cls.tasks === 0 ? 0 : Math.round((cls.tasks_done / cls.tasks) * 100)

  return (
    <Sheet
      title="Class term report"
      subject={`${cls.class_initial} — ${cls.class_name}`}
      meta={[
        `${cls.code} ${cls.section}`,
        `${cls.year_level} year · ${cls.semester} semester · ${cls.school_year}`,
        termLabel(cls.term_start, cls.term_end),
        cls.archived_at ? `Term ended ${dayLabel(cls.archived_at)}` : 'Term running',
      ]}
      professor={professor}
    >
      <Figures
        rows={[
          ['Students enrolled', cls.students],
          ['Projects run', cls.projects],
          ['Syllabus weeks covered', `${cls.weeks_covered}/${cls.weeks_total}`],
          ['Work finished', `${finished}%`],
        ]}
      />

      <SheetSection title="How the work ended">
        <ReportTable
          headers={['', 'Count']}
          align={[1]}
          rows={[
            ['Boards in the class', cls.boards],
            ['Handed in', cls.boards_submitted],
            ['Accepted', cls.boards_accepted],
            ['Returned to be fixed', cls.boards_returned],
            ['Tasks set', cls.tasks],
            ['Tasks finished', cls.tasks_done],
            ['Finished after the deadline', cls.tasks_late],
            ['Never claimed by anybody', cls.tasks_unclaimed],
          ]}
        />
      </SheetSection>

      <SheetSection title="Syllabus weeks with nothing set against them">
        <ReportTable
          headers={['Week', 'Title', 'What the syllabus asked for']}
          rows={gaps.map((w) => [`${w.week_no}`, w.title, w.assessments])}
          empty="Every week naming an assessment had a project against it."
        />
      </SheetSection>

      {cls.students_removed > 0 && (
        <p className="text-[12px] text-muted">
          {cls.students_removed}{' '}
          {cls.students_removed === 1 ? 'student was' : 'students were'} removed from the class
          during the term and {cls.students_removed === 1 ? 'is' : 'are'} not counted above.
        </p>
      )}
    </Sheet>
  )
}
