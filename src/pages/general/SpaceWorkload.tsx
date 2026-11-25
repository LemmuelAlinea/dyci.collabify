import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { MarkAwayDialog } from '../../components/general/MarkAwayDialog'
import { WorkTaskOverlay } from '../../components/general/WorkTaskOverlay'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { CheckboxList } from '../../components/ui/CheckboxList'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Select } from '../../components/ui/Select'
import { listSpaceMembers } from '../../lib/api/spaces'
import { listSpaceTeamMembers, listSpaceTeams } from '../../lib/api/general'
import { ROLE_LABEL } from '../../lib/general/permissions'
import type { ProjectRole } from '../../lib/general/permissions'
import {
  filterPeople,
  hasFilters,
  projectShare,
  readFilters,
  summarize,
  writeFilters,
  type StatusFilter,
  type WorkloadFilters,
  type WorkloadPerson,
  type WorkloadSort,
} from '../../lib/work/workloadView'
import {
  spacePeopleHours,
  spacePeopleLoad,
  estimateAccuracy,
  removeTimeOffRange,
  spaceAwayRanges,
  type AwayRange,
  spacePersonTasks,
  spaceWorkloadSummary,
  type PeopleHours,
  type PeopleLoad,
  type PersonTask,
  type WorkloadSummary,
} from '../../lib/api/workload'
import { authErrorMessage } from '../../lib/authError'
import { plural } from '../../lib/plural'
import { formatDayLabel, formatDayRange, formatHours, workWeek } from '../../lib/work/hours'
import type { HolderTone } from '../../lib/work/useHolderHours'
import { LOAD_BAR, loadTone } from '../../lib/work/loadTone'
import { useSpaceOutlet } from './spaceOutlet'

const WEEKS = 4
const DAY = 86_400_000

type Week = { from: string; to: string }
type WeekData = { load: PeopleLoad[]; hours: PeopleHours[] }
type Cell = {
  load: number
  available: number | null
  weekly: number | null
  off: number | null
  other: number
  byProject: Map<string | null, number>
}

function shift(week: Week, weeks: number): Week {
  const move = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + weeks * 7 * DAY).toISOString().slice(0, 10)
  return { from: move(week.from), to: move(week.to) }
}

const bare = (minutes: number) => formatHours(minutes).replace(/ h$/, '')

function toneOf(cell: Cell): HolderTone {
  return loadTone(cell.load, cell.available)
}

const BAR = LOAD_BAR

function cellOf(data: WeekData | undefined, userId: string): Cell | null {
  const hours = data?.hours.find((h) => h.user_id === userId)
  if (!data || !hours) return null
  const rows = data.load.filter((l) => l.user_id === userId)
  const byProject = new Map<string | null, number>()
  for (const l of rows) byProject.set(l.project_id, (byProject.get(l.project_id) ?? 0) + l.load_minutes)
  return {
    byProject,
    load: rows.reduce((n, l) => n + l.load_minutes, 0),
    other: rows.filter((l) => l.project_id === null).reduce((n, l) => n + l.load_minutes, 0),
    available: hours.available_minutes,
    weekly: hours.weekly_minutes,
    off: hours.time_off_minutes,
  }
}

/**
 * One week's bar: load against available hours, time off hatched at the end of
 * the week's hours. With projects chosen, the bar and figure show those
 * projects' hours and the rest reads "+N h elsewhere"; the tone stays the
 * person's whole load, so someone full elsewhere never looks free.
 */
