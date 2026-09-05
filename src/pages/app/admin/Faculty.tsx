import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Avatar } from '../../../components/app/Avatar'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Select } from '../../../components/ui/Select'
import { EmptyState } from '../../../components/ui/EmptyState'
import { listAccounts } from '../../../lib/api/accounts'
import { programClasses } from '../../../lib/api/admin'
import { authErrorMessage } from '../../../lib/authError'
import { currentSchoolYear, loadRollup, readiness } from '../../../lib/program'
import type { Load, ProgramClass } from '../../../lib/program'
import { ACCOUNT_STATUS_LABEL, fullName } from '../../../lib/types'
import type { Account } from '../../../lib/types'

/**
 * Teaching load, professor by professor.
 *
 * Chairs assign load, and this is the sheet they assign it from. It is ordered
 * the way that job is done rather than alphabetically: whoever needs attention
 * first, then the heaviest load, then everybody else — because a chair opening
 * this page is looking for the person who has nothing, or the person whose
 * classes will not start.
 *
 * A professor holding no class at all is still on the list. An empty load is
 * the thing a chair most needs to see, and it is invisible on a page built from
 * classes alone.
 */
export default function Faculty() {
  const [rows, setRows] = useState<ProgramClass[] | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState('')
  const [semester, setSemester] = useState('')

  const refresh = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    document.title = 'Faculty · Collabify'
    void refresh()
  }, [refresh])

  useLive(refresh, ['classes', 'profiles', 'class_members', 'projects'])

  const all = useMemo(() => rows ?? [], [rows])
  const inTerm = useMemo(
    () =>
      all
        .filter((c) => (year ? c.school_year === year : true))
        .filter((c) => (semester ? c.semester === semester : true))
        .filter((c) => !c.archived_at),
    [all, year, semester],
  )
  const load = useMemo(() => loadRollup(inTerm), [inTerm])

  /**
   * Ordered by what the chair is looking for, not by name: somebody with no
   * load at all, then somebody whose classes cannot start, then the heaviest
   * loads. An account that is not active sinks to the bottom — it cannot be
   * given a class, and approving it is the approvals page's business.
   */
  const ordered = useMemo(() => {
    const rank = (a: Account) => {
      const mine = load.get(a.id)
      if (a.status !== 'active') return 9
      if (!mine || mine.classes.length === 0) return 0
      if (mine.not_ready > 0) return 1
      return 2
    }
    return [...accounts].sort((a, b) => {
      const byRank = rank(a) - rank(b)
      if (byRank !== 0) return byRank
      const loadA = load.get(a.id)?.students ?? 0
      const loadB = load.get(b.id)?.students ?? 0
      return loadB - loadA || fullName(a).localeCompare(fullName(b))
    })
  }, [accounts, load])

  if (rows === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Reading the load…
      </div>
    )
  }

  const years = [...new Set(all.map((c) => c.school_year))].sort().reverse()
  const active = [year, semester].filter(Boolean).length
  const activeFaculty = accounts.filter((account) => account.status === 'active')
  const teaching = activeFaculty.filter((account) => (load.get(account.id)?.classes.length ?? 0) > 0)
  const students = [...load.values()].reduce((sum, item) => sum + item.students, 0)
  const notReady = [...load.values()].reduce((sum, item) => sum + item.not_ready, 0)

  return (
    <div className="space-y-6">
      <DirectoryHero
        title="Teaching load,"
        accent="made visible."
        description="See who is teaching this term, where classes need setup, and where faculty capacity remains."
        statsVariant="compact-row"
        stats={[
          { value: `${teaching.length}/${activeFaculty.length}`, label: 'With a load' },
          { value: inTerm.length, label: 'Classes' },
          { value: students, label: 'Students' },
          { value: notReady, label: 'Not ready' },
        ]}
      />

      {error && <Alert tone="error">{error}</Alert>}

      <section className="surface overflow-hidden rounded-panel border border-line">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-[var(--surface-sunken)] px-4 py-4 sm:px-5">
          <div>
            <p className="text-[12px] font-medium text-faint">Term overview</p>
            <h2 className="mt-1">Faculty load</h2>
          </div>
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
          </FilterPopover>
        </header>
        <div className="p-4 sm:p-5">

      {accounts.length === 0 ? (
        <EmptyState
          icon="users"
          title="No professors yet"
          body="Approve a professor and their load appears here."
        />
      ) : (
        <>
          <LoadStrip accounts={accounts} load={load} />

          <ul className="space-y-3">
            {ordered.map((a) => (
              <ProfessorRow key={a.id} account={a} load={load.get(a.id)} />
            ))}
          </ul>
        </>
      )}
        </div>
      </section>
    </div>
  )
}

