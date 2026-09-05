import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import type { ReactNode } from 'react'
import { Alert } from '../../../components/ui/Field'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { programClasses } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { cohortRollup, currentSchoolYear, paceOf, readiness } from '../../../lib/program'
import type { Cohort as CohortRow, ProgramClass } from '../../../lib/program'

/**
 * A whole year level at once.
 *
 * One class being behind is between a chair and a professor. A year level being
 * behind is the program's problem, and it is invisible from any single class —
 * which is the only reason this page exists apart from the class list.
 *
 * Each cohort card opens out into the classes it is made of, because a cohort
 * at sixty per cent is not something anybody can act on until they can see
 * which class is holding it there. The trouble is named on the line it belongs
 * to rather than collected in a footnote nobody reaches.
 *
 * Still counts. The bar is finished tasks over tasks set; it is not a mark, and
 * nothing here says who finished them.
 */
export default function Cohort() {
  const [rows, setRows] = useState<ProgramClass[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [semester, setSemester] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await programClasses()
      setRows(data)
      setYear((y) => y || currentSchoolYear(data))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the cohorts.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members', 'projects', 'project_boards', 'project_tasks', 'syllabus_weeks'])

  const all = useMemo(() => rows ?? [], [rows])
  const shown = useMemo(
    () =>
      all
        .filter((c) => (year ? c.school_year === year : true))
        .filter((c) => (semester ? c.semester === semester : true)),
    [all, year, semester],
  )
  const cohorts = useMemo(() => cohortRollup(shown), [shown])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Adding up the batch…
      </div>
    )
  }

  const years = [...new Set(all.map((c) => c.school_year))].sort().reverse()
  const active = [year, semester].filter(Boolean).length

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Oversight</p>
        <h1 className="mt-1 text-[30px] leading-tight">Cohort</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          Each year level added up, and the classes underneath it. How much of the work set
          for a batch is finished, and which class is furthest from finishing it.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <FilterPopover
        active={active}
        summary={[year, semester && `${semester} sem`].filter(Boolean).join(' · ')}
        onClear={() => {
          setYear('')
          setSemester('')
        }}
        label="Filter the term"
      >
        <FilterField label="School year">
          <Select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Every year"
            options={years.map((y) => ({ value: y, label: y }))}
            className="!h-10 !text-[13.5px]"
          />
        </FilterField>
        <FilterField label="Semester">
          <Select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            placeholder="Either semester"
            options={[
              { value: '1st', label: '1st semester' },
              { value: '2nd', label: '2nd semester' },
              { value: '3rd', label: '3rd semester' },
              { value: 'summer', label: 'Summer' },
            ]}
            className="!h-10 !text-[13.5px]"
          />
        </FilterField>
      </FilterPopover>

      {cohorts.length === 0 ? (
        <EmptyState
          icon="chart"
          title="Nothing to add up"
          body="No class runs in the term you chose."
        />
      ) : (
        <>
          <ProgramStrip cohorts={cohorts} />

          <ul className="space-y-4">
            {cohorts.map((c) => (
              <CohortCard
                key={c.year_level}
                cohort={c}
                classes={shown.filter((x) => x.year_level === c.year_level)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Everything in view, before it is split by year level. */
function ProgramStrip({ cohorts }: { cohorts: CohortRow[] }) {
  const total = cohorts.reduce(
    (a, c) => ({
      students: a.students + c.students,
      classes: a.classes + c.classes,
      tasks: a.tasks + c.tasks,
      done: a.done + c.tasks_done,
      late: a.late + c.tasks_late,
      notReady: a.notReady + c.not_ready,
    }),
    { students: 0, classes: 0, tasks: 0, done: 0, late: 0, notReady: 0 },
  )
  const pct = total.tasks === 0 ? 0 : Math.round((total.done / total.tasks) * 100)

  return (
    <section className="surface rounded-card border border-line p-4 sm:p-5 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="eyebrow text-faint">The program, this term</p>
          <p className="mt-1 text-[19px] leading-snug text-ink">
            {total.students} students · {total.classes}{' '}
            {total.classes === 1 ? 'class' : 'classes'} · {cohorts.length} year{' '}
            {cohorts.length === 1 ? 'level' : 'levels'}
          </p>
        </div>
        <p className="font-mono text-[34px] leading-none text-ink">{pct}%</p>
      </div>

      <Bar pct={pct} className="mt-3 h-2.5" />

      <p className="mt-2 text-[13px] text-muted">
        {total.tasks === 0
          ? 'No work has been set anywhere in the program this term.'
          : `${total.done} of ${total.tasks} tasks finished across every class in view.`}
      </p>

      {(total.late > 0 || total.notReady > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {total.late > 0 && <Chip tone="bad">{total.late} finished late</Chip>}
          {total.notReady > 0 && (
            <Chip tone="warn">
              {total.notReady} {total.notReady === 1 ? 'class is' : 'classes are'} not ready
            </Chip>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One year level, and the classes it is made of — slowest first, since that is
 * the one the chair is looking for.
 */
function CohortCard({ cohort, classes }: { cohort: CohortRow; classes: ProgramClass[] }) {
  const pct = cohort.tasks === 0 ? 0 : Math.round((cohort.tasks_done / cohort.tasks) * 100)
  const ordered = [...classes].sort((a, b) => share(a) - share(b))

  return (
    <li className="surface overflow-hidden rounded-card border border-line shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 p-5 pb-3">
        <div className="min-w-0">
          <p className="eyebrow">{cohort.year_level} year</p>
          <h2 className="mt-1 text-[17px] leading-snug text-ink">
            {cohort.students} {cohort.students === 1 ? 'student' : 'students'} across{' '}
            {cohort.classes} {cohort.classes === 1 ? 'class' : 'classes'}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {cohort.projects} {cohort.projects === 1 ? 'project' : 'projects'} set ·{' '}
            {cohort.tasks_done} of {cohort.tasks} tasks finished
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-[28px] leading-none text-ink">{pct}%</p>
          <p className="mt-0.5 text-[11px] text-faint">finished</p>
        </div>
      </div>

      <div className="px-5 pb-4">
        <Bar pct={pct} />
        {(cohort.tasks_late > 0 || cohort.not_ready > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {cohort.tasks_late > 0 && <Chip tone="bad">{cohort.tasks_late} finished late</Chip>}
            {cohort.not_ready > 0 && <Chip tone="warn">{cohort.not_ready} not ready to run</Chip>}
          </div>
        )}
      </div>

      <div className="border-t border-line surface-sunken px-5 py-3">
        <p className="eyebrow text-faint">The classes in it</p>
        <ul className="mt-2 max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {ordered.map((c) => (
            <ClassLine key={c.class_id} cls={c} />
          ))}
        </ul>
      </div>
    </li>
  )
}

/** How far one class has got, as a fraction of its own work. */
function share(c: ProgramClass) {
  return c.tasks === 0 ? 0 : c.tasks_done / c.tasks
}

function ClassLine({ cls }: { cls: ProgramClass }) {
  const pct = Math.round(share(cls) * 100)
  const gaps = readiness(cls)
  const pace = paceOf(cls)
  const behind = pace ? pace.weeks_covered < pace.weeks_elapsed : false

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-[46px] shrink-0 font-mono text-[12px] text-muted">
        {cls.class_initial}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">{cls.class_name}</span>
        <span className="block truncate text-[11.5px] text-faint">
          {cls.section} · {cls.professor_name} · {cls.students}{' '}
          {cls.students === 1 ? 'student' : 'students'}
        </span>
      </span>

      <span className="hidden w-[110px] shrink-0 sm:block">
        <Bar pct={pct} className="h-1.5" />
      </span>
      <span className="w-[58px] shrink-0 text-right font-mono text-[12px] text-ink">
        {cls.tasks_done}/{cls.tasks}
      </span>

      <span className="flex w-[92px] shrink-0 justify-end">
        {gaps.length > 0 ? (
          <Chip tone="warn" title={gaps.join(', ')}>
            not ready
          </Chip>
        ) : behind ? (
          <Chip tone="bad" title="Fewer syllabus weeks covered than the term has used">
            behind
          </Chip>
        ) : null}
      </span>
    </li>
  )
}

function Bar({ pct, className = 'h-2' }: { pct: number; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-full surface-sunken ${className}`}>
      <span
        className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </span>
  )
}

function Chip({
  children,
  tone,
  title,
}: {
  children: ReactNode
  tone: 'warn' | 'bad'
  title?: string
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] whitespace-nowrap ${
        tone === 'bad'
          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
          : 'bg-amber-400/18 text-amber-700 dark:text-amber-300'
      }`}
    >
      {children}
    </span>
  )
}
