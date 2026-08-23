import { useEffect, useMemo, useState } from 'react'
import { Alert } from '../../../components/ui/Field'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { programClasses } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { cohortRollup, currentSchoolYear, paceOf, readiness } from '../../../lib/program'
import type { ProgramClass } from '../../../lib/program'

/**
 * A whole year level at once.
 *
 * One class being behind is between a chair and a professor. A year level being
 * behind is the program's problem, and it is invisible from any single class —
 * which is the only reason this page exists apart from the class list.
 *
 * Still counts. The bar is finished tasks over tasks set; it is not a mark, and
 * nothing here says who finished them.
 */
export default function Cohort() {
  const [rows, setRows] = useState<ProgramClass[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [semester, setSemester] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const data = await programClasses()
        setRows(data)
        setYear((y) => y || currentSchoolYear(data))
        setError(null)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load the cohorts.'))
        setRows([])
      }
    })()
  }, [])

  const all = rows ?? []
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
  const behind = shown.filter((c) => {
    const p = paceOf(c)
    return p ? p.weeks_covered < p.weeks_elapsed : false
  })

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Oversight</p>
        <h1 className="mt-1 text-[30px] leading-tight">Cohort</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          Each year level added up: how many classes it runs, how many students it holds,
          and how much of the work set for it is finished.
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
          <ul className="space-y-3">
            {cohorts.map((c) => {
              const pct = c.tasks === 0 ? 0 : Math.round((c.tasks_done / c.tasks) * 100)
              return (
                <li
                  key={c.year_level}
                  className="surface rounded-card border border-line p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div>
                      <p className="eyebrow">{c.year_level} year</p>
                      <h2 className="mt-0.5 text-[17px] text-ink">
                        {c.students} {c.students === 1 ? 'student' : 'students'} across{' '}
                        {c.classes} {c.classes === 1 ? 'class' : 'classes'}
                      </h2>
                    </div>
                    <dl className="flex shrink-0 gap-5">
                      {[
                        ['Projects', c.projects],
                        ['Finished', `${c.tasks_done}/${c.tasks}`],
                        ['Late', c.tasks_late],
                        ['Not ready', c.not_ready],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[11px] text-faint">{k}</dt>
                          <dd className="font-mono text-[15px] text-ink">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full surface-sunken">
                    <span
                      className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-muted">
                    {c.tasks === 0
                      ? 'No work set for this year level yet.'
                      : `${pct}% of the work set for this year level is finished.`}
                  </p>
                </li>
              )
            })}
          </ul>

          {behind.length > 0 && (
            <p className="flex items-start gap-2 text-[13px] text-muted">
              <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-amber-500" />
              {behind.length} {behind.length === 1 ? 'class has' : 'classes have'} covered
              fewer syllabus weeks than the term has used —{' '}
              {behind.map((c) => c.class_initial).join(', ')}.
            </p>
          )}

          {shown.some((c) => readiness(c).length > 0) && (
            <p className="text-[13px] text-muted">
              {shown.filter((c) => readiness(c).length > 0).length} of {shown.length} classes
              in view are still missing something before they can run. The Classes page names
              what.
            </p>
          )}
        </>
      )}
    </div>
  )
}
