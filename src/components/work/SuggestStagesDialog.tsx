import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import { applyStagePlan, stagePlanContext } from '../../lib/api/workload'
import { draftStagePlan } from '../../lib/api/workAi'
import { plural } from '../../lib/plural'
import { formatDayLabel, formatHours } from '../../lib/work/hours'
import { stageText, type StageTerms } from '../../lib/work/stageTerms'
import {
  stageTotals,
  type StageContext,
  type StageDraft,
  type StageFlag,
  type StagePlacement,
} from '../../../supabase/functions/_shared/stagePlan.ts'

const LENGTHS = [7, 14, 21, 28].map((d) => ({ value: String(d), label: d === 7 ? '1 week' : `${d / 7} weeks` }))

/** Flag copy; sprint words go through stageText, and "won't fit" names the end date only when there is one. */
const flagText = (flag: StageFlag, hasEnd: boolean): string => ({
  late: "Can't meet its milestone or due date",
  overdue: 'Already due',
  over_hours: "Over this sprint's hours",
  wont_fit: hasEnd ? "Won't fit before the project ends" : "Won't fit in these sprints",
})[flag]

/** "16 Nov" from YYYY-MM-DD. */
const day = (date: string) => formatDayLabel(date).replace(/^\w+ /, '')
const hoursNumber = (minutes: number) => Math.round((minutes / 60) * 10) / 10

function weekdays(from: string, to: string) {
  let n = 0
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++
  }
  return n
}

/** "272 h of work · 100 h a week · ends 10 Jan": hours a week from the first stage's team hours. */
function summary(ctx: StageContext) {
  const first = ctx.stages[0]
  const days = first ? weekdays(first.starts_on, first.ends_on) : 0
  const weekly = first && days > 0 ? (first.capacity_minutes / days) * 5 : 0
  return [
    `${formatHours(ctx.total_minutes)} of work`,
    `${formatHours(weekly)} a week`,
    ctx.window.to ? `ends ${day(ctx.window.to)}` : 'no end date',
  ].join(' · ')
}

/**
 * Suggest stages: the numbers first (length, and a team in streams), then the
 * drafted plan to review and change, then Apply, which writes it all at once.
 * Nothing is written before Apply.
 */