/** The whole faculty in one line: who is carrying the term, and who is not. */
function LoadStrip({ accounts, load }: { accounts: Account[]; load: Map<string, Load> }) {
  const active = accounts.filter((a) => a.status === 'active')
  const teaching = active.filter((a) => (load.get(a.id)?.classes.length ?? 0) > 0)
  const students = [...load.values()].reduce((n, l) => n + l.students, 0)
  const classes = [...load.values()].reduce((n, l) => n + l.classes.length, 0)
  const notReady = [...load.values()].reduce((n, l) => n + l.not_ready, 0)
  const waiting = accounts.filter((a) => a.status !== 'active').length

  return (
    <section className="mb-4 rounded-card border border-line bg-[var(--surface-sunken)] p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Figure value={`${teaching.length}/${active.length}`} label="professors with a load" />
        <Figure value={classes} label="classes running" />
        <Figure value={students} label="student places filled" />
        <Figure
          value={notReady}
          label={notReady === 1 ? 'class not ready' : 'classes not ready'}
          tone={notReady > 0 ? 'warn' : undefined}
        />
      </div>

      {(active.length - teaching.length > 0 || waiting > 0) && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <Icon name="info" size={14} className="shrink-0 text-faint" />
          {active.length - teaching.length > 0 && (
            <span>
              {active.length - teaching.length}{' '}
              {active.length - teaching.length === 1 ? 'professor holds' : 'professors hold'} no
              class this term.
            </span>
          )}
          {waiting > 0 && (
            <span>
              {waiting} {waiting === 1 ? 'account is' : 'accounts are'} not active yet.
            </span>
          )}
        </p>
      )}
    </section>
  )
}

function Figure({
  value,
  label,
  tone,
}: {
  value: number | string
  label: string
  tone?: 'warn'
}) {
  return (
    <div className="border-l-2 border-line pl-3">
      <p
        className={`font-mono text-[22px] leading-none ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] text-muted">{label}</p>
    </div>
  )
}

function ProfessorRow({ account, load }: { account: Account; load?: Load }) {
  const classes = load?.classes ?? []
  const inactive = account.status !== 'active'
  const empty = classes.length === 0
  const notReady = load?.not_ready ?? 0

  return (
    <li
      className={`surface overflow-hidden rounded-card border ${
        inactive
          ? 'border-line opacity-80'
          : empty || notReady > 0
            ? 'border-line'
            : 'border-line'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar profile={account} size={40} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate text-[14px] text-ink">
              {fullName(account)}
              {inactive && (
                <Badge className="shrink-0 whitespace-nowrap">
                  {ACCOUNT_STATUS_LABEL[account.status]}
                </Badge>
              )}
            </p>
            <p className="truncate text-[12px] text-muted">{account.email}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-5">
          <Stat value={classes.length} label={classes.length === 1 ? 'class' : 'classes'} />
          <Stat value={load?.students ?? 0} label="students" />
          {notReady > 0 && (
            <Badge tone="warning" className="shrink-0 whitespace-nowrap">
              {notReady} not ready
            </Badge>
          )}
        </div>
      </div>

      {empty ? (
        <p className="flex items-center gap-2 border-t border-line surface-sunken px-4 py-2.5 text-[12px] text-muted">
          <Icon name="info" size={13} className="shrink-0 text-faint" />
          {inactive
            ? 'Not teaching — the account is not active.'
            : 'No class this term. Nothing is assigned to them.'}
        </p>
      ) : (
        <ul className="border-t border-line surface-sunken px-4 py-2.5">
          {classes.map((c) => {
            const gaps = readiness(c)
            return (
              <li
                key={c.class_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1"
              >
                <span className="w-[46px] shrink-0 font-mono text-[12px] text-muted">
                  {c.class_initial}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                  {c.class_name}
                  <span className="ml-2 text-[12px] text-faint">
                    {c.section} · {c.year_level} year
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[12px] text-faint">
                  {c.students} {c.students === 1 ? 'student' : 'students'}
                </span>
                <span className="flex w-[86px] shrink-0 justify-end">
                  {gaps.length > 0 && (
                    <span title={gaps.join(', ')} className="shrink-0">
                      <Badge tone="warning" className="whitespace-nowrap">
                        not ready
                      </Badge>
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-right">
      <p className="font-mono text-[17px] leading-none text-ink">{value}</p>
      <p className="mt-0.5 text-[12px] text-faint">{label}</p>
    </div>
  )
}

