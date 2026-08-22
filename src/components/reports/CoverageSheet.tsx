import { Figures, ReportTable, Sheet, SheetSection } from './Sheet'
import { dayLabel, termLabel } from '../../lib/report'
import type { ClassReport, WeekCoverage } from '../../lib/report'

/**
 * The course-file sheet: what the syllabus asked for, week by week, and what
 * was actually set against it.
 *
 * Every week is listed, covered or not. A coverage report that showed only the
 * gaps would be a complaint rather than evidence, and evidence is what this is
 * filed as.
 */
export function CoverageSheet({
  cls,
  weeks,
  professor,
}: {
  cls: ClassReport
  weeks: WeekCoverage[]
  professor: string
}) {
  const assessed = weeks.filter((w) => w.assessments.trim() !== '')
  const gaps = assessed.filter((w) => w.project_count === 0)
  const covered = weeks.filter((w) => w.project_count > 0).length

  return (
    <Sheet
      title="Syllabus coverage"
      subject={`${cls.class_initial} — ${cls.class_name}`}
      meta={[
        `${cls.code} ${cls.section}`,
        `${cls.semester} semester · ${cls.school_year}`,
        termLabel(cls.term_start, cls.term_end),
      ]}
      professor={professor}
      footnote="Coverage means a project was set against that syllabus week. It does not measure what was taught in the room."
    >
      <Figures
        rows={[
          ['Weeks in the syllabus', weeks.length],
          ['Weeks with work set', covered],
          ['Weeks naming an assessment', assessed.length],
          ['Of those, with nothing set', gaps.length],
        ]}
      />

      <SheetSection title="Week by week">
        <ReportTable
          headers={['Wk', 'Dates', 'Title', 'Assessment named', 'Work set against it']}
          rows={weeks.map((w) => [
            `${w.week_no}`,
            w.week_start ? `${dayLabel(w.week_start)} – ${dayLabel(w.week_end)}` : '—',
            w.title,
            w.assessments || '—',
            w.project_titles || (w.assessments.trim() ? '— none —' : '—'),
          ])}
          empty="This class has no syllabus weeks yet."
        />
      </SheetSection>
    </Sheet>
  )
}
