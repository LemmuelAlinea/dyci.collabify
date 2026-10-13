import { useEffect } from 'react'
import { BoardSheet } from '../../../components/reports/BoardSheet'
import { ClassRecordSheet } from '../../../components/reports/ClassRecordSheet'
import { classRecordCsv, comparisonCsv, termSummaryCsv } from '../../../components/reports/csv'
import { ClassTermSheet } from '../../../components/reports/ClassTermSheet'
import { ComparisonSheet } from '../../../components/reports/ComparisonSheet'
import { ContributionSheet } from '../../../components/reports/ContributionSheet'
import { CoverageSheet } from '../../../components/reports/CoverageSheet'
import { ReportDocView } from '../../../components/reports/ReportDocView'
import { ReportBar, ReportSidebar } from '../../../components/reports/ReportPicker'
import type { ReportGroup } from '../../../components/reports/ReportPicker'
import { TermSummarySheet } from '../../../components/reports/TermSummarySheet'
import type { ActionMenuItem } from '../../../components/ui/ActionMenu'
import { Alert } from '../../../components/ui/Alert'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Toggle } from '../../../components/ui/Field'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { downloadCsv, reportFilename, toCsv } from '../../../lib/report'
import type { ReportDoc } from '../../../lib/reports/doc'
import { docCsvFiles, exportCsv, exportDocx, exportXlsx, reportBase } from '../../../lib/reports/export'
import { defaultRound } from '../../../lib/reports/peerSummary'
import { fullName } from '../../../lib/types'
import { useReportDoc } from './useReportDoc'
import { useReports } from './useReports'

const CATALOGUE: ReportGroup[] = [
  {
    group: 'For grading',
    items: [
      {
        kind: 'grading',
        label: 'Individual grading sheet',
        body: 'Rubric scores, the teamwork adjustment and contribution for every student, a grade book across projects, or one student in full.',
      },
      {
        kind: 'peer',
        label: 'Peer evaluation summary',
        body: 'How each group rated its members on the five behaviours, the response rate and the flags worth a conversation.',
      },
    ],
  },
  {
    group: 'Older reports',
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
      {
        kind: 'coverage',
        label: 'Syllabus coverage',
        body: 'Week by week: what the syllabus asked for and what was set against it.',
      },
    ],
  },
]

const DAY = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** The ways out of a new-style report: a workbook, a Word file and one CSV per table. */
function exportItems(doc: ReportDoc, kind: string, fail: (message: string) => void): ActionMenuItem[] {
  const base = reportBase(kind, doc.header.subtitle)
  return [
    {
      label: 'Excel (.xlsx)',
      icon: 'download',
      onSelect: () => void exportXlsx(doc, base).catch(() => fail('Could not make the Excel file. Try again.')),
    },
    {
      label: 'Word (.docx)',
      icon: 'download',
      onSelect: () => void exportDocx(doc, base).catch(() => fail('Could not make the Word file. Try again.')),
    },
    ...docCsvFiles(doc, base).map((f) => ({
      label: `CSV: ${f.label}`,
      icon: 'download' as const,
      onSelect: () => exportCsv(f),
    })),
  ]
}

/**
 * The half of the product that leaves it.
 *
 * Analytics is read on screen by the person who owns the class. A report is
 * printed and handed to somebody else — a chair, a course file, your own record
 * — so it prints on letterhead and carries the date it was made. The older
 * reports say in their footer that they are not a grade record; the grading
 * sheet and the peer summary replace that footer with their own lines and a
 * Prepared by signature.
 *
 * Unlike every analytics view, these keep archived classes and projects. A
 * report is asked for after the term ends, which is exactly when analytics
 * stops answering.
 */