function WeekCell({ cell, projects = [] }: { cell: Cell | null; projects?: string[] }) {
  if (!cell) return <span className="text-[12px] text-faint">-</span>
  const tone = toneOf(cell)
  if (cell.available == null) {
    return (
      <div className="space-y-1">
        <div data-tone={tone} className="h-2 rounded-full bg-pending-soft" />
        <p className="text-[12px] text-pending-ink">Not set</p>
      </div>
    )
  }
  const weekly = Math.max(cell.weekly ?? cell.available, 1)
  const share = projectShare({ load: cell.load, byProject: cell.byProject } as WorkloadPerson, projects)
  const used = Math.min(share.shown / weekly, 1) * 100
  const rest = Math.min(share.elsewhere / weekly, 1 - used / 100) * 100
  const off = Math.min((cell.off ?? 0) / weekly, 1) * 100
  return (
    <div className="space-y-1">
      <div className="relative h-2 overflow-hidden rounded-full surface-sunken">
        <div data-tone={tone} className={`absolute inset-y-0 left-0 rounded-full ${BAR[tone]} motion-safe:transition-[width]`} style={{ width: `${used}%` }} />
        {rest > 0 && <div data-elsewhere className="absolute inset-y-0 bg-[var(--line-strong)]" style={{ left: `${used}%`, width: `${rest}%` }} />}
        {off > 0 && (
          <div
            data-time-off
            title={`${formatHours(cell.off ?? 0)} time off`}
            className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,var(--line-strong)_0_2px,transparent_2px_5px)]"
            style={{ width: `${off}%` }}
          />
        )}
      </div>
      <p className={`font-mono text-[12px] ${tone === 'danger' ? 'text-danger-700 dark:text-danger-300' : 'text-muted'}`}>
        {bare(share.shown)} / {bare(cell.available)} h
      </p>
      {share.elsewhere > 0 && <p className="font-mono text-[11px] text-faint">+{bare(share.elsewhere)} h elsewhere</p>}
    </div>
  )
}

const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'over', label: 'Over' },
  { value: 'near', label: 'Near full' },
  { value: 'room', label: 'Has room' },
  { value: 'away', label: 'Away' },
]

const SORTS: { value: WorkloadSort; label: string }[] = [
  { value: 'loaded', label: 'Most loaded' },
  { value: 'free', label: 'Most free hours' },
  { value: 'name', label: 'Name' },
]

/** One figure in the summary strip; a count that is also a filter turns it on. */
function Stat({ label, value, hint, tone, active, onClick }: {
  label: string
  value: string
  hint?: string
  tone?: 'danger' | 'warning' | 'success'
  active?: boolean
  onClick?: () => void
}) {
  const color = tone === 'danger' ? 'text-danger-700 dark:text-danger-300'
    : tone === 'warning' ? 'text-warning-700 dark:text-warning-300'
      : tone === 'success' ? 'text-success-700 dark:text-success-300' : 'text-ink'
  const body = (
    <>
      <span className="eyebrow block text-faint">{label}</span>
      <span className={`mt-1 block font-display text-[22px] font-semibold ${color}`}>{value}</span>
      {hint && <span className="block font-mono text-[11px] text-muted">{hint}</span>}
    </>
  )
  const box = `rounded-xl border px-3.5 py-3 text-left ${active ? 'border-navy-600 ring-1 ring-navy-600' : 'border-line'}`
  return onClick ? (
    <button type="button" aria-pressed={active} onClick={onClick} className={`${box} surface hover:border-line-strong`}>{body}</button>
  ) : (
    <div className={`${box} surface`}>{body}</div>
  )
}

/**
 * The space's people by week: each person's load against their available hours
 * for this week and the next three. The database decides who and what each
 * viewer sees: planners see everyone, a project's planners their people, a
 * Member only themselves; other projects' work is one unnamed total.
 */
