// src/components/general/WorkloadPlanDialog.tsx
import { useEffect, useMemo, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import { draftBreakdown } from '../../lib/api/workAi'
import {
  applyBreakdown,
  breakdownContext,
  spacePeopleHours,
  spacePeopleLoad,
  type ApplyRow,
  type BreakdownContext,
} from '../../lib/api/workload'
import { formatDayLabel, formatHours, manilaToday, parseHours, workWeek } from '../../lib/work/hours'
import {
  balanceWorkPlan,
  dependencyGroups,
  projectedTotals,
  type Candidate,
  type Pick,
  type PlanRow,
} from '../../../supabase/functions/_shared/workloadPlan.ts'

/**
 * Break down and balance: pick the window and people, let the AI draft the
 * subtasks, review the recommended owners against each person's hours, then
 * create everything in one save. Nothing is written before Create.
 */

type Window = { from: string; to: string }
type ReviewRow = PlanRow & { hoursText: string; startsOn: string; dueOn: string }
type Unestimated = { id: string; count: number }

const MIN_ROWS = 2
const MAX_ROWS = 12
const DAY = 86_400_000

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/** The parent's start to due date as Manila dates, when it has both and they make a window. */
function parentWindow(parent: BreakdownContext['parent']): Window | null {
  if (!parent.starts_at || !parent.due_at) return null
  const from = manilaToday(new Date(parent.starts_at))
  const to = manilaToday(new Date(parent.due_at))
  return from <= to && daysBetween(from, to) <= 366 ? { from, to } : null
}

/** Minutes as the number typed in an hours field: 90 -> "1.5". */
const hoursText = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100)

/** "14" from 840 minutes, for "14 / 16 h". */
const hoursNumber = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10)