export default function Reports({ classId }: { classId?: string }) {
  const { profile } = useAuth()
  const { show } = useToast()
  const r = useReports(profile?.id, classId)
  const professor = profile ? fullName(profile) : ''
  const d = useReportDoc(r, professor)

  useEffect(() => {
    if (!classId) document.title = 'Reports · Collabify'
  }, [classId])

  if (r.loading) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading your classes…
      </div>
    )
  }

  // Inside one class, the cross-class term summary doesn't apply.
  const catalogue = classId
    ? CATALOGUE.map((g) => ({ ...g, items: g.items.filter((i) => i.kind !== 'term_summary') })).filter(
        (g) => g.items.length > 0,
      )
    : CATALOGUE

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

  // The new reports export through a menu; the older ones keep their one CSV button.
  const newKind = r.kind === 'grading' || r.kind === 'peer'
  // A new report prints only once its document is built for these choices, as it exports.
  const printReady = newKind ? Boolean(d.doc && d.current) : r.ready
  const exports: ActionMenuItem[] | undefined = !newKind
    ? undefined
    : d.doc && d.current
      ? exportItems(d.doc, r.kind === 'grading' ? 'grading-sheet' : 'peer-summary', (m) => show(m, 'error'))
      : [{ label: 'Nothing to export yet', onSelect: () => {}, disabled: true }]

  // What each new report adds beside the pickers. The older ones add nothing.
  const picker = {
    ...r,
    projectOptions:
      r.kind === 'grading'
        ? [
            { value: 'all', label: 'All projects (grade book)' },
            ...r.projects.map((p) => ({ value: p.id, label: p.title })),
          ]
        : r.kind === 'peer'
          ? r.projects.filter((p) => p.audience === 'group').map((p) => ({ value: p.id, label: p.title }))
          : undefined,
    studentOptional: r.kind === 'grading',
    extras:
      r.kind === 'peer' ? (
        <div className="space-y-3">
          {d.rounds.length > 0 && (
            <Select
              aria-label="Round"
              value={d.rounds.some((x) => x.id === r.roundId) ? r.roundId : (defaultRound(d.rounds)?.id ?? '')}
              onChange={(e) => r.setRoundId(e.target.value)}
              options={d.rounds.map((x) => ({
                value: x.id,
                label: `${x.kind === 'final' ? 'Final' : 'Check-in'} · ${DAY.format(new Date(x.opens_at))}`,
              }))}
              className="!h-11 !text-[13px] sm:!h-10 sm:!text-[13px]"
            />
          )}
          <div className="flex items-center justify-between gap-3 px-1 text-[13px] text-ink">
            <span>Include written comments</span>
            <Toggle checked={r.comments} onChange={r.setComments} label="Include written comments" />
          </div>
        </div>
      ) : undefined,
  }

  return (
    <div className="w-full space-y-7">
      {!classId && (
        <div className="print:hidden">
          <DirectoryHero
            title="Records ready"
            accent="to share."
            description="Choose a report, set its scope and produce a clear printable record for grading, review or the course file."
          />
        </div>
      )}

      {r.error && <Alert tone="error">{r.error}</Alert>}

      {r.classes.length === 0 ? (
        <EmptyState
          icon="file"
          title="No classes to report on"
          body="Create a class and run a project in it, and its reports appear here."
        />
      ) : (
        <div className="@container">
        <div className="grid gap-5 @min-[860px]:grid-cols-[300px_minmax(0,1fr)] @min-[860px]:gap-6">
          <ReportBar
            catalogue={catalogue}
            r={picker}
            csv={Boolean(csv)}
            exports={exports}
            printReady={printReady}
            onCsv={() => csv && downloadCsv(csv.name, toCsv(csv.headers, csv.body))}
          />
          <ReportSidebar
            catalogue={catalogue}
            r={picker}
            csv={Boolean(csv)}
            exports={exports}
            printReady={printReady}
            onCsv={() => csv && downloadCsv(csv.name, toCsv(csv.headers, csv.body))}
          />

          {/* On a wide screen the sheet sits on a ground rather than filling
              the column. Two reasons, and neither is decoration: the page has
              no width cap of its own, so on a large monitor a class record was
              stretching a printed table to two thousand pixels; and a document
              somebody is about to print reads as one when it looks like paper
              on a desk instead of another panel in the app. All of it is
              screen-only — printing strips the ground, the padding and the
              cap, so the sheet itself is unchanged on paper. */}
          <div className="min-w-0 @min-[860px]:rounded-card @min-[860px]:bg-[var(--surface-sunken)] @min-[860px]:p-6 print:!bg-transparent print:!p-0">
            <div className="mx-auto w-full @min-[860px]:max-w-[900px] print:!max-w-none">
            {(r.busy || r.settling) && (
              <p className="mb-3 flex items-center gap-2 text-[13px] text-muted print:hidden">
                <Spinner size={14} />
                Gathering it…
              </p>
            )}
            {!r.ready ? (
              r.settling ? null : (
                <EmptyState
                  icon="file"
                  title="Choose what the report is about"
                  body="Pick the class, and the project, group or student the report should cover."
                />
              )
            ) : (
              <Preview r={r} d={d} professor={professor} />
            )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}

function Preview({
  r,
  d,
  professor,
}: {
  r: ReturnType<typeof useReports>
  d: ReturnType<typeof useReportDoc>
  professor: string
}) {
  const cls = r.cls

  switch (r.kind) {
    case 'grading':
    case 'peer':
      // A document built for other choices never stands in for these ones.
      if (!d.current || (!d.doc && d.loading)) {
        return (
          <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
            <Spinner size={14} />
            Building the report…
          </p>
        )
      }
      if (d.error) {
        return (
          <Alert tone="error" onRetry={d.retry}>
            {d.error}
          </Alert>
        )
      }
      // A refresh behind a sheet someone is reading leaves the sheet where it
      // is, and so does a refresh that fails.
      if (d.doc) {
        return (
          <>
            {/* The page's own "Gathering it…" already says so while the class reloads. */}
            {d.loading && !r.busy && !r.settling && (
              <p className="mb-3 flex items-center gap-2 text-[13px] text-muted print:hidden">
                <Spinner size={14} />
                Updating…
              </p>
            )}
            {d.refreshError && !d.loading && (
              <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted print:hidden">
                Could not refresh. Showing the last version.
                <button type="button" onClick={d.retry} className="text-ink underline underline-offset-2">
                  Try again
                </button>
              </p>
            )}
            <ReportDocView doc={d.doc} />
          </>
        )
      }
      if (r.kind === 'peer') {
        return (
          <EmptyState
            icon="file"
            title="No peer evaluation on this project yet"
            body="Open a round from the project's Work tab, and its results appear here."
          />
        )
      }
      return null
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
