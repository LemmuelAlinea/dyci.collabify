import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Alert, Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { WeekMap } from './WeekMap'
import { classWeekMap, setTermDates } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, ClassWeek } from '../../lib/types'

export function ClassSyllabusTab({
  cls,
  role,
  onClassChanged,
}: {
  cls: ClassSummary
  role: 'professor' | 'student'
  onClassChanged?: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [weeks, setWeeks] = useState<ClassWeek[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [start, setStart] = useState(cls.term_start ?? '')
  const [end, setEnd] = useState(cls.term_end ?? '')
  const [saving, setSaving] = useState(false)
  // A term that is already set reads back as a sentence; the form is what you
  // open to change it, not what greets you every time.
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      setWeeks(await classWeekMap(cls.id))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the week map.'))
      setWeeks([])
    }
  }, [cls.id])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['teaching_resources', 'syllabus_weeks', 'classes'])

  useEffect(() => {
    setStart(cls.term_start ?? '')
    setEnd(cls.term_end ?? '')
  }, [cls.term_start, cls.term_end])

  const termSet = Boolean(cls.term_start && cls.term_end)

  if (weeks === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading week map…
      </div>
    )
  }

  if (!cls.syllabus_id) {
    return (
      <EmptyState
        icon="file"
        title="No syllabus on this class"
        body={
          role === 'professor'
            ? 'Assign a syllabus in the class settings, then its weeks appear here as the term map.'
            : 'Your professor has not attached a syllabus to this class yet.'
        }
        action={
          role === 'professor' ? (
            <Link
              to="/professor/syllabi"
              className="text-[14px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              Go to Syllabi
            </Link>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      {role === 'professor' && (
        <div className="surface rounded-card border border-line p-4 sm:p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-ink">Term dates</p>
              {termSet && !editing ? (
                <p className="mt-1 text-[13.5px] text-muted">
                  <span className="text-ink">{termLabel(cls.term_start, cls.term_end)}</span>
                  {' · '}
                  {termWeeks(cls.term_start, cls.term_end)} weeks. Week 1 starts on the first
                  date.
                </p>
              ) : (
                <p className="mt-1 text-[13.5px] text-muted">
                  Week 1 starts on the first date. Every other week is counted from it.
                </p>
              )}
            </div>
            {termSet && !editing && (
              <Button
                variant="outline"
                size="sm"
                className="!rounded-xl"
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size={14} />
                Change
              </Button>
            )}
          </div>

          {(!termSet || editing) && (
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Term starts">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Term ends">
                {(id) => (
                  <Input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                )}
              </Field>
              <div className="flex gap-2">
                <Button
                  className="!rounded-xl"
                  loading={saving}
                  onClick={async () => {
                    setSaving(true)
                    try {
                      await setTermDates(cls.id, start, end)
                      show('Term dates saved')
                      setEditing(false)
                      await Promise.all([load(), onClassChanged?.()])
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not save the dates.'), 'error')
                    } finally {
                      setSaving(false)
                    }
                  }}
                >
                  Save dates
                </Button>
                {termSet && (
                  <Button
                    variant="ghost"
                    className="!rounded-xl"
                    onClick={() => {
                      setStart(cls.term_start ?? '')
                      setEnd(cls.term_end ?? '')
                      setEditing(false)
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {weeks.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="The syllabus has no weeks yet"
          body={
            role === 'professor'
              ? 'Open the syllabus and read it with AI, or add its weeks by hand. They show up here as the term map.'
              : 'Your professor is still setting up the week map for this class.'
          }
          action={
            role === 'professor' ? (
              <Link
                to={`/professor/syllabi/${cls.syllabus_id}`}
                className="text-[14px] font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                Open the syllabus
              </Link>
            ) : undefined
          }
        />
      ) : !cls.term_start ? (
        <>
          <Alert tone="info">
            {role === 'professor'
              ? 'Set the term dates above and each week gets its real calendar dates.'
              : 'Your professor has not set the term dates, so these weeks have no dates yet.'}
          </Alert>
          <WeekMap weeks={weeks} />
        </>
      ) : (
        <WeekMap weeks={weeks} />
      )}

      {role === 'professor' && weeks.length > 0 && (
        <Link
          to={`/professor/syllabi/${cls.syllabus_id}`}
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          <Icon name="edit" size={14} />
          Edit the syllabus weeks
        </Link>
      )}
    </div>
  )
}

/**
 * A plain date column arrives as "2026-07-20". `new Date` on that reads it as
 * UTC midnight, which is the previous day anywhere west of Greenwich, so the
 * parts are put together by hand.
 */
function termLabel(from: string | null, to: string | null) {
  if (!from || !to) return ''
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
  return `${localDay(from).toLocaleDateString(undefined, opts)} – ${localDay(to).toLocaleDateString(undefined, opts)}`
}

function termWeeks(from: string | null, to: string | null) {
  if (!from || !to) return 0
  const days = (localDay(to).getTime() - localDay(from).getTime()) / 86_400_000
  return Math.max(1, Math.ceil((days + 1) / 7))
}

function localDay(value: string) {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
