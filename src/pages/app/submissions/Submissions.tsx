import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/ui/EmptyState'
import { FilterField, FilterPopover, FilterSearch } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { useLive } from '../../../hooks/useLive'
import { listProfessorClasses } from '../../../lib/api/classes'
import { listProjectsForClasses } from '../../../lib/api/projects'
import { listHandedInBoards } from '../../../lib/api/results'
import { authErrorMessage } from '../../../lib/authError'
import {
  EMPTY_SUBMISSION_FILTERS,
  SUBMISSION_STATUSES,
  applySubmissionFilters,
  countByStatus,
  narrowSubmissions,
  sectionByClass,
  submittedProjects,
  toSubmissions,
} from '../../../lib/submissions'
import type {
  Submission,
  SubmissionFilters,
  SubmissionOrder,
  SubmissionStatus,
  SubmissionTiming,
} from '../../../lib/submissions'
import { boardOwnerName } from '../../../lib/types'
import type { ClassSummary } from '../../../lib/types'

const TIMING_OPTIONS = [
  { value: 'on_time', label: 'By the deadline' },
  { value: 'late', label: 'After the deadline' },
]

const ORDER_OPTIONS = [
  { value: 'newest', label: 'Most recent first' },
  { value: 'oldest', label: 'Oldest first' },
]

const TONE: Record<SubmissionStatus, string> = {
  waiting: 'bg-amber-400/18 text-amber-700 dark:text-amber-300',
  accepted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  returned: 'bg-navy-500/10 text-navy-700 dark:text-navy-200',
}