export function SuggestStagesDialog({
  open,
  onClose,
  projectId,
  terms,
  teams,
  organization,
  onApplied,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  terms?: StageTerms
  teams: { id: string; name: string }[]
  organization: 'sequential' | 'streams' | 'parallel'
  /** After a save, with the message to show. */
  onApplied: (message: string) => void
}) {
  const txt = (copy: string) => stageText(copy, terms)
  const streams = organization === 'streams'
  const [team, setTeam] = useState<string | null>(null)
  const [length, setLength] = useState<number | null>(null)
  const [ctx, setCtx] = useState<StageContext | null>(null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<StageDraft | null>(null)
  const [names, setNames] = useState<{ name: string; goal: string }[]>([])
  const [placement, setPlacement] = useState<StagePlacement[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // The numbers for the chosen team and length.
  useEffect(() => {
    if (!open || (streams && !team)) return
    let current = true
    setLoading(true)
    setError(null)
    stagePlanContext(projectId, team, length)
      .then((c) => { if (current) setCtx(c) })
      .catch((err) => { if (current) setError(authErrorMessage(err, txt('Could not read the sprints. Try again.'))) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, projectId, team, length, streams]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [error])

  async function suggest() {
    setBusy(true)
    setError(null)
    try {
      const out = await draftStagePlan(projectId, team, length ?? ctx?.length_days ?? null)
      if (out.result === 'failed') {
        setError(out.message)
        return
      }
      setDraft(out)
      setNames(out.names)
      setPlacement(out.placement)
    } catch (err) {
      setError(authErrorMessage(err, txt('Could not suggest sprints. Try again.')))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const res = await applyStagePlan(
        projectId,
        team,
        draft.context.stages.map((s, i) => ({
          id: s.id,
          name: names[i].name.trim(),
          goal: names[i].goal.trim(),
          starts_on: s.starts_on,
          ends_on: s.ends_on,
        })),
        placement.map((p) => ({ id: p.task_id, stage: p.stage })),
        draft.context.shown,
      )
      onApplied(txt(res.updated > 0 ? 'Sprints updated' : 'Sprints created'))
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, txt('Could not save the sprints. Try again.')))
    } finally {
      setBusy(false)
    }
  }

  const footer = draft ? (
    <>
      <Button variant="ghost" onClick={() => { setDraft(null); setError(null) }} disabled={busy}>Back</Button>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button onClick={() => void apply()} loading={busy} disabled={names.some((n) => !n.name.trim())}>Apply</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button
        onClick={() => void suggest()}
        loading={busy}
        disabled={!ctx || loading || Boolean(ctx.blocked) || ctx.tasks.length === 0 || (streams && !team)}
      >
        {txt('Suggest sprints')}
      </Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={txt('Suggest sprints')}
      description={draft ? undefined : txt('Collabify works out how many sprints fit and their hours; the AI groups the tasks and names each one. Nothing changes until you apply.')}
      size={draft ? 'xl' : 'md'}
      footer={footer}
    >
      <div className="space-y-4">
        {draft ? (
          <Review
            draft={draft}
            names={names}
            setNames={setNames}
            placement={placement}
            setPlacement={setPlacement}
            terms={terms}
          />
        ) : (
          <Setup
            ctx={ctx}
            loading={loading}
            streams={streams}
            teams={teams}
            team={team}
            setTeam={setTeam}
            length={length ?? ctx?.length_days ?? null}
            setLength={setLength}
            terms={terms}
          />
        )}
        {error && <div ref={errorRef}><Alert tone="error">{error}</Alert></div>}
      </div>
    </Modal>
  )
}

function Setup({
  ctx, loading, streams, teams, team, setTeam, length, setLength, terms,
}: {
  ctx: StageContext | null
  loading: boolean
  streams: boolean
  teams: { id: string; name: string }[]
  team: string | null
  setTeam: (id: string | null) => void
  length: number | null
  setLength: (days: number) => void
  terms?: StageTerms
}) {
  const txt = (copy: string) => stageText(copy, terms)
  const notes = ctx && !ctx.blocked ? [
    ctx.unestimated > 0 && `${ctx.unestimated} ${plural(ctx.unestimated, 'task has', 'tasks have')} no estimate`,
    ctx.planning_count > 0 &&
      `${ctx.planning_count} ${plural(ctx.planning_count, 'task is', 'tasks are')} still in planning. Send them from Plan & route to include them.`,
    ctx.left_out > 0 && `${ctx.left_out} ${plural(ctx.left_out, 'task is', 'tasks are')} left out. A plan holds up to 200.`,
    ctx.tasks.length === 0 && 'Nothing to plan. Add tasks to the backlog first.',
  ].filter(Boolean) as string[] : []
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {streams && (
          <label className="block min-w-[12rem] flex-1 text-[13px] text-muted">
            Team
            <Select
              aria-label="Team"
              value={team ?? ''}
              onChange={(e) => setTeam(e.target.value || null)}
              placeholder="Choose a team"
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
              className="mt-1"
            />
          </label>
        )}
        <label className="block min-w-[10rem] text-[13px] text-muted">
          {txt('Sprint length')}
          <Select
            aria-label="Length"
            value={length ? String(length) : ''}
            onChange={(e) => setLength(Number(e.target.value))}
            options={LENGTHS}
            disabled={!ctx || Boolean(ctx.blocked)}
            className="mt-1"
          />
        </label>
      </div>
      {loading && !ctx ? (
        <p className="flex items-center gap-2 text-[13px] text-muted"><Spinner size={14} /> Reading the plan…</p>
      ) : ctx?.blocked ? (
        <Alert tone="info">{ctx.blocked}</Alert>
      ) : ctx ? (
        <div className="rounded-xl border border-line surface-sunken px-4 py-3">
          <p className="font-mono text-[13px] text-ink">{summary(ctx)}</p>
          <p className="mt-1 text-[12px] text-muted">
            {txt(`${ctx.stages.length} ${plural(ctx.stages.length, 'sprint', 'sprints')} ${ctx.window.to ? 'fit' : 'needed'}`)}
            {ctx.stages.length > 1 && ', the last kept for testing and fixes'}
            {ctx.suggested_length_days !== ctx.length_days &&
              ` · suggested length: ${LENGTHS.find((l) => l.value === String(ctx.suggested_length_days))?.label}`}
            .
          </p>
          {notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
              {notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      ) : streams && !team ? (
        <p className="text-[13px] text-muted">{txt('Choose the team whose sprints to plan.')}</p>
      ) : null}
    </div>
  )
}

function Review({
  draft, names, setNames, placement, setPlacement, terms,
}: {
  draft: StageDraft
  names: { name: string; goal: string }[]
  setNames: (next: { name: string; goal: string }[]) => void
  placement: StagePlacement[]
  setPlacement: (next: StagePlacement[]) => void
  terms?: StageTerms
}) {
  const txt = (copy: string) => stageText(copy, terms)
  const singular = terms?.singular ?? 'Stage'
  const { context: ctx } = draft
  const tasks = useMemo(() => new Map(ctx.tasks.map((t) => [t.id, t])), [ctx.tasks])
  const totals = stageTotals(ctx.stages, ctx.tasks, placement)
  const weeks = ctx.length_days / 7
  const backlog = placement.filter((p) => p.stage === null)
  const backlogMinutes = backlog.reduce((n, p) => n + (tasks.get(p.task_id)?.minutes ?? 0), 0)
  const options = [
    ...ctx.stages.map((_, i) => ({ value: String(i), label: names[i]?.name.trim() || `${singular} ${i + 1}` })),
    { value: '', label: 'Backlog' },
  ]

  const move = (taskId: string, value: string) =>
    setPlacement(placement.map((p) => (p.task_id === taskId
      ? { ...p, stage: value === '' ? null : Number(value), flag: null }
      : p)))
  const rename = (i: number, patch: Partial<{ name: string; goal: string }>) =>
    setNames(names.map((n, j) => (j === i ? { ...n, ...patch } : n)))

  const row = (p: StagePlacement) => {
    const t = tasks.get(p.task_id)
    if (!t) return null
    return (
      <li key={p.task_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title}</span>
        {p.flag && <span className="text-[12px] text-warning-700 dark:text-warning-300">{txt(flagText(p.flag, Boolean(ctx.window.to)))}</span>}
        <span className="w-20 shrink-0 text-right font-mono text-[12px] text-muted">
          {t.minutes === null ? 'No estimate' : formatHours(t.minutes)}
        </span>
        <Select
          aria-label={`${singular} for ${t.title}`}
          value={p.stage === null ? '' : String(p.stage)}
          onChange={(e) => move(p.task_id, e.target.value)}
          options={options}
          className="!h-8 !w-[11rem] !text-[13px]"
        />
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-display text-[16px] font-semibold text-ink">
          {txt(`Suggested: ${ctx.stages.length} ${plural(ctx.stages.length, 'sprint', 'sprints')} of ${weeks} ${plural(weeks, 'week', 'weeks')}`)}
        </p>
        <p className="mt-0.5 font-mono text-[12px] text-muted">{summary(ctx)}</p>
        {ctx.running.map((r) => (
          <p key={r.id} className="mt-1 text-[13px] text-muted">
            {r.name} is running and keeps its {r.task_count} {plural(r.task_count, 'task', 'tasks')}
          </p>
        ))}
        {ctx.outside_count > 0 && (
          <p className="mt-1 text-[13px] text-muted">
            {txt(`${ctx.outside_count} ${plural(ctx.outside_count, 'task', 'tasks')} in planned sprints ${plural(ctx.outside_count, "isn't", "aren't")} part of this plan (done, waiting for review or past the 200 limit). A sprint this plan drops sends them to the backlog.`)}
          </p>
        )}
        {draft.note && <p className="mt-2 text-[13px] text-ink">{draft.note}</p>}
      </div>

      {ctx.stages.map((s, i) => {
        const total = totals[i]
        return (
          <section key={s.key} className="rounded-xl border border-line px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="eyebrow text-faint">
                {singular} {i + 1} · {day(s.starts_on)} – {day(s.ends_on)}{s.buffer ? ' (buffer)' : ''}
              </p>
              <span
                {...(total.over ? { 'data-over': '' } : {})}
                className={`font-mono text-[12px] ${total.over ? 'text-warning-700 dark:text-warning-300' : 'text-muted'}`}
              >
                {hoursNumber(total.minutes)} / {formatHours(s.capacity_minutes)}
                {total.unestimated > 0 && ` · ${total.unestimated} without estimate`}
              </span>
            </div>
            {s.milestone_lost && (
              <p className="mt-1 text-[12px] text-warning-700 dark:text-warning-300">
                {names[i]?.name.trim() || `${singular} ${i + 1}`} no longer counts toward {s.milestone_lost}
              </p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Input
                aria-label={`${singular} ${i + 1} name`}
                value={names[i]?.name ?? ''}
                maxLength={60}
                onChange={(e) => rename(i, { name: e.target.value })}
              />
              <Textarea
                aria-label={`${singular} ${i + 1} goal`}
                rows={1}
                value={names[i]?.goal ?? ''}
                maxLength={200}
                placeholder="What is true when it ends"
                onChange={(e) => rename(i, { goal: e.target.value })}
              />
            </div>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {placement.filter((p) => p.stage === i).map(row)}
              {placement.every((p) => p.stage !== i) && <li className="py-1.5 text-[12px] text-faint">Nothing here yet</li>}
            </ul>
          </section>
        )
      })}

      {backlog.length > 0 && (
        <section className="rounded-xl border border-dashed border-line px-4 py-3">
          <p className="eyebrow text-faint">Backlog</p>
          <p className="mt-1 text-[13px] text-muted">
            {formatHours(backlogMinutes)} won&apos;t fit {ctx.window.to ? `before ${day(ctx.window.to)}` : txt('in these sprints')}.{' '}
            {backlog.length === 1 ? 'This task stays' : `These ${backlog.length} tasks stay`} in the backlog.
          </p>
          <ul className="mt-2 divide-y divide-[var(--line)]">{backlog.map(row)}</ul>
        </section>
      )}
    </div>
  )
}
