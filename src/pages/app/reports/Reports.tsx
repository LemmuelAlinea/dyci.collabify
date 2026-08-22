import { BoardSheet } from '../../../components/reports/BoardSheet'
import { ClassRecordSheet, classRecordCsv } from '../../../components/reports/ClassRecordSheet'
import { ClassTermSheet } from '../../../components/reports/ClassTermSheet'
import { ComparisonSheet, comparisonCsv } from '../../../components/reports/ComparisonSheet'
import { ContributionSheet } from '../../../components/reports/ContributionSheet'
import { CoverageSheet } from '../../../components/reports/CoverageSheet'
import { TermSummarySheet, termSummaryCsv } from '../../../components/reports/TermSummarySheet'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import { downloadCsv, reportFilename, toCsv } from '../../../lib/report'
import { fullName } from '../../../lib/types'
import { NEEDS, useReports } from './useReports'
import type { ReportKind } from './useReports'

const CATALOGUE: {
  group: string
  items: { kind: ReportKind; label: string; body: string; csv?: boolean }[]
}[] = [
  {
    group: 'For the chair',
    items: [
      {
        kind: 'class_term',
        label: 'Class term report',
        body: 'One class on one page: enrolment, what was run, how much finished, what was late.',
      },
      {
        kind: 'term_summary',
        label: 'Term summary',
        body: 'Every class you teach in one table, with the totals underneath.',
        csv: true,
      },
    ],
  },
  {
    group: 'For grading',
    items: [
      {
        kind: 'contribution',
        label: 'Student contribution',
        body: 'One student: what they held on each board, what they finished, and their share.',
      },
      {
        kind: 'class_record',
        label: 'Class record',
        body: 'Every student against every project. The sheet you take into your own record.',
        csv: true,
      },
      {
        kind: 'comparison',
        label: 'Project comparison',
        body: 'One project, every group side by side. How the class did on that piece of work.',
        csv: true,
      },
      {
        kind: 'board',
        label: 'Group project report',
        body: 'One group: members, every task with who held it, what was handed in, your answer.',
      },
    ],
  },
  {
    group: 'For the course file',
    items: [
      {
        kind: 'coverage',
        label: 'Syllabus coverage',
        body: 'Week by week: what the syllabus asked for and what was set against it.',
      },
    ],
  },
]

/**
 * The half of the product that leaves it.
 *
 * Analytics is read on screen by the person who owns the class. A report is
 * printed and handed to somebody else — a chair, a course file, your own record
 * — so it prints on letterhead, carries the date it was made, and says in its
 * footer that it is not a grade record.
 *
 * Unlike every analytics view, these keep archived classes and projects. A
 * report is asked for after the term ends, which is exactly when analytics
 * stops answering.
 */
