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
import { useAuth } from '../../../context/AuthContext'
import { listCalendar, listWeekBands } from '../../../lib/api/calendar'
import { authErrorMessage } from '../../../lib/authError'
import { CALENDAR_KINDS } from '../../../lib/types'
import type { CalendarEvent, ClassWeek } from '../../../lib/types'

type View = 'month' | 'agenda'

/**
 * Every dated thing across a viewer's classes, over the syllabus that produced
 * it. What each role sees is decided by the database, not here — the view is
 * security_invoker, so a student's own policies already keep other groups' work
 * and unreleased projects out.
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
  const openTask = params.get('task')

  const load = useCallback(async () => {
    if (!role || role === 'admin') return
    try {
      const rows = await listCalendar(role)
      setEvents(rows)
      setWeeks(await listWeekBands([...new Set(rows.map((r) => r.class_id))]))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the calendar.'))
      setEvents([])
    }
  }, [role])

  useEffect(() => {
    document.title = 'Calendar · Collabify'
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['projects', 'project_tasks', 'project_boards', 'syllabus_weeks', 'classes'])

  const classes = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of events ?? []) map.set(e.class_id, `${e.class_initial} · ${e.class_name}`)
    return [...map].map(([value, label]) => ({ value, label }))
  }, [events])

  const shown = useMemo(
    () =>
      (events ?? [])
        .filter((e) => (classFilter ? e.class_id === classFilter : true))
        .filter((e) => (kindFilter ? e.kind === kindFilter : true)),
    [events, classFilter, kindFilter],
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
    if (event.task_id) return showTask(event.task_id)
    const base = role === 'professor' ? '/professor' : '/student'
    navigate(`${base}/projects/${event.project_id}`)
  }

  if (!role || role === 'admin') {
    return (
      <Alert tone="info">
        The calendar follows classes, so it is for students and professors.
      </Alert>
    )
  }

  if (events === null) {
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
          role === 'professor'
            ? 'Deadlines and releases across your classes, mapped against the syllabus weeks they belong to.'
            : 'See every deadline across your classes and the syllabus week behind each one.'
        }
        stats={[
          { value: shown.length, label: 'Dates in view' },
          { value: classes.length, label: 'Classes represented' },
        ]}
      />

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

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
                    (role === 'professor' && k.value !== 'task_due') ||
                    (role !== 'professor' && k.value !== 'project_release'),
                )}
                className="!h-10 !text-[13px]"
              />
            </FilterField>
          </FilterPopover>
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

            <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 border-y border-line py-2.5">
              {CALENDAR_KINDS.filter(
                (kind) =>
                  (role === 'professor' && kind.value !== 'task_due') ||
                  (role !== 'professor' && kind.value !== 'project_release'),
              ).map((kind) => (
                <span key={kind.value} className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className={`h-1.5 w-1.5 rounded-full ${eventDot(kind.value)}`} />
                  {kind.label}
                </span>
              ))}
            </div>

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
        role={role}
        boardWeight={0}
        onChanged={load}
      />
    </div>
  )
}
