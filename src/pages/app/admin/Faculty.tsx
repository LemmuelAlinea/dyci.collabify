import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../../components/app/Avatar'
import { Alert } from '../../../components/ui/Field'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/Tabs'
import { listAccounts } from '../../../lib/api/accounts'
import { programClasses } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { currentSchoolYear, loadRollup, readiness } from '../../../lib/program'
import type { ProgramClass } from '../../../lib/program'
import { ACCOUNT_STATUS_LABEL, fullName } from '../../../lib/types'
import type { Account } from '../../../lib/types'

/**
 * Teaching load, professor by professor.
 *
 * Chairs assign load, and this is the sheet they assign it from: who holds what
 * this term, how many students that comes to, and whose classes are not set up
 * yet. A professor with nothing at all is on the list too — an empty load is
 * the thing a chair most needs to see, and it is invisible if the page is built
 * from classes alone.
 */
export default function Faculty() {
  const [rows, setRows] = useState<ProgramClass[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [semester, setSemester] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [classes, people] = await Promise.all([programClasses(), listAccounts()])
        setRows(classes)
        setAccounts(people.filter((a) => a.role === 'professor'))
        setYear((y) => y || currentSchoolYear(classes))
        setError(null)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load the faculty.'))
        setRows([])
      }
    })()
  }, [])

  const all = rows ?? []
  const inTerm = useMemo(
    () =>
      all
        .filter((c) => (year ? c.school_year === year : true))
        .filter((c) => (semester ? c.semester === semester : true))
        .filter((c) => !c.archived_at),
    [all, year, semester],
  )
  const load = useMemo(() => loadRollup(inTerm), [inTerm])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Reading the load…
      </div>
    )
  }

  const years = [...new Set(all.map((c) => c.school_year))].sort().reverse()
  const active = [year, semester].filter(Boolean).length

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Oversight</p>
        <h1 className="mt-1 text-[30px] leading-tight">Faculty</h1>
        <p className="mt-2 max-w-[70ch] text-[14.5px] text-muted">
          Who is teaching what this term, and how much of it is set up. Names and counts —
          nothing of what happens inside anybody's class.
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

      {accounts.length === 0 ? (
        <EmptyState
          icon="users"
          title="No professors yet"
          body="Approve a professor and their load appears here."
        />
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => {
            const mine = load.get(a.id)
            const classes = mine?.classes ?? []
            return (
              <li
                key={a.id}
                className="surface rounded-card border border-line p-4 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar profile={a} size={38} />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] text-ink">{fullName(a)}</p>
                      <p className="truncate text-[12.5px] text-muted">
                        {a.email}
                        {a.status !== 'active' && ` · ${ACCOUNT_STATUS_LABEL[a.status]}`}
                      </p>
                    </div>
                  </div>

                  <dl className="flex shrink-0 gap-5">
                    {[
                      ['Classes', classes.length],
                      ['Students', mine?.students ?? 0],
                      ['Not ready', mine?.not_ready ?? 0],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[11px] text-faint">{k}</dt>
                        <dd className="font-mono text-[15px] text-ink">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {classes.length === 0 ? (
                  <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
                    <Icon name="info" size={13} className="shrink-0 text-faint" />
                    No class this term.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {classes.map((c) => {
                      const gaps = readiness(c)
                      return (
                        <li
                          key={c.class_id}
                          className={`rounded-lg border px-2.5 py-1 text-[12px] ${
                            gaps.length > 0
                              ? 'border-amber-300 text-amber-700 dark:border-amber-400/40 dark:text-amber-300'
                              : 'border-line text-muted'
                          }`}
                          title={gaps.length > 0 ? gaps.join(', ') : undefined}
                        >
                          {c.class_initial} · {c.section}
                          <span className="ml-1.5 font-mono text-[11px] text-faint">
                            {c.students}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