export default function Reports() {
  const { profile } = useAuth()
  const r = useReports(profile?.id)
  const professor = profile ? fullName(profile) : ''

  if (r.loading) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading your classes…
      </div>
    )
  }

  const csvFor = () => {
    if (!r.cls && r.kind !== 'term_summary') return null
    if (r.kind === 'class_record' && r.cls) {
      const { headers, body } = classRecordCsv(
        r.members,
        r.projects.map((p) => ({ id: p.id, title: p.title })),
        r.work,
      )
      return { name: reportFilename('class-record', r.cls.class_initial), headers, body }
    }
    if (r.kind === 'comparison' && r.cls) {
      const { headers, body } = comparisonCsv(r.boards)
      const title = r.projects.find((p) => p.id === r.projectId)?.title ?? 'project'
      return { name: reportFilename('project-comparison', title), headers, body }
    }
    if (r.kind === 'term_summary') {
      const { headers, body } = termSummaryCsv(r.classes)
      return { name: reportFilename('term-summary', professor), headers, body }
    }
    return null
  }

  const csv = csvFor()

  return (
    <div className="space-y-7">
      <header className="print:hidden">
        <p className="eyebrow">Teaching</p>
        <h1 className="mt-1 text-[30px] leading-tight">Reports</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          The record you hand to somebody else. Pick a report, choose what it is about, then
          print it — your browser's print dialog saves it as a PDF. Classes whose term has
          ended are still here; a report is usually asked for afterwards.
        </p>
      </header>

      {r.error && <Alert tone="error">{r.error}</Alert>}

      {r.classes.length === 0 ? (
        <EmptyState
          icon="file"
          title="No classes to report on"
          body="Create a class and run a project in it, and its reports appear here."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-5 print:hidden">
            <section className="space-y-4">
              {CATALOGUE.map((g) => (
                <div key={g.group} className="space-y-1.5">
                  <p className="eyebrow text-faint">{g.group}</p>
                  {g.items.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      onClick={() => r.choose(item.kind)}
                      className={`block w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                        r.kind === item.kind
                          ? 'border-navy-400 bg-navy-500/8'
                          : 'surface border-line hover:border-line-strong'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-[14px] text-ink">
                        {item.label}
                        {item.csv && (
                          <span className="rounded-full surface-sunken px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-muted uppercase">
                            csv
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                        {item.body}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <p className="eyebrow text-faint">What it is about</p>
              {NEEDS[r.kind].includes('class') && (
                <Select
                  aria-label="Class"
                  value={r.classId}
                  onChange={(e) => r.setClassId(e.target.value)}
                  options={r.classes.map((c) => ({
                    value: c.class_id,
                    label: `${c.class_initial} · ${c.class_name}${c.archived_at ? ' (ended)' : ''}`,
                  }))}
                  className="!h-10 !text-[13px]"
                />
              )}
              {NEEDS[r.kind].includes('project') && (
                <Select
                  aria-label="Project"
                  value={r.projectId}
                  onChange={(e) => r.setProjectId(e.target.value)}
                  placeholder="Pick a project"
                  options={r.projects.map((p) => ({ value: p.id, label: p.title }))}
                  className="!h-10 !text-[13px]"
                />
              )}
              {NEEDS[r.kind].includes('board') && (
                <Select
                  aria-label="Group"
                  value={r.boardId}
                  onChange={(e) => r.setBoardId(e.target.value)}
                  placeholder="Pick a group"
                  options={r.boards.map((b) => ({
                    value: b.id,
                    label: b.group_name ?? b.student_name ?? 'A board',
                  }))}
                  className="!h-10 !text-[13px]"
                />
              )}
              {NEEDS[r.kind].includes('student') && (
                <Select
                  aria-label="Student"
                  value={r.studentId}
                  onChange={(e) => r.setStudentId(e.target.value)}
                  placeholder="Pick a student"
                  options={r.students}
                  className="!h-10 !text-[13px]"
                />
              )}
              {NEEDS[r.kind].length === 0 && (
                <p className="text-[12.5px] text-muted">
                  This one covers every class you teach, so there is nothing to choose.
                </p>
              )}
            </section>

            <section className="flex flex-wrap gap-2">
              <Button size="sm" className="!rounded-xl" disabled={!r.ready} onClick={() => window.print()}>
                <Icon name="file" size={14} />
                Print
              </Button>
              {csv && (
                <Button
                  size="sm"
                  variant="outline"
                  className="!rounded-xl"
                  disabled={!r.ready}
                  onClick={() => downloadCsv(csv.name, toCsv(csv.headers, csv.body))}
                >
                  <Icon name="download" size={14} />
                  Download CSV
                </Button>
              )}
            </section>
          </div>

          <div className="min-w-0">
            {r.busy && (
              <p className="mb-3 flex items-center gap-2 text-[13px] text-muted print:hidden">
                <Spinner size={14} />
                Gathering it…
              </p>
            )}
            {!r.ready ? (
              <EmptyState
                icon="file"
                title="Choose what the report is about"
                body="Pick the class, and the project, group or student the report should cover."
              />
            ) : (
              <Preview r={r} professor={professor} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Preview({
  r,
  professor,
}: {
  r: ReturnType<typeof useReports>
  professor: string
}) {
  const cls = r.cls

  switch (r.kind) {
    case 'term_summary':
      return <TermSummarySheet classes={r.classes} professor={professor} />
    case 'class_term':
      return cls ? <ClassTermSheet cls={cls} weeks={r.weeks} professor={professor} /> : null
    case 'coverage':
      return cls ? <CoverageSheet cls={cls} weeks={r.weeks} professor={professor} /> : null
    case 'class_record':
      return cls ? (
        <ClassRecordSheet
          cls={cls}
          members={r.members}
          projects={r.projects.map((p) => ({ id: p.id, title: p.title }))}
          rows={r.work}
          professor={professor}
        />
      ) : null
    case 'comparison':
      return cls ? (
        <ComparisonSheet
          cls={cls}
          boards={r.boards}
          projectTitle={r.projects.find((p) => p.id === r.projectId)?.title ?? ''}
          professor={professor}
        />
      ) : null
    case 'contribution':
      return cls ? (
        <ContributionSheet
          cls={cls}
          rows={r.work.filter((w) => w.student_id === r.studentId)}
          reassignments={r.reassignments.filter(
            (x) => x.requested_by === r.studentId || x.from_student === r.studentId ||
              x.to_student === r.studentId,
          )}
          professor={professor}
        />
      ) : null
    case 'board':
      return cls && r.board ? (
        <BoardSheet
          cls={cls}
          board={r.board}
          tasks={r.tasks}
          members={r.work.filter((w) => w.board_id === r.boardId)}
          feedback={r.feedback}
          professor={professor}
        />
      ) : null
  }
}