const names = (list: string[]) =>
  list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`

/**
 * Each person's numbers for the review: tags, position names, load and available
 * minutes, and how many open tasks they hold with no estimate. The parent is left
 * out: once its subtasks exist it stops counting, and apply_work_breakdown's
 * recheck leaves it out the same way.
 */
async function loadPeople(spaceId: string, ctx: BreakdownContext, ids: string[], win: Window) {
  const [load, hours] = await Promise.all([
    spacePeopleLoad(spaceId, win.from, win.to, ids, ctx.parent.id),
    spacePeopleHours(spaceId, win.from, win.to, ids),
  ])
  const positionName = new Map(ctx.positions.map((p) => [p.id, p.name]))
  const people: Candidate[] = ctx.candidates
    .filter((c) => ids.includes(c.user_id))
    .map((c) => ({
      id: c.user_id,
      name: c.name || 'Unnamed member',
      tags: c.tags,
      positions: c.position_ids.flatMap((id) => positionName.get(id) ?? []),
      loadMinutes: load.filter((l) => l.user_id === c.user_id).reduce((sum, l) => sum + l.load_minutes, 0),
      availableMinutes: hours.find((h) => h.user_id === c.user_id)?.available_minutes ?? null,
    }))
  // Counted per person: the load rows can't tell when two people hold the same task.
  const unestimated: Unestimated[] = people
    .map((p) => ({ id: p.id, count: load.filter((l) => l.user_id === p.id).reduce((sum, l) => sum + l.unestimated, 0) }))
    .filter((u) => u.count > 0)
  return { people, unestimated }
}

/** Recommends owners for every row the planner has not chosen; pins stay. */
function balance(rows: ReviewRow[], people: Candidate[]) {
  const picks = balanceWorkPlan(rows, people)
  const byKey = new Map(picks.map((p) => [p.key, p]))
  return {
    rows: rows.map((r) => (r.pinned ? r : { ...r, owner: byKey.get(r.key)?.owner ?? null })),
    notes: Object.fromEntries(picks.map((p) => [p.key, p])) as Record<string, Pick>,
  }
}

export function WorkloadPlanDialog({
  parentId,
  projectId,
  spaceId,
  parentEstimateMinutes,
  onClose,
  onSaved,
}: {
  parentId: string
  projectId: string
  spaceId: string
  /** The parent's own estimate, shown beside the subtasks' total. */
  parentEstimateMinutes?: number | null
  onClose: () => void
  onSaved: (ids: string[]) => void
}) {
  const [ctx, setCtx] = useState<BreakdownContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<'setup' | 'review'>('setup')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  // The window the rows were drafted for; Create saves against it.
  const [win, setWin] = useState<Window | null>(null)
  const [people, setPeople] = useState<Candidate[]>([])
  const [unestimated, setUnestimated] = useState<Unestimated[]>([])
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [notes, setNotes] = useState<Record<string, Pick>>({})
  const [openRow, setOpenRow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<{ message: string; detail?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    const week = workWeek()
    breakdownContext(parentId, week.from, week.to)
      .then((c) => {
        if (!live) return
        const w = parentWindow(c.parent) ?? week
        const eligible = new Set(c.candidates.map((x) => x.user_id))
        setCtx(c)
        setFrom(w.from)
        setTo(w.to)
        setSelected(c.parent.holder_ids.filter((id) => eligible.has(id)))
      })
      .catch((err) => live && setLoadError(authErrorMessage(err, 'Could not open the breakdown. Close it and try again.')))
    return () => {
      live = false
    }
  }, [parentId])

  const close = () => {
    if (!saving) onClose()
  }

  /** Cancel in setup after "Change window or people": back to the review as it was. */
  function backToReview() {
    if (!win) return
    setFrom(win.from)
    setTo(win.to)
    setSelected(people.map((p) => p.id))
    setError(null)
    setStep('review')
  }

  const chosenIds = ctx ? ctx.candidates.map((c) => c.user_id).filter((id) => selected.includes(id)) : []

  function windowError(): string | null {
    if (!from || !to || from > to) return 'Choose a start date on or before the end date.'
    if (daysBetween(from, to) > 366) return 'Choose a window of a year or less.'
    if (chosenIds.length === 0) return 'Choose at least one person for the plan.'
    return null
  }

  /** Step 2: the AI drafts the rows, then owners are recommended. */
  async function draft() {
    if (!ctx || busy) return
    const problem = windowError()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const w = { from, to }
    try {
      const [res, numbers] = await Promise.all([
        draftBreakdown(projectId, parentId, w.from, w.to),
        loadPeople(spaceId, ctx, chosenIds, w),
      ])
      if (res.result === 'failed') return setError(res.message)
      const drafted: ReviewRow[] = res.rows.map((r) => ({
        ...r,
        dependsOn: ctx.parent.allow_dependencies ? r.dependsOn : [],
        owner: null,
        pinned: false,
        hoursText: hoursText(r.minutes),
        startsOn: w.from,
        dueOn: w.to,
      }))
      const next = balance(drafted, numbers.people)
      setPeople(numbers.people)
      setUnestimated(numbers.unestimated)
      setRows(next.rows)
      setNotes(next.notes)
      setWin(w)
      setStep('review')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not draft the breakdown. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Reloads the people's numbers (and, from Review again, the task) for the
   * chosen window and people, keeps the rows and pins, and rebalances. Owners
   * who left the plan go back to unassigned.
   */
  async function refresh(opts: { reloadContext: boolean }) {
    if (!ctx || !win || busy) return
    const problem = windowError()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const w = { from, to }
    try {
      const c = opts.reloadContext ? await breakdownContext(parentId, w.from, w.to) : ctx
      if (c.blocked) {
        setCtx(c)
        setSaveError({ message: c.blocked })
        return
      }
      const eligible = new Set(c.candidates.map((x) => x.user_id))
      const ids = c.candidates.map((x) => x.user_id).filter((id) => selected.includes(id) && eligible.has(id))
      const numbers = await loadPeople(spaceId, c, ids, w)
      const kept = new Set(numbers.people.map((p) => p.id))
      const moved = rows.map((r) => ({
        ...r,
        ...(r.owner && !kept.has(r.owner) ? { owner: null, pinned: false } : {}),
        startsOn: r.startsOn === win.from ? w.from : r.startsOn,
        dueOn: r.dueOn === win.to ? w.to : r.dueOn,
      }))
      const next = balance(moved, numbers.people)
      setCtx(c)
      setSelected(ids)
      setPeople(numbers.people)
      setUnestimated(numbers.unestimated)
      setRows(next.rows)
      setNotes(next.notes)
      setWin(w)
      setSaveError(null)
      setStep('review')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not reload the plan. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  function rebalance() {
    const next = balance(rows, people)
    setRows(next.rows)
    setNotes(next.notes)
  }

  /**
   * Allocator notes describe the plan as it was balanced. A change to who
   * carries how much (minutes, owner, an owned row removed) makes any of them
   * stale, so all go until the next Rebalance; a label change drops only that
   * row's. Live capacity warnings on the rows never go stale.
   */
  const dropNotes = (key?: string) =>
    setNotes((n) => {
      if (key === undefined) return {}
      const rest = { ...n }
      delete rest[key]
      return rest
    })

  function update(key: string, patch: Partial<ReviewRow>) {
    const row = rows.find((r) => r.key === key)
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    if (!row) return
    if (('minutes' in patch && patch.minutes !== row.minutes) || ('owner' in patch && patch.owner !== row.owner)) dropNotes()
    else if ('tags' in patch || 'position' in patch) dropNotes(key)
  }

  function setHours(key: string, text: string) {
    const parsed = parseHours(text)
    update(key, typeof parsed === 'number' ? { hoursText: text, minutes: parsed } : { hoursText: text })
  }

  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key).map((r) => ({ ...r, dependsOn: r.dependsOn.filter((d) => d !== key) })))
    if (openRow === key) setOpenRow(null)
    dropNotes(rows.find((r) => r.key === key)?.owner ? undefined : key)
  }

  function addRow() {
    let n = rows.length + 1
    while (rows.some((r) => r.key === `new-${n}`)) n += 1
    const row: ReviewRow = {
      key: `new-${n}`, title: '', description: '', minutes: 60, tags: [], position: null, dependsOn: [],
      owner: null, pinned: false, hoursText: '1', startsOn: win?.from ?? from, dueOn: win?.to ?? to,
    }
    setRows((rs) => [...rs, row])
    setOpenRow(row.key)
  }

  async function save() {
    if (!win || saving) return
    setError(null)
    setSaveError(null)
    const payload: ApplyRow[] = []
    for (const [i, r] of rows.entries()) {
      const title = r.title.trim()
      if (!title) return setError(`Row ${i + 1} has no title. Add one, or remove the row.`)
      const minutes = parseHours(r.hoursText)
      if (typeof minutes !== 'number' || minutes < 15 || minutes > 4800) {
        return setError(`"${title}" needs an estimate from 15 minutes to 80 hours.`)
      }
      if (r.startsOn && r.dueOn && r.startsOn > r.dueOn) {
        return setError(`"${title}" starts after its due date. Change one of the dates.`)
      }
      payload.push({
        key: r.key,
        title,
        description: r.description.trim(),
        minutes,
        owner: r.owner,
        depends_on: r.dependsOn,
        starts_on: r.startsOn || null,
        due_on: r.dueOn || null,
        shown_load_minutes: r.owner ? (people.find((p) => p.id === r.owner)?.loadMinutes ?? 0) : null,
      })
    }
    setSaving(true)
    try {
      const ids = await applyBreakdown(parentId, win.from, win.to, payload)
      onSaved(ids)
    } catch (err) {
      const detail = (err as { details?: unknown } | null)?.details
      setSaveError({
        message: authErrorMessage(err, 'Could not create the subtasks. Try again.'),
        detail: typeof detail === 'string' && detail.trim() ? detail : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const blocked = ctx?.blocked ?? null
  const inReview = step === 'review' && Boolean(win)

  const footer = !ctx || (blocked && !inReview) ? (
    <Button variant="ghost" onClick={close}>Close</Button>
  ) : inReview ? (
    <>
      <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
      <Button onClick={() => void save()} loading={saving} disabled={saving || busy || rows.length < MIN_ROWS}>
        Create and assign {rows.length} subtasks
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={win ? backToReview : close} disabled={busy && Boolean(win)}>Cancel</Button>
      {win ? (
        <Button onClick={() => void refresh({ reloadContext: false })} loading={busy}>Update the review</Button>
      ) : (
        <Button onClick={() => void draft()} loading={busy}>
          {!busy && <Icon name="spark" size={15} />}
          Draft the breakdown
        </Button>
      )}
    </>
  )

  return (
    <Modal
      open
      onClose={close}
      title={ctx ? `Break down ${ctx.parent.title}` : 'Break down and balance'}
      description={inReview && win
        ? <span className="font-mono text-[12px]">Window: {formatDayLabel(win.from)} – {formatDayLabel(win.to)}</span>
        : 'Draft subtasks, recommend owners from each person’s hours, then create them in one step.'}
      size="xl"
      footer={footer}
    >
      {loadError ? (
        <Alert tone="error">{loadError}</Alert>
      ) : !ctx ? (
        <p className="flex items-center gap-2 text-[13px] text-muted"><Spinner size={16} /> Loading the task</p>
      ) : blocked && !inReview ? (
        <Alert tone="info">{blocked}</Alert>
      ) : inReview ? (
        <Review
          ctx={ctx}
          people={people}
          unestimated={unestimated}
          rows={rows}
          notes={notes}
          openRow={openRow}
          setOpenRow={setOpenRow}
          busy={busy || saving}
          error={error}
          saveError={saveError}
          parentEstimateMinutes={parentEstimateMinutes ?? null}
          onBack={() => { setError(null); setStep('setup') }}
          onRebalance={rebalance}
          onReviewAgain={() => void refresh({ reloadContext: true })}
          update={update}
          setHours={setHours}
          remove={remove}
          addRow={addRow}
        />
      ) : (
        <Setup
          ctx={ctx}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          selected={selected}
          setSelected={setSelected}
          error={error}
          redraft={Boolean(win)}
        />
      )}
    </Modal>
  )
}

function Setup({
  ctx,
  from,
  to,
  setFrom,
  setTo,
  selected,
  setSelected,
  error,
  redraft,
}: {
  ctx: BreakdownContext
  from: string
  to: string
  setFrom: (v: string) => void
  setTo: (v: string) => void
  selected: string[]
  setSelected: (ids: string[]) => void
  error: string | null
  redraft: boolean
}) {
  const fromParent = parentWindow(ctx.parent) !== null
  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <section className="space-y-3">
        <p className="eyebrow text-faint">Window</p>
        <div className="grid max-w-[28rem] gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-[13px] text-muted">
            <span>Starts</span>
            <Input type="date" aria-label="Window start" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-[13px] text-muted">
            <span>Ends</span>
            <Input type="date" aria-label="Window end" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <p className="text-[12px] text-faint">
          {fromParent ? 'From the task’s start and due dates.' : 'The task has no start and due dates, so this week is used. Change it if you need to.'}
        </p>
      </section>
      <section className="space-y-3">
        <p className="eyebrow text-faint">People</p>
        {ctx.candidates.length === 0 ? (
          <p className="text-[13px] text-muted">
            {ctx.parent.task_flow === 'planned'
              ? 'No one on the receiving team can take tasks. Add members to the team, then try again.'
              : 'No one on this project can take tasks. Add members, then try again.'}
          </p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ctx.candidates.map((c) => {
                const on = selected.includes(c.user_id)
                return (
                  <li key={c.user_id}>
                    {/* The name gets its own line; skills sit under it, so a long skill list never hides who it is. */}
                    <label className="flex h-full cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px] text-ink hover:bg-[var(--surface-sunken)]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected(on ? selected.filter((id) => id !== c.user_id) : [...selected, c.user_id])}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-navy-600"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name || 'Unnamed member'}</span>
                        {c.tags.length > 0 && (
                          <span title={c.tags.join(', ')} className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-faint">
                            {c.tags.join(', ')}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="text-[12px] text-faint">
              {ctx.parent.task_flow === 'planned' ? 'Members of the receiving team.' : 'Everyone on the project who can take tasks.'}
              {' '}The task&apos;s holders start selected.
            </p>
          </>
        )}
      </section>
      <p className="text-[12px] text-muted">
        {redraft
          ? 'Update the review to reload hours for this window and these people. Your rows and chosen owners stay.'
          : 'The AI drafts the subtasks from the task’s title and description. It never sees names or hours. Nothing is saved until you create the subtasks.'}
      </p>
    </div>
  )
}

type ReviewProps = {
  ctx: BreakdownContext
  people: Candidate[]
  unestimated: Unestimated[]
  rows: ReviewRow[]
  notes: Record<string, Pick>
  openRow: string | null
  setOpenRow: (key: string | null) => void
  busy: boolean
  error: string | null
  saveError: { message: string; detail?: string } | null
  parentEstimateMinutes: number | null
  onBack: () => void
  onRebalance: () => void
  onReviewAgain: () => void
  update: (key: string, patch: Partial<ReviewRow>) => void
  setHours: (key: string, text: string) => void
  remove: (key: string) => void
  addRow: () => void
}

function Review(props: ReviewProps) {
  const { ctx, people, unestimated, rows, busy, error, saveError, parentEstimateMinutes } = props
  const totals = projectedTotals(rows, people)
  const total = rows.reduce((sum, r) => sum + r.minutes, 0)
  // What the plan adds as a share of each person's hours: the spread at a glance.
  const shares = totals
    .filter((t) => t.available !== null && t.available > 0)
    .map((t) => `${people.find((p) => p.id === t.id)?.name ?? 'Unnamed member'} ${Math.round((t.added / t.available!) * 100)}%`)
  const groups = useMemo(() => {
    try {
      return dependencyGroups(rows)
    } catch {
      return null
    }
  }, [rows])
  const titleOf = (key: string) => rows.find((r) => r.key === key)?.title.trim() || 'an untitled subtask'

  return (
    <div className="space-y-5">
      {saveError && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-danger-200 bg-danger-50 px-3.5 py-3 text-[13px] leading-relaxed text-danger-800 dark:border-danger-500/40 dark:bg-danger-500/12 dark:text-danger-200">
          <Icon name="alert" size={17} className="mt-px shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{saveError.message}</p>
            {saveError.detail && <p className="mt-1">{saveError.detail}</p>}
            <p className="mt-1">Your edits are kept.</p>
          </div>
          <Button size="sm" variant="outline" onClick={props.onReviewAgain} loading={busy && !error}>Review again</Button>
        </div>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-[13px] text-muted">
          <span className="eyebrow mr-2 text-faint">People</span>
          {people.map((p) => p.name).join(' · ') || 'No one chosen'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={props.onBack} disabled={busy}>Change window or people</Button>
          <Button variant="outline" size="sm" onClick={props.onRebalance} disabled={busy}>
            <Icon name="refresh" size={14} />
            Rebalance
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-label="Hours per person" className="order-1 lg:order-2">
          <div className="space-y-4 rounded-xl border border-line surface-sunken p-4 lg:sticky lg:top-0">
            <p className="eyebrow text-faint">Hours in the window</p>
            <ul className="space-y-4">
              {totals.map((t) => (
                <PersonBar key={t.id} name={people.find((p) => p.id === t.id)?.name ?? ''} {...t} />
              ))}
            </ul>
            {unestimated.length > 0 && (
              <p className="border-t border-line pt-3 text-[12px] text-muted">
                Open tasks with no estimate:{' '}
                {unestimated.map((u) => `${people.find((p) => p.id === u.id)?.name ?? 'Unnamed member'} holds ${u.count}`).join(', ')}.
              </p>
            )}
          </div>
        </section>

        <section aria-label="Subtasks" className="order-2 min-w-0 space-y-5 lg:order-1">
          <p className="text-[12px] text-muted">
            <span className="font-mono text-ink">{rows.length}</span> subtasks ·{' '}
            <span className="font-mono text-ink">{formatHours(total)}</span> in all
            {parentEstimateMinutes != null && <> · the task&apos;s own estimate was <span className="font-mono text-ink">{formatHours(parentEstimateMinutes)}</span></>}
          </p>
          {shares.length > 0 && (
            <p className="text-[12px] text-muted">
              Share of each person’s hours from this plan:{' '}
              <span className="font-mono text-ink">{shares.join(' · ')}</span>
            </p>
          )}
          {!ctx.parent.allow_dependencies && (
            <p className="text-[12px] text-faint">Dependencies are off in this project, so every subtask can start now.</p>
          )}
          {rows.some((r) => !r.pinned && !props.notes[r.key]) && (
            <p className="text-[12px] text-faint">The plan changed since the last balance. Rebalance to see why each owner fits.</p>
          )}
          {(groups ?? [rows.map((r) => r.key)]).map((keys, gi) => {
            const prereqs = [...new Set(keys.flatMap((k) => rows.find((r) => r.key === k)?.dependsOn ?? []))]
              .sort((a, b) => rows.findIndex((r) => r.key === a) - rows.findIndex((r) => r.key === b))
            const label = !groups ? 'Subtasks'
              : gi === 0 ? 'Can start now'
              : prereqs.length <= 2 ? `After ${names(prereqs.map(titleOf))}`
              : `After ${prereqs.length} earlier subtasks`
            return (
              <div key={keys.join('|')} className="space-y-2">
                <h3 className="eyebrow text-faint">{label}</h3>
                <ul className="space-y-2">
                  {keys.map((key) => {
                    const row = rows.find((r) => r.key === key)!
                    return <RowCard key={key} row={row} index={rows.indexOf(row)} {...props} />
                  })}
                </ul>
              </div>
            )
          })}
          <Button variant="ghost" size="sm" onClick={props.addRow} disabled={busy || rows.length >= MAX_ROWS}>
            <Icon name="plus" size={14} />
            Add a subtask
          </Button>
        </section>
      </div>
    </div>
  )
}

const TONES = {
  success: { existing: 'bg-success-500/40', added: 'bg-success-500' },
  warning: { existing: 'bg-warning-500/40', added: 'bg-warning-500' },
  danger: { existing: 'bg-danger-500/40', added: 'bg-danger-500' },
}

function PersonBar({ name, existing, added, projected, available }: {
  name: string
  existing: number
  added: number
  projected: number
  available: number | null
}) {
  const known = available !== null
  const ratio = known ? (available > 0 ? projected / available : projected > 0 ? Infinity : 0) : 0
  const tone = ratio > 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success'
  const scale = Math.max(available ?? 0, projected, 1)
  const pct = (m: number) => `${Math.min(100, (m / scale) * 100)}%`
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="shrink-0 font-mono text-[13px] text-ink">
          {known ? `${hoursNumber(projected)} / ${formatHours(available)}` : `${formatHours(projected)} / Not set`}
        </span>
      </div>
      <p className="font-mono text-[11px] text-muted">
        {formatHours(existing)} existing + {formatHours(added)} added
      </p>
      {known ? (
        <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-[var(--surface)]">
          <div className={`${TONES[tone].existing} motion-safe:transition-[width]`} style={{ width: pct(existing) }} />
          <div className={`${TONES[tone].added} motion-safe:transition-[width]`} style={{ width: pct(added) }} />
        </div>
      ) : (
        <div aria-hidden="true" className="h-2 rounded-full bg-pending-soft ring-1 ring-inset ring-[var(--line)]" />
      )}
      <p className={`text-[12px] ${!known ? 'text-pending-ink' : tone === 'danger' ? 'text-danger-700 dark:text-danger-300' : 'text-muted'}`}>
        {!known
          ? 'Weekly hours not set.'
          : projected > available
            ? `${formatHours(projected - available)} over available hours.`
            : `${formatHours(available - projected)} free.`}
      </p>
    </li>
  )
}

function RowCard({ row, index, ...props }: ReviewProps & { row: ReviewRow; index: number }) {
  const { ctx, people, rows, notes, openRow, setOpenRow, busy, update, setHours, remove } = props
  const name = row.title.trim() || `row ${index + 1}`
  const open = openRow === row.key
  const parsed = parseHours(row.hoursText)
  const badHours = typeof parsed !== 'number' || parsed < 15 || parsed > 4800
  const pick = notes[row.key]
  const ownerName = row.owner ? people.find((p) => p.id === row.owner)?.name : undefined
  const note = row.pinned
    ? row.owner ? `You chose ${ownerName ?? 'this person'}.` : 'You left this unassigned.'
    : row.owner && pick && pick.owner === row.owner ? pick.note
    : !row.owner && pick && pick.owner === null ? pick.note
    : null
  const warn = !row.owner && !row.pinned
  // Live, from the current totals: the owner is over their hours, or has none set.
  const load = row.owner ? projectedTotals(rows, people).find((t) => t.id === row.owner) : undefined
  const capacity = !load || !ownerName ? null
    : load.available === null ? `${ownerName} has no weekly hours set.`
    : load.projected > load.available ? `${ownerName} is ${formatHours(load.projected - load.available)} over available hours.`
    : null

  // Rows that wait on this one, directly or not, cannot become its prerequisites.
  const waiting = new Set<string>()
  for (let grew = true; grew;) {
    grew = false
    for (const r of rows) {
      if (!waiting.has(r.key) && r.dependsOn.some((d) => d === row.key || waiting.has(d))) {
        waiting.add(r.key)
        grew = true
      }
    }
  }
  const prereqOptions = rows.filter((r) => r.key !== row.key && !waiting.has(r.key))

  return (
    <li className="rounded-xl border border-line bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`Title of row ${index + 1}`}
          value={row.title}
          maxLength={200}
          placeholder="Name this subtask"
          onChange={(e) => update(row.key, { title: e.target.value })}
          className="min-w-[12rem] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[14px] font-medium text-ink outline-none hover:border-line focus-visible:border-navy-400 focus-visible:ring-2 focus-visible:ring-navy-500/20"
        />
        <span className="flex items-center gap-1">
          <input
            aria-label={`Hours for ${name}`}
            aria-invalid={badHours || undefined}
            type="number"
            min={0.25}
            max={80}
            step="any"
            value={row.hoursText}
            onChange={(e) => setHours(row.key, e.target.value)}
            className={`h-9 w-16 rounded-lg border bg-[var(--surface)] px-2 text-right font-mono text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-navy-500/20 ${badHours ? 'border-danger-500' : 'border-[var(--control-line)]'}`}
          />
          <span className="font-mono text-[12px] text-muted">h</span>
        </span>
        <div className="w-[10.5rem]">
          <Select
            aria-label={`Owner of ${name}`}
            value={row.owner ?? ''}
            onChange={(e) => update(row.key, { owner: e.target.value || null, pinned: true })}
            placeholder="Unassigned"
            options={people.map((p) => ({ value: p.id, label: p.name }))}
            className="!h-9 !text-[13px]"
          />
        </div>
        <button
          type="button"
          aria-label={`Details for ${name}`}
          aria-expanded={open}
          onClick={() => setOpenRow(open ? null : row.key)}
          className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name={open ? 'chevronDown' : 'edit'} size={15} />
        </button>
        <button
          type="button"
          aria-label={`Remove ${name}`}
          disabled={busy || rows.length <= MIN_ROWS}
          onClick={() => remove(row.key)}
          className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-danger-600 disabled:opacity-40 dark:hover:text-danger-400"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1.5 text-[12px]">
        {row.position && <span className="rounded-md surface-sunken px-1.5 py-0.5 text-muted">{row.position}</span>}
        {row.tags.map((t) => <span key={t} className="rounded-md surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted">{t}</span>)}
        {note && <span className={warn ? 'text-warning-700 dark:text-warning-300' : 'text-muted'}>{note}</span>}
        {capacity && (
          <span className="inline-flex items-center gap-1 text-warning-700 dark:text-warning-300">
            <Icon name="alert" size={12} />
            {capacity}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-2">
          <label className="space-y-1.5 text-[12px] text-muted md:col-span-2">
            <span>Description</span>
            <Textarea
              rows={2}
              maxLength={2000}
              value={row.description}
              onChange={(e) => update(row.key, { description: e.target.value })}
              className="!text-[13px]"
            />
          </label>
          {ctx.tags.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-[12px] text-muted">Skill tags</legend>
              <div className="flex flex-wrap gap-1.5">
                {ctx.tags.map((t) => {
                  const on = row.tags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => update(row.key, { tags: on ? row.tags.filter((x) => x !== t) : [...row.tags, t] })}
                      className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${on ? 'border-navy-400 bg-navy-50 text-navy-700 dark:bg-navy-500/15 dark:text-navy-100' : 'border-line text-muted hover:text-ink'}`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}
          {ctx.positions.length > 0 && (
            <label className="space-y-1.5 text-[12px] text-muted">
              <span>Position</span>
              <Select
                value={row.position ?? ''}
                onChange={(e) => update(row.key, { position: e.target.value || null })}
                placeholder="Any position"
                options={[...new Set(ctx.positions.map((p) => p.name))].map((n) => ({ value: n, label: n }))}
                className="!h-9 !text-[13px]"
              />
            </label>
          )}
          {ctx.parent.allow_dependencies && (
            <fieldset className="space-y-1.5 md:col-span-2">
              <legend className="text-[12px] text-muted">Waits for</legend>
              {prereqOptions.length === 0 ? (
                <p className="text-[12px] text-faint">Every other subtask already waits for this one.</p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {prereqOptions.map((r) => {
                    const on = row.dependsOn.includes(r.key)
                    return (
                      <label key={r.key} className="flex items-center gap-2 text-[13px] text-ink">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => update(row.key, { dependsOn: on ? row.dependsOn.filter((d) => d !== r.key) : [...row.dependsOn, r.key] })}
                          className="h-4 w-4 accent-navy-600"
                        />
                        {r.title.trim() || 'Untitled subtask'}
                      </label>
                    )
                  })}
                </div>
              )}
            </fieldset>
          )}
          <label className="space-y-1.5 text-[12px] text-muted">
            <span>Starts</span>
            <Input type="date" value={row.startsOn} onChange={(e) => update(row.key, { startsOn: e.target.value })} className="!h-9 !text-[13px]" />
          </label>
          <label className="space-y-1.5 text-[12px] text-muted">
            <span>Due</span>
            <Input type="date" value={row.dueOn} onChange={(e) => update(row.key, { dueOn: e.target.value })} className="!h-9 !text-[13px]" />
          </label>
        </div>
      )}
    </li>
  )
}
