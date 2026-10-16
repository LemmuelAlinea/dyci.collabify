import { useEffect } from 'react'
import { ReportDocView } from '../../../components/reports/ReportDocView'
import { ReportBar, ReportSidebar } from '../../../components/reports/ReportPicker'
import type { ReportGroup } from '../../../components/reports/ReportPicker'
import type { ActionMenuItem } from '../../../components/ui/ActionMenu'
import { Alert } from '../../../components/ui/Alert'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { Input, Toggle } from '../../../components/ui/Field'
import { Select } from '../../../components/ui/Select'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../context/AuthContext'
import { NOTE_KIND_META } from '../../../lib/notes'
import { EVENT_META } from '../../../lib/reports/activityLog'
import { countableBoard } from '../../../lib/reports/deliverables'
import type { ReportDoc } from '../../../lib/reports/doc'
import { docCsvFiles, exportCsv, exportDocx, exportXlsx, reportBase } from '../../../lib/reports/export'
import { defaultRound } from '../../../lib/reports/peerSummary'
import { DUE_CHOICES, RANGE_CHOICES } from '../../../lib/reports/range'
import type { DueChoice, RangeChoice } from '../../../lib/reports/range'
import { fullName } from '../../../lib/types'
import type { ClassNoteKind, TaskEventKind } from '../../../lib/types'
import type { ReportKind } from './reportKind'
import { useReportDoc } from './useReportDoc'
import { useReports } from './useReports'
import type { NoteStatus } from './useReports'

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
    group: 'For check-ins',
    items: [
      {
        kind: 'checkin',
        label: 'Weekly class check-in',
        body: 'What moved this week against the week before, what is stuck, what falls due next, and what needs you.',
      },
      {
        kind: 'notes',
        label: 'Intervention log',
        body: 'Every note, meeting, follow-up and reminder in a date range, with who wrote it. The record that you acted.',
      },
    ],
  },
  {
    group: 'For tracking projects',
    items: [
      {
        kind: 'progress',
        label: 'Group progress report',
        body: 'One group, or every group, on a project: how far along, who did the work, milestones, sprints and every answer you gave.',
      },
      {
        kind: 'deliverables',
        label: 'Deliverables & milestone compliance',
        body: 'Every milestone and hand-in, group by group: on time, late, missing or not due yet.',
      },
    ],
  },
  {
    group: 'For the record',
    items: [
      {
        kind: 'formal',
        label: 'Formal term record',
        body: 'The term on one record for the course file or accreditation: enrolment, projects, hand-ins, syllabus coverage and interventions, with signature lines.',
      },
      {
        kind: 'activity',
        label: 'Activity log',
        body: 'Every change to every task in a date range: who did what, and when. The record for settling a dispute.',
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

/** The name each report's files start with. */
const EXPORT_BASE: Record<ReportKind, string> = {
  grading: 'grading-sheet',
  peer: 'peer-summary',
  checkin: 'weekly-check-in',
  notes: 'intervention-log',
  progress: 'group-progress',
  deliverables: 'deliverables',
  formal: 'term-record',
  activity: 'activity-log',
}

/** The ways out of a report: a workbook, a Word file and one CSV per table. */
function exportItems(doc: ReportDoc, kind: string, fail: (message: string) => void): ActionMenuItem[] {
  // The class is in the name, so two sections' sheets for the same dates never share one.
  const base = reportBase(kind, doc.header.subtitle, doc.header.classLine)
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
 * — so it prints on letterhead and carries the date it was made.
 * Every report ends with its own footer lines and a Prepared by signature.
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

  const catalogue = CATALOGUE

  const printReady = Boolean(d.doc && d.current)
  const exports: ActionMenuItem[] =
    d.doc && d.current
      ? exportItems(d.doc, EXPORT_BASE[r.kind] ?? '', (m) => show(m, 'error'))
      : [{ label: 'Nothing to export yet', onSelect: () => {}, disabled: true }]

  // What each report adds beside the pickers.
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
          : r.kind === 'deliverables'
            ? [{ value: 'all', label: 'All projects' }, ...r.projects.map((p) => ({ value: p.id, label: p.title }))]
            : undefined,
    // Every class is offered only on the term record, and never inside one class.
    classOptions:
      r.kind === 'formal' && !classId
        ? [
            { value: 'all', label: 'Every class' },
            ...r.classes.map((c) => ({
              value: c.class_id,
              label: `${c.class_initial} · ${c.class_name}${c.archived_at ? ' (ended)' : ''}`,
            })),
          ]
        : undefined,
    classValue: r.allClasses ? 'all' : undefined,
    studentOptional: r.kind === 'grading' || r.kind === 'notes',
    extras:
      r.kind === 'activity' ? (
        <ActivityExtras r={r} />
      ) : r.kind === 'checkin' || r.kind === 'notes' ? (
        <CheckInExtras r={r} />
      ) : r.kind === 'progress' ? (
        <ProgressExtras r={r} />
      ) : r.kind === 'deliverables' ? (
        <DeliverablesExtras r={r} />
      ) : r.kind === 'peer' ? (
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
            exports={exports}
            printReady={printReady}
          />
          <ReportSidebar
            catalogue={catalogue}
            r={picker}
            exports={exports}
            printReady={printReady}
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
              <Preview r={r} d={d} />
            )}
            </div>
          </div>
        </div>
        </div>
      )}
    </div>
  )
}

