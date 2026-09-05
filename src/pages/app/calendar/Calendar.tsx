import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AgendaList } from '../../../components/calendar/AgendaList'
import { MonthGrid } from '../../../components/calendar/MonthGrid'
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
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the calendar…
      </div>
    )
  }

  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{role === 'professor' ? 'Teaching' : 'Workspace'}</p>
        <h1 className="mt-1 leading-tight">Calendar</h1>
        <p className="mt-2 max-w-[64ch] text-[14px] text-muted">
          {role === 'professor'
            ? 'Deadlines and releases across your classes, laid over the syllabus weeks they were built on. A week that names an assessment with nothing under it is a gap.'
            : 'Everything your classes have due, laid over the syllabus weeks it comes from.'}
        </p>
      </header>

      {error && <Alert tone="error" onRetry={load}>{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg surface-sunken p-0.5">
          {(['month', 'agenda'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] capitalize transition-colors ${
                view === v ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 className=" sm:">{monthLabel}</h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="!rounded-lg"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              >
                <Icon name="chevronLeft" size={15} />
                <span className="sr-only">Previous month</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="!rounded-lg"
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
                className="!rounded-lg"
                onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              >
                <Icon name="chevronRight" size={15} />
                <span className="sr-only">Next month</span>
              </Button>
            </div>
          </div>
          <MonthGrid month={month} events={shown} weeks={bands} onOpen={open} />
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
              className="accent-navy-600"
            />
            Include dates that have gone by
          </label>
          <AgendaList events={shown} onOpen={open} showPast={showPast} />
        </div>
      )}

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
