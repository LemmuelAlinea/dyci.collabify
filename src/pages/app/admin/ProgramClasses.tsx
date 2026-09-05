import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { PaceCard } from '../../../components/analytics/PaceCard'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { programClasses } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { currentSchoolYear, paceOf, readiness } from '../../../lib/program'
import type { ProgramClass } from '../../../lib/program'
import { dayLabel } from '../../../lib/report'

type State = '' | 'not_ready' | 'behind'

const STATES = [
  { value: 'not_ready', label: 'Not ready to run' },
  { value: 'behind', label: 'Behind on the syllabus' },
]

/**
 * Every class in the program, as figures.
 *
 * The chair's first duty is making sure each course's syllabus is implemented
 * within the term, and their first week is spent finding the classes that
 * cannot start. Both questions are the same list read two ways, which is why
 * this is one page with a state filter rather than two pages that would drift.
 *
 * Counts only. There is no way from here into a class's work — no task, no
 * comment, no file, no one student. The chair sees enough to ask a professor
 * the right question, and asks them.
 */
export default function ProgramClasses() {
  const [rows, setRows] = useState<ProgramClass[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [semester, setSemester] = useState('')
  const [level, setLevel] = useState('')
  const [professor, setProfessor] = useState('')
  const [state, setState] = useState<State>('')

  const load = useCallback(async () => {
    try {
      const data = await programClasses()
      setRows(data)
      setYear((y) => y || currentSchoolYear(data))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the program.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members', 'projects', 'project_boards', 'project_tasks', 'syllabus_weeks'])

  const all = useMemo(() => rows ?? [], [rows])
  const professors = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of all) seen.set(c.professor_id, c.professor_name)
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [all])

  const shown = useMemo(
    () =>
      all
        .filter((c) => (year ? c.school_year === year : true))
        .filter((c) => (semester ? c.semester === semester : true))
        .filter((c) => (level ? c.year_level === level : true))
        .filter((c) => (professor ? c.professor_id === professor : true))
        .filter((c) => {
          if (state === 'not_ready') return readiness(c).length > 0
          if (state === 'behind') {
            const p = paceOf(c)
            return p ? p.weeks_covered < p.weeks_elapsed : false
          }
          return true
        }),
    [all, year, semester, level, professor, state],
  )

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Reading the program…
      </div>
    )
  }

  const years = [...new Set(all.map((c) => c.school_year))].sort().reverse()
  const active = [year, semester, level, professor, state].filter(Boolean).length

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Oversight</p>
        <h1 className="mt-1 leading-tight">Classes</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] text-muted">
          Every class in the program: who teaches it, whether it is set up to run, and how
          much of its syllabus has work against it. Figures only — what is inside a class
          belongs to its professor and their students.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <FilterPopover
        active={active}
        summary={[
          year,
          semester && `${semester} sem`,
          level && `${level} year`,
          professors.find((p) => p.value === professor)?.label,
          STATES.find((s) => s.value === state)?.label,
        ]
          .filter(Boolean)
          .join(' · ')}
        onClear={() => {
          setYear('')
          setSemester('')
          setLevel('')
          setProfessor('')
          setState('')
        }}
        label="Filter the program"
      >
        <FilterField label="School year">
          <Select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Every year"
            options={years.map((y) => ({ value: y, label: y }))}
            className="!h-10 !text-[13px]"
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
            className="!h-10 !text-[13px]"
          />
        </FilterField>
        <FilterField label="Year level">
          <Select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            placeholder="Every year level"
            options={['1st', '2nd', '3rd', '4th'].map((v) => ({ value: v, label: `${v} year` }))}
            className="!h-10 !text-[13px]"
          />
        </FilterField>
        <FilterField label="Professor">
          <Select
            value={professor}
            onChange={(e) => setProfessor(e.target.value)}
            placeholder="Everybody"
            options={professors}
            className="!h-10 !text-[13px]"
          />
        </FilterField>
        <FilterField label="Showing">
          <Select
            value={state}
            onChange={(e) => setState(e.target.value as State)}
            placeholder="Every class"
            options={STATES}
            className="!h-10 !text-[13px]"
          />
        </FilterField>
      </FilterPopover>

      {shown.length === 0 ? (
        <EmptyState
          icon="folder"
          title={active > 0 ? 'Nothing matches' : 'No classes yet'}
          body={
            active > 0
              ? 'Try a wider filter — the program may have nothing in that state, which is the good answer.'
              : 'Once a professor creates a class it appears here.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <ClassRow key={c.class_id} cls={c} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ClassRow({ cls }: { cls: ProgramClass }) {
  const gaps = readiness(cls)
  const pace = paceOf(cls)
  const behind = pace ? pace.weeks_covered < pace.weeks_elapsed : false

  return (
    <li
      className={`surface rounded-card border p-4 shadow-card ${
        gaps.length > 0
          ? 'border-amber-300 dark:border-amber-400/40'
          : behind
            ? 'border-red-200 dark:border-red-500/30'
            : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow">
            {cls.code} · {cls.section} · {cls.year_level} year · {cls.semester} sem{' '}
            {cls.school_year}
          </p>
          <h2 className="mt-0.5 leading-snug text-ink">
            {cls.class_initial} — {cls.class_name}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {cls.professor_name}
            {cls.archived_at && ` · term ended ${dayLabel(cls.archived_at)}`}
          </p>
        </div>

        <dl className="flex shrink-0 flex-wrap gap-x-5 gap-y-1">
          {[
            ['Students', cls.students],
            ['Projects', cls.projects],
            ['Syllabus', `${cls.weeks_covered}/${cls.weeks_total}`],
            ['Finished', `${cls.tasks_done}/${cls.tasks}`],
            ['Late', cls.tasks_late],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] text-faint">{k}</dt>
              <dd className="font-mono text-[14px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {gaps.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <Icon name="alert" size={14} className="shrink-0 text-amber-500" />
          <span className="text-muted">Not ready to run:</span>
          {gaps.map((g) => (
            <Badge key={g} tone="warning">
              {g}
            </Badge>
          ))}
        </p>
      )}

      {pace && (
        <div className="mt-3">
          <PaceCard pace={pace} />
        </div>
      )}
    </li>
  )
}
