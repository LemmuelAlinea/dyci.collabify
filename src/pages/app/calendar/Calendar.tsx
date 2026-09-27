import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AgendaList } from '../../../components/calendar/AgendaList'
import { eventDot } from '../../../components/calendar/EventChip'
import { MonthGrid } from '../../../components/calendar/MonthGrid'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { TaskDetailModal } from '../../../components/tasks/detail/TaskDetailModal'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { FilterField, FilterPopover } from '../../../components/ui/FilterPopover'
import { Select } from '../../../components/ui/Select'
import { ScopeFilter } from '../../../components/ui/ScopeFilter'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { inAnyClass, membershipOf, showsClassScope } from '../../../lib/access'
import { useGeneralDashboard } from '../../../hooks/useGeneralDashboard'
import { listCalendar, listWeekBands } from '../../../lib/api/calendar'
import { authErrorMessage } from '../../../lib/authError'
import { paths } from '../../../lib/paths'
import { readScope, writeScope } from '../../../lib/scope'
import { CALENDAR_KINDS } from '../../../lib/types'
import type { CalendarEvent, ClassWeek } from '../../../lib/types'
import { workCalendarEvents } from './workDates'

type View = 'month' | 'agenda'

/**
 * Every dated thing across a viewer's classes and General work, over the
 * syllabus that produced it. What each role's class rows are is decided by the
 * database, not here — the calendar_events view is security_invoker, so a
 * student's own policies already keep other groups' work and unreleased
 * projects out. Work dates are not in that view (a General project has no
 * class), so they are read separately and merged in on the day they land,
 * the same way My tasks merges class tasks with General ones.
 */
