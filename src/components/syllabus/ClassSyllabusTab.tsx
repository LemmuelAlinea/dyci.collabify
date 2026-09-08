import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Link } from 'react-router-dom'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { WeekMap } from './WeekMap'
import { ShiftWeeksDialog } from './ShiftWeeksDialog'
import { ShiftImpactDialog } from './ShiftImpactDialog'
import {
  applyShiftToDeadlines,
  classWeekMap,
  listWeekShifts,
  setTermDates,
  shiftClassWeeks,
  shiftImpact,
  siblingClasses,
} from '../../lib/api/syllabus'
import type { ShiftImpact } from '../../lib/api/syllabus'
import { authErrorMessage } from '../../lib/authError'
import { localDay } from '../../lib/termShift'
import type { ClassRow, ClassSummary, ClassWeek, WeekShift } from '../../lib/types'

/** A sibling class offered the same shift. Only what the sentence needs. */
type Sibling = Pick<ClassRow, 'id' | 'name' | 'initial' | 'section' | 'term_start' | 'syllabus_id'>

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
  const [shifts, setShifts] = useState<WeekShift[]>([])
  const [error, setError] = useState<string | null>(null)

  /**
   * The shift runs as three steps, so three pieces of state.
   *
   * `moving` is the week whose date is being changed. `impact` is what that
   * shift stranded, held until the professor has answered it. `offer` is the
   * sibling classes, raised last so it never competes with the deadline
   * question for attention.
   */
  const [moving, setMoving] = useState<ClassWeek | null>(null)
  const [impact, setImpact] = useState<{ shiftId: string; rows: ShiftImpact[]; days: number } | null>(null)
  const [offer, setOffer] = useState<{ siblings: Sibling[]; from: number; days: number; reason: string } | null>(null)
  const [offering, setOffering] = useState(false)
  const [start, setStart] = useState(cls.term_start ?? '')
  const [end, setEnd] = useState(cls.term_end ?? '')
  const [saving, setSaving] = useState(false)
  // A term that is already set reads back as a sentence; the form is what you
  // open to change it, not what greets you every time.
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [map, recorded] = await Promise.all([classWeekMap(cls.id), listWeekShifts(cls.id)])
      setWeeks(map)
      setShifts(recorded)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the week map.'))
      setWeeks([])
    }
  }, [cls.id])

  /**
   * Move a week, then deal with what that left behind.
   *
   * The weeks move first and unconditionally: the term did change, and holding
   * that back until the deadline question is answered would leave a professor
   * looking at dates they know are wrong. Everything after it is a follow-up
   * they can decline.
   */
  async function onShift(week: ClassWeek, days: number, reason: string) {
    const shift = await shiftClassWeeks(cls.id, week.week_no, days, reason)
    setMoving(null)
    show(`Week ${week.week_no} onwards moved`)
    await Promise.all([load(), onClassChanged?.()])

    // Best effort, both of them. The shift is already recorded; a failure here
    // costs a follow-up prompt, not the edit.
    try {
      const rows = await shiftImpact(shift.id)
      if (rows.length > 0) setImpact({ shiftId: shift.id, rows, days })
      else await raiseSiblingOffer(week.week_no, days, reason)
    } catch {
      await raiseSiblingOffer(week.week_no, days, reason)
    }
  }

  async function raiseSiblingOffer(from: number, days: number, reason: string) {
    try {
      const siblings = await siblingClasses(cls)
      if (siblings.length > 0) setOffer({ siblings, from, days, reason })
    } catch {
      // A missing offer is a missing convenience, not a failure worth a banner.
    }
  }

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
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
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
        <div className="card p-4 sm:p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink">Term dates</p>
              {termSet && !editing ? (
                <p className="mt-1 text-[13px] text-muted">
                  <span className="text-ink">{termLabel(cls.term_start, cls.term_end)}</span>
                  {' · '}
                  {termWeeks(cls.term_start, cls.term_end)} weeks. Week 1 starts on the first
                  date.
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-muted">
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
          <WeekMap weeks={weeks} shifts={shifts} />
        </>
      ) : (
        <WeekMap
          weeks={weeks}
          shifts={shifts}
          onMoveWeek={role === 'professor' ? setMoving : undefined}
        />
      )}

      {role === 'professor' && weeks.length > 0 && (
        <Link
          to={`/professor/syllabi/${cls.syllabus_id}`}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          <Icon name="edit" size={14} />
          Edit the syllabus weeks
        </Link>
      )}

      {moving && (
        <ShiftWeeksDialog
          week={moving}
          weeksAfter={weeks.filter((w) => w.week_no >= moving.week_no).length}
          onClose={() => setMoving(null)}
          onShift={(days, reason) => onShift(moving, days, reason)}
        />
      )}

      {impact && (
        <ShiftImpactDialog
          rows={impact.rows}
          days={impact.days}
          onClose={() => setImpact(null)}
          onApply={async (projectIds, taskIds) => {
            const moved = await applyShiftToDeadlines(impact.shiftId, projectIds, taskIds)
            setImpact(null)
            show(`${moved} ${moved === 1 ? 'deadline' : 'deadlines'} moved`)
            await load()
          }}
        />
      )}

      {/*
        Raised last, and as a banner rather than a third modal. A school-wide
        closure hit every section, but a section that genuinely runs on another
        calendar must never be re-dated by a click meant for this one — so each
        is named, and doing nothing is the default.
      */}
      {offer && (
        <Alert tone="info">
          {offer.siblings.map((s) => `${s.initial} ${s.section}`).join(' and ')}{' '}
          {offer.siblings.length === 1 ? 'uses' : 'use'} the same syllabus and started on the same
          day.{' '}
          <button
            type="button"
            disabled={offering}
            onClick={async () => {
              setOffering(true)
              try {
                for (const sib of offer.siblings) {
                  await shiftClassWeeks(sib.id, offer.from, offer.days, offer.reason)
                }
                show(`Moved ${offer.siblings.length === 1 ? 'it' : 'them'} too`)
                setOffer(null)
              } catch (err) {
                show(authErrorMessage(err, 'Could not move the other class.'), 'error')
              } finally {
                setOffering(false)
              }
            }}
            className="font-semibold underline underline-offset-2 disabled:opacity-60"
          >
            Move {offer.siblings.length === 1 ? 'it' : 'them'} the same way
          </button>{' '}
          <button
            type="button"
            onClick={() => setOffer(null)}
            className="text-muted underline underline-offset-2"
          >
            No, just this one
          </button>
        </Alert>
      )}
    </div>
  )
}

/** `localDay` rather than `new Date`: see the note on it in lib/termShift.ts. */
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
