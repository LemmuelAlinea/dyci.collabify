import type { ProgressKey, ProgressRow } from '../api/walkthroughs'
import { ACCOUNT_STEPS, FLOWS, flowsFor, type FlowId, type StepDef, type WalkthroughFacts } from './flows'

export type ProgressMap = Partial<Record<ProgressKey, ProgressRow>>

export function toMap(rows: ProgressRow[]): ProgressMap {
  const map: ProgressMap = {}
  for (const r of rows) map[r.flow] = r
  return map
}

const closed = (row: ProgressRow | undefined) => row?.status === 'done' || row?.status === 'skipped'

/** A flow's steps, led by the account steps until that row is done or skipped. */
export function stepsOf(flow: FlowId, p: ProgressMap): readonly StepDef[] {
  return closed(p.account) ? FLOWS[flow] : [...ACCOUNT_STEPS, ...FLOWS[flow]]
}

export type Run =
  | { kind: 'none' }
  | { kind: 'paused'; flow: FlowId }
  | { kind: 'finished'; flow: FlowId }
  | { kind: 'step'; flow: FlowId; step: StepDef; index: number; total: number }

const stepDone = (s: StepDef, f: WalkthroughFacts, p: ProgressMap) =>
  Boolean(s.isDone?.(f)) || (p[s.owner]?.done_steps ?? []).includes(s.id)

/**
 * What to show now: the first open walkthrough the person had at the start of
 * this visit, at its first unfinished step.
 */
export function resolveRun(
  f: WalkthroughFacts,
  p: ProgressMap,
  opts: { openedWith: ReadonlySet<FlowId>; held: boolean },
): Run {
  if (opts.held) return { kind: 'none' }
  let paused: Run = { kind: 'none' }
  for (const flow of flowsFor(f)) {
    if (!opts.openedWith.has(flow) || closed(p[flow])) continue
    const steps = stepsOf(flow, p)
    const at = steps.findIndex((s) => !stepDone(s, f, p))
    if (at < 0) return { kind: 'finished', flow }
    const step = steps[at]
    // A paused flow is passed over so the next one can show; it holds only when nothing else does.
    if (p[flow]?.status === 'paused' && step.pauseLabel) {
      if (paused.kind === 'none') paused = { kind: 'paused', flow }
      continue
    }
    return { kind: 'step', flow, step, index: at + 1, total: steps.length }
  }
  return paused
}

export type Change = { progress: ProgressMap; writes: ProgressRow[] }

const rowOf = (p: ProgressMap, flow: ProgressKey): ProgressRow =>
  p[flow] ?? { flow, status: 'active', done_steps: [] }

function apply(p: ProgressMap, rows: ProgressRow[]): Change {
  const progress = { ...p }
  for (const r of rows) progress[r.flow] = r
  return { progress, writes: rows }
}

/** Records a finished step on its owner's row. */
export function markStep(p: ProgressMap, step: StepDef): Change {
  const row = rowOf(p, step.owner)
  const done_steps = row.done_steps.includes(step.id) ? row.done_steps : [...row.done_steps, step.id]
  const accountDone =
    step.owner === 'account' && ACCOUNT_STEPS.every((s) => done_steps.includes(s.id))
  return apply(p, [{ ...row, done_steps, status: accountDone ? 'done' : row.status }])
}

/** Skips a flow, and the account steps with it unless they are already closed. */
export function markSkipped(p: ProgressMap, flow: FlowId): Change {
  const rows: ProgressRow[] = [{ ...rowOf(p, flow), status: 'skipped' }]
  if (!closed(p.account)) rows.push({ ...rowOf(p, 'account'), status: 'skipped' })
  return apply(p, rows)
}

export function markPaused(p: ProgressMap, flow: FlowId): Change {
  return apply(p, [{ ...rowOf(p, flow), status: 'paused' }])
}

export function markFinished(p: ProgressMap, flow: FlowId): Change {
  return apply(p, [{ ...rowOf(p, flow), status: 'done' }])
}

/** Every step of the person's walkthroughs, for a replay from Settings. */
export function replaySteps(f: WalkthroughFacts): readonly StepDef[] {
  const flows = flowsFor(f)
  if (flows.length === 0) return []
  return [...ACCOUNT_STEPS, ...flows.flatMap((id) => FLOWS[id])]
}