export default function SpaceWorkload() {
  const { spaceId = '' } = useParams<{ spaceId: string }>()
  const { all } = useSpaceOutlet()
  const [offset, setOffset] = useState(0)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [weeks, setWeeks] = useState<Map<string, WeekData>>(new Map())
  const [summary, setSummary] = useState<WorkloadSummary | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Map<string, PersonTask[] | 'loading' | 'error'>>(new Map())
  const [error, setError] = useState<string | null>(null)
  // Who is away today or later, read once per space and again after a change.
  const [away, setAway] = useState<{ space: string; rows: AwayRange[] } | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  // A task opened from a person's list shows over this page; the page stays put.
  const [viewing, setViewing] = useState<{ projectId: string; taskId: string } | null>(null)
  const { profile } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => readFilters(searchParams), [searchParams])
  const setFilters = (next: Partial<WorkloadFilters>) =>
    setSearchParams(writeFilters({ ...filters, ...next }, searchParams), { replace: true })
  // Space roles for the Role filter; space teams (when the viewer may read them) for the Team filter.
  const [roles, setRoles] = useState<Map<string, ProjectRole | null>>(new Map())
  const [teams, setTeams] = useState<{ id: string; name: string; members: string[] }[]>([])
  const { currentSpace } = useGeneralNavigation()
  // The space's project manager and coordinators mark people away.
  const plansLeave = !currentSpace?.archived_at && (currentSpace?.my_role === 'pm' || currentSpace?.my_role === 'coordinator')
  // How each person's estimates usually turn out; only people with 5 or more Done tasks have a row.
  const [accuracy, setAccuracy] = useState<{ space: string; ratios: Map<string, number> } | null>(null)

  const shown = useMemo(() => {
    const first = shift(workWeek(), offset)
    return Array.from({ length: WEEKS }, (_, i) => shift(first, i))
  }, [offset])
  const first = shown[0]

  useEffect(() => {
    let current = true
    void listSpaceMembers(spaceId)
      .then((people) => {
        if (!current) return
        setNames(new Map(people.map((p) => [p.user_id, `${p.first_name} ${p.last_name}`.trim()])))
        setRoles(new Map(people.map((p) => [p.user_id, p.role ?? null])))
      })
      .catch(() => {})
    void Promise.all([listSpaceTeams(spaceId), listSpaceTeamMembers(spaceId)])
      .then(([list, members]) => {
        if (current) setTeams(list.map((t) => ({ id: t.id, name: t.name, members: members.filter((m) => m.team_id === t.id).map((m) => m.user_id) })))
      })
      .catch(() => { if (current) setTeams([]) })
    return () => { current = false }
  }, [spaceId])

  // Caches are keyed by space too: the route can move to another space's tab
  // without remounting this page.
  const weekKey = (from: string) => `${spaceId}:${from}`
  useEffect(() => {
    let current = true
    const missing = shown.filter((w) => !weeks.has(weekKey(w.from)))
    if (missing.length === 0) return
    void Promise.all(missing.map(async (w) => {
      const [load, hours] = await Promise.all([spacePeopleLoad(spaceId, w.from, w.to), spacePeopleHours(spaceId, w.from, w.to)])
      return [weekKey(w.from), { load, hours }] as const
    }))
      .then((rows) => { if (current) setWeeks((prev) => new Map([...prev, ...rows])) })
      .catch((err) => { if (current) setError(authErrorMessage(err, 'Could not load workload. Reload the page.')) })
    return () => { current = false }
  }, [spaceId, shown]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let current = true
    void spaceWorkloadSummary(spaceId, first.from, first.to)
      .then((s) => { if (current) setSummary(s) })
      .catch(() => { if (current) setSummary(null) })
    return () => { current = false }
  }, [spaceId, first.from, first.to])

  useEffect(() => {
    let current = true
    void estimateAccuracy(spaceId)
      .then((rows) => { if (current) setAccuracy({ space: spaceId, ratios: new Map(rows.map((r) => [r.user_id, r.ratio])) }) })
      .catch(() => {})
    return () => { current = false }
  }, [spaceId])
  const loadAway = useCallback(() => {
    void spaceAwayRanges(spaceId)
      .then((rows) => setAway({ space: spaceId, rows }))
      .catch(() => setAway({ space: spaceId, rows: [] }))
  }, [spaceId])
  useEffect(() => {
    loadAway()
  }, [loadAway])
  // A leave-ending notice or a link can open Mark away for one person.
  const awayParam = searchParams.get('away')
  useEffect(() => {
    if (awayParam && plansLeave) setMarking(awayParam)
  }, [awayParam, plansLeave])
  const rangesOf = (userId: string) => (away?.space === spaceId ? away.rows.filter((r) => r.user_id === userId) : [])
  const awayLabel = (r: AwayRange) => `Away ${formatDayRange(r.first_day, r.last_day)}${r.part_day ? ' (part day)' : ''}`

  async function removeRange(r: AwayRange) {
    setError(null)
    try {
      await removeTimeOffRange(r.user_id, r.first_day, r.last_day)
      loadAway()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not remove that leave. Try again.'))
    }
  }

  const ratioOf = (userId: string) => (accuracy?.space === spaceId ? accuracy.ratios.get(userId) : undefined)

  // The open row's tasks for the first week shown: read when the row opens or the
  // week moves, and again after a failed read.
  const taskKey = (userId: string) => `${spaceId}:${userId}:${first.from}`
  useEffect(() => {
    if (!open) return
    const key = `${spaceId}:${open}:${first.from}`
    const cached = tasks.get(key)
    if (cached && cached !== 'error') return
    let current = true
    setTasks((prev) => new Map(prev).set(key, 'loading'))
    void spacePersonTasks(spaceId, open, first.from, first.to)
      .then((rows) => { if (current) setTasks((prev) => new Map(prev).set(key, rows)) })
      .catch(() => { if (current) setTasks((prev) => new Map(prev).set(key, 'error')) })
    return () => { current = false }
  }, [spaceId, open, first.from, first.to]) // eslint-disable-line react-hooks/exhaustive-deps

  const firstData = weeks.get(weekKey(first.from))
  // Away in the first week shown: an away range that overlaps it.
  const awayThisWeek = (userId: string) => rangesOf(userId).some((r) => r.first_day <= first.to && r.last_day >= first.from)
  const everyone: WorkloadPerson[] = useMemo(() => (firstData?.hours ?? []).map((h) => {
    const c = cellOf(firstData, h.user_id)
    return {
      id: h.user_id,
      name: names.get(h.user_id) ?? 'Someone',
      role: roles.get(h.user_id) ?? null,
      teamIds: teams.filter((t) => t.members.includes(h.user_id)).map((t) => t.id),
      away: awayThisWeek(h.user_id),
      load: c?.load ?? 0,
      available: c?.available ?? null,
      byProject: c?.byProject ?? new Map(),
    }
  }), [firstData, names, roles, teams, away, first.from]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownPeople = useMemo(() => filterPeople(everyone, filters), [everyone, filters])
  const people = shownPeople.map((p) => p.id)
  const stats = summarize(everyone)
  const projectName = (id: string) => all.find((p) => p.id === id)?.name ?? 'A project'
  // The space's projects, and any project with work in the weeks shown, for the Project filter.
  const projectOptions = useMemo(() => {
    const ids = new Set<string>(all.map((p) => p.id))
    for (const w of shown) for (const l of weeks.get(weekKey(w.from))?.load ?? []) if (l.project_id) ids.add(l.project_id)
    for (const id of filters.projects) ids.add(id)
    return [...ids].map((id) => ({ id, label: projectName(id) })).sort((a, b) => a.label.localeCompare(b.label))
  }, [weeks, shown, filters.projects, all]) // eslint-disable-line react-hooks/exhaustive-deps
  const roleOptions = useMemo(() => [...new Set([...roles.values()].filter((r): r is ProjectRole => r !== null))]
    .map((r) => ({ id: r, label: ROLE_LABEL[r] })), [roles])
  const toggleStatus = (status: StatusFilter) => setFilters({ status: filters.status === status ? 'all' : status })
  const percent = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–')

  function toggle(userId: string) {
    setOpen(open === userId ? null : userId)
  }

  return (
    <section aria-labelledby="workload-title" className="shell space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Workload</p>
          <h2 id="workload-title" className="font-display text-[22px] font-semibold text-ink">Hours by week</h2>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted">
            Estimated work each person holds against the hours they have, Monday to Friday. Tasks with no due date count this week.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous week" onClick={() => setOffset((n) => n - 1)}>
            <Icon name="chevronLeft" size={16} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)} disabled={offset === 0}>This week</Button>
          <Button size="sm" variant="ghost" aria-label="Next week" onClick={() => setOffset((n) => n + 1)}>
            <Icon name="chevronRight" size={16} />
          </Button>
        </div>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {firstData && everyone.length > 0 && (
        <div data-summary className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Team load" value={percent(stats.load, stats.available)} hint={`${bare(stats.load)} / ${bare(stats.available)} h`} />
          <Stat label="Over" value={String(stats.over)} hint="past their hours" tone={stats.over ? 'danger' : undefined} active={filters.status === 'over'} onClick={() => toggleStatus('over')} />
          <Stat label="Near full" value={String(stats.near)} hint="80% or more" tone={stats.near ? 'warning' : undefined} active={filters.status === 'near'} onClick={() => toggleStatus('near')} />
          <Stat label="Has room" value={String(stats.room)} hint="under 80%" tone="success" active={filters.status === 'room'} onClick={() => toggleStatus('room')} />
          <Stat label="Away" value={String(stats.away)} hint={`week of ${formatDayLabel(first.from).replace(/^\w+ /, '')}`} active={filters.status === 'away'} onClick={() => toggleStatus('away')} />
          <Stat label="No estimate" value={String(summary?.unestimated_tasks ?? 0)} hint={summary?.unestimated_tasks === 1 ? 'task this week' : 'tasks this week'} />
        </div>
      )}

      {firstData && everyone.length > 0 && (
        <div data-toolbar className="flex flex-wrap items-center gap-2">
          <div className="min-w-[12rem] flex-1 sm:max-w-[18rem]">
            <FilterSearch value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Search people" />
          </div>
          <FilterPopover
            label="Filters"
            active={filters.projects.length + filters.teams.length + filters.roles.length}
            summary={[
              filters.projects.length && `${filters.projects.length} ${plural(filters.projects.length, 'project', 'projects')}`,
              filters.teams.length && `${filters.teams.length} ${plural(filters.teams.length, 'team', 'teams')}`,
              filters.roles.length && filters.roles.map((r) => ROLE_LABEL[r as ProjectRole] ?? r).join(', '),
            ].filter(Boolean).join(' · ')}
            onClear={() => setFilters({ projects: [], teams: [], roles: [] })}
          >
            <FilterField label="Project">
              <CheckboxList label="Projects" items={projectOptions} selected={filters.projects} onChange={(projects) => setFilters({ projects })} empty="This space has no projects yet." maxHeight={180} />
            </FilterField>
            {teams.length > 0 && (
              <FilterField label="Team">
                <CheckboxList label="Teams" items={teams.map((t) => ({ id: t.id, label: t.name }))} selected={filters.teams} onChange={(next) => setFilters({ teams: next })} maxHeight={160} />
              </FilterField>
            )}
            {roleOptions.length > 0 && (
              <FilterField label="Role">
                <CheckboxList label="Roles" items={roleOptions} selected={filters.roles} onChange={(next) => setFilters({ roles: next })} maxHeight={160} />
              </FilterField>
            )}
          </FilterPopover>
          <div role="group" aria-label="Status" className="flex max-w-full gap-1 overflow-x-auto">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={filters.status === c.value}
                onClick={() => setFilters({ status: c.value })}
                className={`h-8 shrink-0 rounded-full border px-3 text-[13px] ${filters.status === c.value ? 'border-navy-600 bg-navy-600 text-white' : 'border-line text-muted hover:border-line-strong hover:text-ink'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Select
            aria-label="Sort people"
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value as WorkloadSort })}
            options={SORTS}
            className="!h-8 !w-[11rem] !text-[13px] sm:ml-auto"
          />
          {hasFilters(filters) && (
            <Button size="sm" variant="ghost" onClick={() => setFilters({ q: '', projects: [], teams: [], roles: [], status: 'all' })}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {!firstData && !error ? (
        <div className="grid place-items-center py-16"><Spinner /></div>
      ) : everyone.length === 0 ? (
        <EmptyState icon="users" title="No workload to show" body="Nobody here has work or hours you can see yet." />
      ) : people.length === 0 ? (
        <EmptyState
          icon="users"
          title="No one matches these filters."
          body="Change the search or the filters to see more people."
          action={<Button size="sm" variant="outline" onClick={() => setFilters({ q: '', projects: [], teams: [], roles: [], status: 'all' })}>Clear filters</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-[var(--surface)]">
          <div className="grid grid-cols-[minmax(9rem,1.2fr)_minmax(0,1fr)] gap-x-4 border-b border-line px-4 py-2.5 sm:grid-cols-[minmax(10rem,1.4fr)_repeat(4,minmax(0,1fr))]">
            <span className="eyebrow">Person</span>
            {shown.map((w, i) => (
              <span key={w.from} data-week-head className={`eyebrow ${i > 0 ? 'hidden sm:block' : ''}`}>{formatDayLabel(w.from)}</span>
            ))}
          </div>
          {people.map((userId) => {
            const expanded = open === userId
            const cells = shown.map((w) => cellOf(weeks.get(weekKey(w.from)), userId))
            const list = tasks.get(taskKey(userId))
            return (
              <Fragment key={userId}>
                <div data-person={userId} className="grid grid-cols-[minmax(9rem,1.2fr)_minmax(0,1fr)] items-center gap-x-4 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(10rem,1.4fr)_repeat(4,minmax(0,1fr))]">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggle(userId)}
                    className="flex min-w-0 items-center gap-2 text-left text-[14px] font-medium text-ink hover:text-navy-600"
                  >
                    <Icon name="chevronDown" size={14} className={`shrink-0 text-faint motion-safe:transition-transform ${expanded ? '' : '-rotate-90'}`} />
                    <span className="min-w-0">
                      <span className="block truncate">{names.get(userId) ?? 'Someone'}</span>
                      {roles.get(userId) && (
                        <span data-role className="block truncate text-[12px] font-normal text-faint">{ROLE_LABEL[roles.get(userId)!]}</span>
                      )}
                      {rangesOf(userId)[0] && (
                        <span data-away className="block truncate text-[12px] font-normal text-warning-700 dark:text-warning-300">
                          {awayLabel(rangesOf(userId)[0])}
                        </span>
                      )}
                    </span>
                  </button>
                  {cells.map((c, i) => (
                    <div key={shown[i].from} data-week={i} className={i > 0 ? 'hidden sm:block' : ''}><WeekCell cell={c} projects={filters.projects} /></div>
                  ))}
                </div>
                {expanded && (
                  <div className="border-b border-line surface-sunken px-4 py-3 text-[13px]">
                    {(plansLeave || rangesOf(userId).length > 0) && (
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {rangesOf(userId).map((r) => (
                          <span key={r.first_day} className="flex items-center gap-1 text-muted">
                            {awayLabel(r)}
                            {plansLeave && r.added_by && (
                              <Button size="sm" variant="ghost" onClick={() => void removeRange(r)}>Remove</Button>
                            )}
                          </span>
                        ))}
                        {plansLeave && (
                          <Button size="sm" variant="outline" onClick={() => setMarking(userId)}>Mark away</Button>
                        )}
                      </div>
                    )}
                    {ratioOf(userId) != null && (
                      <p className="mb-2 text-muted">Usually takes about {ratioOf(userId)}× the estimate.</p>
                    )}
                    <p className="eyebrow mb-2">Week of {formatDayLabel(first.from)}</p>
                    {list === 'error' ? (
                      <p className="text-muted">Could not load these tasks. Close the row and open it again.</p>
                    ) : list === 'loading' || !list ? (
                      <p className="text-faint">Loading tasks…</p>
                    ) : (
                      <ul className="space-y-3">
                        {[...new Set(list.map((t) => t.project_id))].map((pid) => {
                          const rows = list.filter((t) => t.project_id === pid)
                          return (
                            <li key={pid} data-project-group={pid}>
                              <p className="flex items-baseline justify-between gap-3 text-[12px] font-medium text-ink">
                                <span className="truncate">{projectName(pid)}</span>
                                <span className="shrink-0 font-mono text-muted">{formatHours(rows.reduce((n, t) => n + (t.unestimated ? 0 : t.minutes), 0))}</span>
                              </p>
                              <ul className="mt-1 space-y-1 border-l border-line pl-3">
                                {rows.map((t) => (
                                  <li key={t.task_id} className="flex items-baseline justify-between gap-3">
                                    <button
                                      type="button"
                                      data-open-task={t.task_id}
                                      onClick={() => setViewing({ projectId: t.project_id, taskId: t.task_id })}
                                      className="min-w-0 truncate text-left text-ink hover:text-navy-600 hover:underline focus-visible:text-navy-600"
                                    >
                                      {t.title}
                                    </button>
                                    <span className="shrink-0 font-mono text-muted">{t.unestimated ? 'No estimate' : formatHours(t.minutes)}</span>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          )
                        })}
                        {(cells[0]?.other ?? 0) > 0 && (
                          <li className="text-muted">Other work in this space · {formatHours(cells[0]!.other)}</li>
                        )}
                        {list.length === 0 && !(cells[0]?.other) && <li className="text-faint">No estimated work this week.</li>}
                      </ul>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
        </div>
      )}

      {marking && (
        <MarkAwayDialog
          open
          userId={marking}
          name={names.get(marking) ?? 'Someone'}
          initial={rangesOf(marking)[0] ? { from: rangesOf(marking)[0].first_day, to: rangesOf(marking)[0].last_day } : undefined}
          onClose={() => setMarking(null)}
          onSaved={loadAway}
        />
      )}

      {viewing && (
        <WorkTaskOverlay
          key={viewing.projectId}
          projectId={viewing.projectId}
          taskId={viewing.taskId}
          viewerId={profile?.id}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  )
}