function stamp(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Everything handed in, across every class the professor teaches.
 *
 * The project page answers "how is this project going"; this page answers
 * "what has come in", which is otherwise a walk through every project of every
 * class. Sectioned by class because that is how a professor's week is divided,
 * with the project named on every row so two projects in one class never blur.
 *
 * Answering still happens on the project, where the board and its verdict
 * panel are. Every row opens straight onto that group's board.
 *
 * Archived classes and archived projects are left out: archiving is how a
 * professor says they are finished with something.
 */
export default function Submissions() {
  const { profile } = useAuth()
  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [rows, setRows] = useState<Submission[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<SubmissionFilters>(EMPTY_SUBMISSION_FILTERS)

  useEffect(() => {
    document.title = 'Submissions · Collabify'
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      const found = await listProfessorClasses(profile.id)
      const projects = await listProjectsForClasses(found.map((c) => c.id))
      const boards = await listHandedInBoards(
        projects.filter((p) => !p.archived_at).map((p) => p.id),
      )
      setClasses(found)
      setRows(toSubmissions(boards, found))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load what was handed in.'))
      setClasses((c) => c ?? [])
      setRows((r) => r ?? [])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['project_boards', 'board_results', 'projects', 'classes'])

  const set = (patch: Partial<SubmissionFilters>) => setFilters((f) => ({ ...f, ...patch }))

  const all = useMemo(() => rows ?? [], [rows])
  const allCounts = useMemo(() => countByStatus(all), [all])
  // The status tabs count what the other filters leave, so a number never
  // promises rows that clicking it will not show.
  const counts = useMemo(() => countByStatus(narrowSubmissions(all, filters)), [all, filters])
  const shown = useMemo(() => applySubmissionFilters(all, filters), [all, filters])
  const sections = useMemo(
    () => sectionByClass(shown, (classes ?? []).map((c) => c.id)),
    [shown, classes],
  )
  const classById = useMemo(() => new Map((classes ?? []).map((c) => [c.id, c])), [classes])
  const projectOptions = useMemo(
    () => submittedProjects(all, filters.classId),
    [all, filters.classId],
  )
  // Only the classes that have something in them are worth offering.
  const classOptions = useMemo(() => {
    const withWork = new Set(all.map((r) => r.class_id))
    return (classes ?? [])
      .filter((c) => withWork.has(c.id))
      .map((c) => ({ value: c.id, label: `${c.initial} · ${c.section} — ${c.name}` }))
  }, [all, classes])

  const popoverActive = [
    filters.query.trim(),
    filters.classId,
    filters.projectId,
    filters.timing,
    filters.order !== 'newest',
  ].filter(Boolean).length
  const narrowedTotal = counts.waiting + counts.accepted + counts.returned

  const clearAll = () => setFilters(EMPTY_SUBMISSION_FILTERS)
  const loading = rows === null || classes === null

  return (
    <div className="w-full">
      <DirectoryHero
        title="Work that was"
        accent="handed in."
        description="Every group that handed in a project, sorted by class. See what is waiting on you, what you accepted and what went back to be fixed."
        stats={[
          { label: 'Waiting on you', value: loading ? '—' : allCounts.waiting },
          { label: 'Accepted', value: loading ? '—' : allCounts.accepted },
          { label: 'Returned', value: loading ? '—' : allCounts.returned },
          { label: 'Classes', value: loading ? '—' : new Set(all.map((r) => r.class_id)).size },
        ]}
        statsVariant="compact-row"
      />

      <div className="mt-6 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}

        {loading ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading submissions…
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon="upload"
            title={classes.length === 0 ? 'No classes yet' : 'Nothing handed in yet'}
            body={
              classes.length === 0
                ? 'Submissions come from the groups in your classes. Create a class and a project first.'
                : 'When a group hands in a project, it appears here under its class, with the project it belongs to.'
            }
          />
        ) : (
          <>
            {/* The one filter a professor reaches for every visit stays in
                view; the rest fold into the filter button. */}
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Show by status"
                // Two by two on a phone: a sideways scroll would hide the
                // last status, and the count on it is the point.
                className="surface-sunken grid w-full grid-cols-2 gap-1 rounded-lg p-0.5 sm:flex sm:w-auto"
              >
                <StatusTab
                  label="All"
                  count={narrowedTotal}
                  on={filters.status === ''}
                  onClick={() => set({ status: '' })}
                />
                {SUBMISSION_STATUSES.map((s) => (
                  <StatusTab
                    key={s.value}
                    label={s.label}
                    count={counts[s.value]}
                    on={filters.status === s.value}
                    tone={s.value === 'waiting' && counts.waiting > 0 ? 'amber' : undefined}
                    onClick={() => set({ status: s.value })}
                  />
                ))}
              </div>

              <FilterPopover
                active={popoverActive}
                summary={[
                  filters.query.trim() && `“${filters.query.trim()}”`,
                  filters.classId && classById.get(filters.classId)?.initial,
                  filters.projectId &&
                    projectOptions.find((p) => p.value === filters.projectId)?.label,
                  filters.timing && TIMING_OPTIONS.find((o) => o.value === filters.timing)?.label,
                  filters.order !== 'newest' && 'Oldest first',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={() => setFilters((f) => ({ ...EMPTY_SUBMISSION_FILTERS, status: f.status }))}
                label="Filter submissions"
              >
                <FilterField label="Search">
                  <FilterSearch
                    value={filters.query}
                    onChange={(query) => set({ query })}
                    placeholder="Group, project or student"
                  />
                </FilterField>

                {classOptions.length > 1 && (
                  <FilterField label="Class">
                    <Select
                      value={filters.classId}
                      // A project belongs to one class, so a project picked
                      // under another class would silently empty the page.
                      onChange={(e) => set({ classId: e.target.value, projectId: '' })}
                      placeholder="All classes"
                      options={classOptions}
                      className="!h-10 !text-[13px]"
                    />
                  </FilterField>
                )}

                <FilterField label="Project">
                  <Select
                    value={filters.projectId}
                    onChange={(e) => set({ projectId: e.target.value })}
                    placeholder="All projects"
                    options={projectOptions}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>

                <FilterField label="Handed in">
                  <Select
                    value={filters.timing}
                    onChange={(e) => set({ timing: e.target.value as SubmissionTiming })}
                    placeholder="Any time"
                    options={TIMING_OPTIONS}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>

                <FilterField label="Order">
                  <Select
                    value={filters.order}
                    onChange={(e) => set({ order: e.target.value as SubmissionOrder })}
                    options={ORDER_OPTIONS}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
              </FilterPopover>

              <p className="ml-auto shrink-0 font-mono text-[12px] text-faint">
                {shown.length === all.length
                  ? `${all.length} ${all.length === 1 ? 'submission' : 'submissions'}`
                  : `${shown.length} of ${all.length}`}
              </p>
            </div>

            {sections.length > 1 && (
              <nav aria-label="Jump to class" className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-[12px] font-medium text-faint">Jump to</span>
                {sections.map(({ classId, rows: list }) => {
                  const c = classById.get(classId)
                  return (
                    <a
                      key={classId}
                      href={`#class-${classId}`}
                      className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink"
                    >
                      {c ? `${c.initial} · ${c.section}` : 'Class'}
                      <span className="font-mono text-faint">{list.length}</span>
                    </a>
                  )
                })}
              </nav>
            )}

            {sections.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matches"
                body="No submission fits these filters. Try another status, or clear the filters."
                action={
                  <Button variant="outline" size="sm" onClick={clearAll}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <div className="space-y-6">
                {sections.map(({ classId, rows: list }) => (
                  <ClassSection key={classId} klass={classById.get(classId)} rows={list} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatusTab({
  label,
  count,
  on,
  tone,
  onClick,
}: {
  label: string
  count: number
  on: boolean
  tone?: 'amber'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors sm:justify-start ${
        on ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 font-mono text-[12px] ${
          tone === 'amber'
            ? 'bg-amber-400/25 text-amber-800 dark:text-amber-200'
            : 'text-faint'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function ClassSection({ klass, rows }: { klass: ClassSummary | undefined; rows: Submission[] }) {
  const waiting = rows.filter((r) => r.status === 'waiting').length
  return (
    <section
      id={klass ? `class-${klass.id}` : undefined}
      className="scroll-mt-28 overflow-hidden rounded-card border border-line surface"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <p className="eyebrow">
            {klass ? `${klass.initial} · ${klass.section}` : 'Class'}
          </p>
          <h2 className="mt-1 leading-snug">{klass?.name ?? 'A class'}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {waiting > 0 && (
            <span className="rounded-full bg-amber-400/25 px-2.5 py-1 text-[12px] font-medium text-amber-800 dark:text-amber-200">
              {waiting} waiting on you
            </span>
          )}
          <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted ring-1 ring-[var(--line)]">
            {rows.length}
          </span>
        </div>
      </header>

      {/* Column names only where the columns exist. On a phone each row is
          its own small card and labels itself. */}
      <div
        aria-hidden
        className="hidden border-b border-line px-5 py-2 text-[12px] font-medium text-faint lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_10rem_9.5rem] lg:gap-x-5"
      >
        <span>Group</span>
        <span>Project</span>
        <span>Handed in</span>
        <span>Work done</span>
        <span>Status</span>
      </div>

      <ul className="divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <SubmissionRow key={r.id} row={r} />
        ))}
      </ul>
    </section>
  )
}

function SubmissionRow({ row }: { row: Submission }) {
  const pct = Number(row.done_pct)
  const status = SUBMISSION_STATUSES.find((s) => s.value === row.status)?.label
  return (
    <li>
      <Link
        to={`/professor/projects/${row.project_id}?tab=tasks&board=${row.id}`}
        aria-label={`${boardOwnerName(row)}, ${row.project_title}: ${status}. Open the board.`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5 transition-colors [grid-template-areas:'who_status'_'project_project'_'when_when'_'work_work'] hover:bg-[var(--surface-sunken)] sm:px-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_10rem_9.5rem] lg:items-center lg:gap-x-5 lg:[grid-template-areas:'who_project_when_work_status']"
      >
        <div className="min-w-0 [grid-area:who]">
          <p className="truncate text-[14px] font-medium text-ink group-hover:underline">
            {boardOwnerName(row)}
          </p>
          <p className="mt-0.5 text-[12px] text-faint">
            {row.student_id
              ? 'Individual'
              : `${row.member_count} ${row.member_count === 1 ? 'member' : 'members'}`}
          </p>
        </div>

        <div className="min-w-0 [grid-area:project]">
          <p className="flex items-center gap-1.5 text-[13px] text-ink">
            <Icon name="kanban" size={13} className="shrink-0 text-faint lg:hidden" />
            <span className="truncate">{row.project_title}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-faint">
            {row.project_due_at ? `Due ${stamp(row.project_due_at)}` : 'No deadline'}
          </p>
        </div>

        <div className="min-w-0 [grid-area:when]">
          {row.status === 'returned' ? (
            <>
              <p className="text-[13px] text-ink">
                Returned {row.result_at ? stamp(row.result_at) : ''}
              </p>
              <p className="mt-0.5 text-[12px] text-faint">Back with the group to fix</p>
            </>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink">
                {row.submitted_at ? stamp(row.submitted_at) : '—'}
                {row.late && (
                  <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[12px] font-medium text-red-700 dark:text-red-300">
                    Late
                  </span>
                )}
              </p>
              {row.submitted_by_name && (
                <p className="mt-0.5 truncate text-[12px] text-faint">
                  by {row.submitted_by_name}
                </p>
              )}
            </>
          )}
        </div>

        <div className="min-w-0 [grid-area:work]">
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="text-muted">
              {row.done_count}/{row.task_count} done
            </span>
            <span className="font-mono text-faint">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
            <span
              className="block h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 [grid-area:status] lg:justify-between">
          <span
            className={`rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap ${TONE[row.status]}`}
          >
            {status}
          </span>
          <Icon
            name="chevronRight"
            size={16}
            className="hidden shrink-0 text-faint transition-colors group-hover:text-ink lg:block"
          />
        </div>
      </Link>
    </li>
  )
}