export default function Calendar() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [weeks, setWeeks] = useState<ClassWeek[]>([])
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('month')
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [classFilter, setClassFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [showPast, setShowPast] = useState(false)

  const role = profile?.role
  // An admin in a class reads it as a co-teacher does.
  const staff = role === 'faculty' || role === 'admin'
  const openTask = params.get('task')
  const general = useGeneralNavigation()
  const spaces = general.spaces
  // Two questions. Class dates: a student always has them, faculty and admins
  // once a class has them in. The filter: only for someone with classes and
  // work both; without it, a student reads classes and everyone else work,
  // and a stale `?show=` cannot empty the page.
  const hasClassDates = role === 'student' || inAnyClass(spaces)
  const classScope = showsClassScope(profile, membershipOf(spaces, general.myProjects))
  const scope = classScope ? readScope(params) : role === 'student' ? 'classes' : 'work'

  const load = useCallback(async () => {
    if (!role) return
    // Faculty and admins in no class have no class dates, but their work
    // dates below still fill the page.
    if (!hasClassDates) {
      setEvents([])
      setWeeks([])
      setError(null)
      return
    }
    try {
      // An admin reads every class, so keep only the ones they were invited
      // into, and read them the way a co-teacher does.
      const invited = new Set((spaces ?? []).filter((s) => s.kind === 'education' && s.my_level).map((s) => s.class_id))
      const rows =
        role === 'admin'
          ? (await listCalendar('faculty')).filter((r) => invited.has(r.class_id))
          : await listCalendar(role)
      setEvents(rows)
      setWeeks(await listWeekBands([...new Set(rows.map((r) => r.class_id))]))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the calendar.'))
      setEvents([])
    }
  }, [role, hasClassDates, spaces])

  useEffect(() => {
    document.title = 'Calendar · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Professors have class dates too; only an admin's class load is a no-op.
  useLive(load, ['projects', 'project_tasks', 'project_boards', 'syllabus_weeks', 'classes'], {
    enabled: hasClassDates,
  })

  // Work dates: the reader's live General projects, and every open task on
  // them with a due date — not only the ones assigned to the reader, since a
  // project's calendar shows the project.
  const {
    myProjects,
    error: navError,
    reload: reloadNav,
  } = useGeneralNavigation()
  const mineProjects = useMemo(
    () => (myProjects ?? []).filter((p) => p.my_level && !p.archived_at),
    [myProjects],
  )
  const projectIds = useMemo(() => mineProjects.map((p) => p.id), [mineProjects])
  const {
    data: dashData,
    error: dashError,
    reload: reloadDash,
  } = useGeneralDashboard(profile?.id, projectIds)
  const projectName = useCallback(
    (id: string) => mineProjects.find((p) => p.id === id)?.name ?? 'A project',
    [mineProjects],
  )

  const workEvents = useMemo<CalendarEvent[]>(
    () => (dashData ? workCalendarEvents(dashData.tasks, projectName) : []),
    [dashData, projectName],
  )

  const classes = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of events ?? []) map.set(e.class_id, `${e.class_initial} · ${e.class_name}`)
    return [...map].map(([value, label]) => ({ value, label }))
  }, [events])

  // The class and kind filters only make sense against class events, so they
  // never touch work dates — which is also why work dates ignore them.
  const classShown = useMemo(
    () =>
      scope === 'work'
        ? []
        : (events ?? [])
            .filter((e) => (classFilter ? e.class_id === classFilter : true))
            .filter((e) => (kindFilter ? e.kind === kindFilter : true)),
    [events, classFilter, kindFilter, scope],
  )
  // Work dates are all `project_due`, so a kind filter narrowed to any other
  // kind is a class-only view — task_due, project_release and submitted never
  // apply to work. With no kind filter (All) or with project_due itself, work
  // dates still show.
  const workVisible = !kindFilter || kindFilter === 'project_due'
  const workShown = useMemo(
    () => (scope === 'classes' || !workVisible ? [] : workEvents),
    [scope, workVisible, workEvents],
  )
  const shown = useMemo(
    () => [...classShown, ...workShown].sort((a, b) => a.at.localeCompare(b.at)),
    [classShown, workShown],
  )

  const bands = useMemo(
    () => (classFilter ? weeks.filter((w) => w.class_id === classFilter) : weeks),
    [weeks, classFilter],
  )

  function showTask(id: string | null) {
    const next = new URLSearchParams(params)
    if (id) next.set('task', id)
    else next.delete('task')
    setParams(next, { replace: !id })
  }

  function open(event: CalendarEvent) {
    if (!event.class_id) {
      navigate(`${paths.project(event.project_id)}?task=${event.ref_id}`)
      return
    }
    if (event.task_id) return showTask(event.task_id)
    navigate(paths.classProject(event.project_id))
  }

  // A General failure settles the work side rather than holding the class
  // side hostage — the error Alert below shows it, with a retry, and the
  // class calendar still renders.
  const loaded =
    events !== null && myProjects !== null && (dashData !== null || dashError !== null)
  const loadError = error ?? navError ?? dashError

  if (!role || !loaded) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the calendar…
      </div>
    )
  }

  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Plan the"
        accent="term."
        description={
          staff && hasClassDates
            ? 'Deadlines and releases across your classes, mapped against the syllabus weeks they belong to.'
            : role === 'student'
              ? 'See every deadline across your classes and the syllabus week behind each one.'
              : 'Every due date across the projects you are part of.'
        }
        stats={
          scope === 'work'
            ? [{ value: shown.length, label: 'Dates in view' }]
            : [
                { value: shown.length, label: 'Dates in view' },
                { value: classes.length, label: 'Classes represented' },
              ]
        }
      />

      {loadError && (
        <Alert tone="error" onRetry={() => void Promise.all([load(), reloadNav(), reloadDash()])}>
          {loadError}
        </Alert>
      )}

      <section className="overflow-hidden rounded-panel border border-line surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line surface-sunken px-4 py-3 sm:px-5">
          <div className="flex gap-1 rounded-lg border border-line bg-[var(--surface)] p-0.5">
            {(['month', 'agenda'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
                  view === v
                    ? 'bg-navy-950 font-medium text-white dark:bg-navy-700'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <Icon name={v === 'month' ? 'calendar' : 'board'} size={15} />
                {v}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {classScope && (
              <ScopeFilter
                value={scope}
                onChange={(next) => setParams(writeScope(params, next), { replace: true })}
                counts={{
                  all: (events?.length ?? 0) + workEvents.length,
                  classes: events?.length ?? 0,
                  work: workEvents.length,
                }}
              />
            )}

            {scope !== 'work' && (
              <FilterPopover
                active={[classFilter, kindFilter].filter(Boolean).length}
                summary={[
                  classes.find((c) => c.value === classFilter)?.label,
                  CALENDAR_KINDS.find((k) => k.value === kindFilter)?.label,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={() => {
                  setClassFilter('')
                  setKindFilter('')
                }}
                label="Filter the calendar"
                align="right"
              >
                {classes.length > 1 && (
                  <FilterField label="Class">
                    <Select
                      value={classFilter}
                      onChange={(e) => setClassFilter(e.target.value)}
                      placeholder="Every class"
                      options={classes}
                      className="!h-10 !text-[13px]"
                    />
                  </FilterField>
                )}
                <FilterField label="What to show">
                  <Select
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    placeholder="Everything"
                    options={CALENDAR_KINDS.filter(
                      (k) =>
                        (staff && k.value !== 'task_due') ||
                        (!staff && k.value !== 'project_release'),
                    )}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
              </FilterPopover>
            )}
          </div>
        </div>

        {view === 'month' ? (
          <div className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium text-faint">Month overview</p>
                <h2 className="mt-1">{monthLabel}</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="!h-8 !rounded-lg !px-2.5"
                  onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                >
                  <Icon name="chevronLeft" size={15} />
                  <span className="sr-only">Previous month</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-8 !rounded-lg !px-3"
                  onClick={() => {
                    const now = new Date()
                    setMonth(new Date(now.getFullYear(), now.getMonth(), 1))
                  }}
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="!h-8 !rounded-lg !px-2.5"
                  onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                >
                  <Icon name="chevronRight" size={15} />
                  <span className="sr-only">Next month</span>
                </Button>
              </div>
            </div>

            {scope !== 'work' && (
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 border-y border-line py-2.5">
                {CALENDAR_KINDS.filter(
                  (kind) =>
                    (staff && kind.value !== 'task_due') ||
                    (!staff && kind.value !== 'project_release'),
                ).map((kind) => (
                  <span key={kind.value} className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className={`h-1.5 w-1.5 rounded-full ${eventDot(kind.value)}`} />
                    {kind.label}
                  </span>
                ))}
              </div>
            )}

            <MonthGrid month={month} events={shown} weeks={bands} onOpen={open} />
          </div>
        ) : (
          <div className="p-4 sm:p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
              <div>
                <p className="text-[12px] font-medium text-faint">Chronological view</p>
                <h2 className="mt-1">Upcoming dates</h2>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={showPast}
                  onChange={(e) => setShowPast(e.target.checked)}
                  className="accent-navy-600"
                />
                Include past dates
              </label>
            </div>
            <AgendaList events={shown} onOpen={open} showPast={showPast} />
          </div>
        )}
      </section>

      <TaskDetailModal
        taskId={openTask}
        onClose={() => showTask(null)}
        viewerId={profile?.id}
        role={role === 'student' ? 'student' : 'professor'}
        boardWeight={0}
        onChanged={load}
      />
    </div>
  )
}