const FIELD_SIZE = '!h-11 !text-[13px] sm:!h-10 sm:!text-[13px]'

/** A preset range, or two dates. Until both dates are set the range reads as the last 7 days. */
function RangeFields({ r, choices }: { r: ReturnType<typeof useReports>; choices: { value: RangeChoice; label: string }[] }) {
  return (
    <>
      <Select
        aria-label="Dates"
        value={r.rangeChoice}
        onChange={(e) => r.setRangeChoice(e.target.value as RangeChoice)}
        options={choices}
        className={FIELD_SIZE}
      />
      {r.rangeChoice === 'custom' && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">From</span>
              <Input
                type="date"
                value={r.customFrom}
                onChange={(e) => r.setCustomRange(e.target.value, r.customTo)}
                className={FIELD_SIZE}
              />
            </label>
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">To</span>
              <Input
                type="date"
                value={r.customTo}
                onChange={(e) => r.setCustomRange(r.customFrom, e.target.value)}
                className={FIELD_SIZE}
              />
            </label>
          </div>
          {(!r.customFrom || !r.customTo) && (
            <p className="px-1 text-[12px] text-muted">Set both dates. Until then the report covers the last 7 days.</p>
          )}
        </div>
      )}
    </>
  )
}

/** Pill checkboxes for narrowing by kind. None picked means every kind. */
function ChipToggles<K extends string>({
  legend,
  options,
  chosen,
  onChange,
}: {
  legend: string
  options: { value: K; label: string }[]
  chosen: K[]
  onChange: (next: K[]) => void
}) {
  const toggle = (k: K) =>
    onChange(options.map((o) => o.value).filter((x) => (x === k ? !chosen.includes(x) : chosen.includes(x))))
  return (
    <fieldset className="space-y-1.5">
      <legend className="px-1 pb-1 text-[12px] text-muted">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label
            key={o.value}
            className="surface inline-flex min-h-9 cursor-pointer items-center rounded-full border border-line px-3 text-[13px] text-ink transition-colors hover:border-line-strong has-[:checked]:border-navy-400 has-[:checked]:bg-navy-500/8 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-navy-500/12"
          >
            <input type="checkbox" className="sr-only" checked={chosen.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The activity log's dates and filters: project, group, who acted, and kinds of event. */
function ActivityExtras({ r }: { r: ReturnType<typeof useReports> }) {
  const projectChosen = r.projects.some((p) => p.id === r.projectId)
  const groups = r.allBoards
    .filter((b) => !projectChosen || b.project_id === r.projectId)
    .map((b) => {
      const name = b.group_name ?? b.student_name ?? 'A board'
      return { value: b.id, label: projectChosen ? name : `${name} · ${b.project_title}` }
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  return (
    <div className="space-y-3">
      <RangeFields r={r} choices={RANGE_CHOICES} />
      <Select
        aria-label="Project"
        value={projectChosen ? r.projectId : ''}
        onChange={(e) => r.setActivityProject(e.target.value)}
        options={[{ value: '', label: 'All projects' }, ...r.projects.map((p) => ({ value: p.id, label: p.title }))]}
        className={FIELD_SIZE}
      />
      <Select
        aria-label="Group"
        value={groups.some((g) => g.value === r.boardId) ? r.boardId : ''}
        onChange={(e) => r.setBoardId(e.target.value)}
        options={[{ value: '', label: 'Every group' }, ...groups]}
        className={FIELD_SIZE}
      />
      <Select
        aria-label="Who"
        value={r.students.some((s) => s.value === r.studentId) ? r.studentId : ''}
        onChange={(e) => r.setStudentId(e.target.value)}
        options={[{ value: '', label: 'Everyone' }, ...r.students]}
        className={FIELD_SIZE}
      />
      <ChipToggles
        legend="Events. None picked shows every kind."
        options={(Object.entries(EVENT_META) as [TaskEventKind, { label: string }][]).map(([value, m]) => ({ value, label: m.label }))}
        chosen={r.eventKinds}
        onChange={r.setEventKinds}
      />
    </div>
  )
}

/** What the check-in and the intervention log add under the pickers: dates, and for the log its filters. */
function CheckInExtras({ r }: { r: ReturnType<typeof useReports> }) {
  const log = r.kind === 'notes'
  // The check-in compares one week with the one before, so it has no 30-day window.
  const choices = RANGE_CHOICES.filter((c) => log || c.value !== 'last30')
  const groups = r.allBoards
    .map((b) => ({ value: b.id, label: `${b.group_name ?? b.student_name ?? 'A board'} · ${b.project_title}` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="space-y-3">
      <RangeFields r={r} choices={choices} />
      {log && (
        <>
          <ChipToggles
            legend="Kinds. None picked shows every kind."
            options={(Object.entries(NOTE_KIND_META) as [ClassNoteKind, { label: string }][]).map(([value, m]) => ({ value, label: m.label }))}
            chosen={r.noteKinds}
            onChange={r.setNoteKinds}
          />
          <Select
            aria-label="Status"
            value={r.noteStatus}
            onChange={(e) => r.setNoteStatus(e.target.value as NoteStatus)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
            ]}
            className={FIELD_SIZE}
          />
          <Select
            aria-label="Group"
            value={r.boardId}
            onChange={(e) => r.setBoardId(e.target.value)}
            options={[{ value: '', label: 'Every group' }, ...groups]}
            className={FIELD_SIZE}
          />
        </>
      )}
    </div>
  )
}

/** Group progress covers every group on the project unless one is picked. */
function ProgressExtras({ r }: { r: ReturnType<typeof useReports> }) {
  const individual = r.projects.find((p) => p.id === r.projectId)?.audience === 'individual'
  // r.boards is every board in the class until a project is picked, so the options come from the project's own.
  // A group with nobody in it, or a student who has left the class, is left out of the report and of this list.
  const active = new Set(r.members.filter((m) => m.status === 'active').map((m) => m.student_id))
  const options = r.projects.some((p) => p.id === r.projectId)
    ? r.boards
        .filter((b) => b.project_id === r.projectId && countableBoard(b, active))
        .map((b) => ({ value: b.id, label: b.group_name ?? b.student_name ?? 'A board' }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    : []
  return (
    <Select
      aria-label={individual ? 'Student' : 'Group'}
      // A group left in the address from another project, or one left out, reads as every group.
      value={options.some((o) => o.value === r.boardId) ? r.boardId : ''}
      onChange={(e) => r.setBoardId(e.target.value)}
      options={[{ value: '', label: individual ? 'Every student' : 'Every group' }, ...options]}
      className={FIELD_SIZE}
    />
  )
}

/** The compliance report covers the deliverables falling due in these dates. */
function DeliverablesExtras({ r }: { r: ReturnType<typeof useReports> }) {
  return (
    <div className="space-y-3">
      <Select
        aria-label="Dates"
        value={r.dueChoice}
        onChange={(e) => r.setDueChoice(e.target.value as DueChoice)}
        options={DUE_CHOICES}
        className={FIELD_SIZE}
      />
      {r.dueChoice === 'custom' && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">From</span>
              <Input
                type="date"
                value={r.customFrom}
                onChange={(e) => r.setCustomRange(e.target.value, r.customTo)}
                className={FIELD_SIZE}
              />
            </label>
            <label className="block space-y-1 text-[12px] text-muted">
              <span className="block px-1">To</span>
              <Input
                type="date"
                value={r.customTo}
                onChange={(e) => r.setCustomRange(r.customFrom, e.target.value)}
                className={FIELD_SIZE}
              />
            </label>
          </div>
          {(!r.customFrom || !r.customTo) && (
            <p className="px-1 text-[12px] text-muted">Set both dates. Until then every date is shown.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Preview({
  r,
  d,
}: {
  r: ReturnType<typeof useReports>
  d: ReturnType<typeof useReportDoc>
}) {
  switch (r.kind) {
    case 'grading':
    case 'peer':
    case 'checkin':
    case 'notes':
    case 'progress':
    case 'deliverables':
    case 'formal':
    case 'activity':
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
            {/* The line's height is kept whether or not it shows, so the sheet does not jump when it does. */}
            {/* Not a live region: a live class would announce it every few seconds. */}
            <div className="mb-3 min-h-5 print:hidden">
              {d.loading && !r.busy && !r.settling && (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Spinner size={14} />
                  Updating…
                </p>
              )}
            </div>
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
  }
}
