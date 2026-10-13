import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { confirmMemberScores, saveBoardScores } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { analyseTeam, peerFlagLabel } from '../../lib/peerMath'
import { SCORE_STATUS_META, boardScoreStatus, formatPoints, isHalfStep, suggestScore } from '../../lib/scoreMath'
import type { BoardSummary, ProjectCriterion, ScoreSheetRow } from '../../lib/types'
import type { ProjectScores } from './useProjectScores'

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const box =
  'h-9 w-20 rounded-lg border border-line surface px-2 text-right font-mono text-[13px] text-ink aria-[invalid=true]:border-danger-500'

/**
 * Score one board against the rubric, then confirm each member's score. Inputs
 * hold only what was edited, so a live reload never wipes what is being typed.
 */
export function ScoreCard({ board, scores }: { board: BoardSummary; scores: ProjectScores }) {
  const { show } = useToast()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [finals, setFinals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (!scores.loaded) return null
  const { criteria } = scores
  if (criteria.length === 0) {
    return (
      <p className="rounded-panel border border-line p-4 text-[13px] text-muted">
        Add a rubric to this project to score it.
      </p>
    )
  }

  const solo = board.student_id !== null
  const total = board.total_points
  const rows = scores.sheet.filter((r) => r.board_id === board.id)
  const saved = new Map(scores.boardScores.filter((s) => s.board_id === board.id).map((s) => [s.criterion_id, s.points]))

  const value = (c: ProjectCriterion) => edits[c.id] ?? (saved.has(c.id) ? String(saved.get(c.id)) : '')
  const problem = (c: ProjectCriterion) => {
    const v = value(c).trim()
    if (v === '') return 'Score this criterion'
    const n = Number(v)
    if (!isHalfStep(n)) return 'Use whole or half points'
    if (n > c.max_points) return `At most ${c.max_points}`
    return null
  }
  const complete = criteria.every((c) => !problem(c))
  const liveTotal = complete ? criteria.reduce((s, c) => s + Number(value(c)), 0) : null
  const dirty = Object.keys(edits).length > 0
  const fullySaved = criteria.every((c) => saved.has(c.id))
  const savedTotal = fullySaved ? criteria.reduce((s, c) => s + (saved.get(c.id) ?? 0), 0) : null

  const team = new Map(analyseTeam(scores.finalPeer.filter((r) => r.board_id === board.id)).map((m) => [m.student_id, m]))
  const suggested = (r: ScoreSheetRow) => suggestScore(savedTotal, r.in_group ? r.factor : null, total)
  const finalText = (r: ScoreSheetRow) =>
    finals[r.student_id] ?? (r.final !== null ? String(r.final) : String(suggested(r) ?? ''))
  const finalProblem = (r: ScoreSheetRow) => {
    const n = Number(finalText(r))
    if (finalText(r).trim() === '' || !isHalfStep(n)) return 'Use whole or half points'
    if (n > total) return `At most ${total}`
    return null
  }
  const canConfirm = fullySaved && !dirty && rows.length > 0 && (solo || rows.every((r) => !finalProblem(r)))
  const status = SCORE_STATUS_META[boardScoreStatus(rows)]
  const handedIn = Boolean(board.submitted_at || board.result_verdict)
  const released = rows[0]?.released ?? false

  const run = async (fn: () => Promise<void>, done: string, reset: () => void) => {
    setBusy(true)
    try {
      await fn()
      await scores.reload()
      reset()
      show(done)
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-panel border border-line p-4 sm:p-5" aria-labelledby={`score-${board.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`score-${board.id}`} className="mr-auto">Score</h3>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[status.tone]}`}>{status.label}</span>
      </header>

      {!handedIn && <Alert tone="info">This has not been handed in. You can still score it.</Alert>}
      {released && (
        <Alert tone="info">
          Grades are released. Students see a changed criterion as soon as you save, and a changed
          score once you confirm.
        </Alert>
      )}

      <ul className="space-y-3">
        {criteria.map((c) => {
          const err = edits[c.id] !== undefined ? problem(c) : null
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-3">
              <label htmlFor={`pts-${board.id}-${c.id}`} className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{c.label}</span>
                {c.description && <span className="block text-[12px] text-muted">{c.description}</span>}
              </label>
              <span className="flex items-center gap-2">
                <input
                  id={`pts-${board.id}-${c.id}`}
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  min={0}
                  max={c.max_points}
                  value={value(c)}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `pts-${board.id}-${c.id}-err` : undefined}
                  onChange={(e) => setEdits((d) => ({ ...d, [c.id]: e.target.value }))}
                  className={box}
                />
                <span className="font-mono text-[12px] text-faint">/ {c.max_points}</span>
              </span>
              {err && (
                <p id={`pts-${board.id}-${c.id}-err`} className="basis-full text-right text-[12px] text-danger-700 dark:text-danger-300">
                  {err}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <p className="mr-auto font-mono text-[14px] text-ink" aria-live="polite">
          {formatPoints(liveTotal)} <span className="text-faint">/ {total}</span>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !complete || !dirty}
          onClick={() =>
            run(
              () => saveBoardScores(board.id, criteria.map((c) => ({ criterion_id: c.id, points: Number(value(c)) }))),
              'Scores saved',
              () => setEdits({}),
            )
          }
        >
          Save scores
        </Button>
      </div>

      {!solo && rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-faint">
            The factor comes from the final peer round once it closes, and needs at least two
            raters. Without one, the suggestion is the group score. Groups of two never get one.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <caption className="sr-only">Individual scores for {board.group_name ?? 'this group'}</caption>
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-faint">
                  <th scope="col" className="px-2 py-2 font-medium">Member</th>
                  <th scope="col" className="px-2 py-2 font-medium">Factor</th>
                  <th scope="col" className="px-2 py-2 font-medium">Flags</th>
                  <th scope="col" className="px-2 py-2 font-medium">Suggested</th>
                  <th scope="col" className="px-2 py-2 font-medium">Final</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = suggested(r)
                  const err = finals[r.student_id] !== undefined ? finalProblem(r) : null
                  const over = s !== null && Number(finalText(r)) !== s
                  const peer = team.get(r.student_id)
                  return (
                    <tr key={r.student_id} className="border-b border-line last:border-0">
                      <th scope="row" className="px-2 py-2 text-left font-normal text-ink">{r.student_name}</th>
                      <td className="px-2 py-2 font-mono text-muted">{r.factor === null ? '—' : r.factor.toFixed(2)}</td>
                      <td className="px-2 py-2">
                        <span className="flex flex-wrap gap-1">
                          {(peer?.flags ?? []).map((f) => {
                            const w = peerFlagLabel(f, peer?.is_open)
                            return (
                              <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[w.tone]}`}>
                                {w.label}
                              </span>
                            )
                          })}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-mono text-muted">{formatPoints(s)}</td>
                      <td className="px-2 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.5}
                            min={0}
                            max={total}
                            value={finalText(r)}
                            disabled={!fullySaved}
                            aria-label={`Final score for ${r.student_name}`}
                            aria-invalid={err ? true : undefined}
                            onChange={(e) => setFinals((d) => ({ ...d, [r.student_id]: e.target.value }))}
                            className={box}
                          />
                          {over && (
                            <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL.pending}`}>Overridden</span>
                          )}
                          {r.suggestion_changed && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL.warning}`}
                              title={`Confirmed with ${formatPoints(r.suggested_saved)}; today it would be ${formatPoints(r.suggested_now)}. Confirm again to bring it up to date.`}
                            >
                              Suggestion changed
                            </span>
                          )}
                          {err && <span className="text-[12px] text-danger-700 dark:text-danger-300">{err}</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-[12px] text-faint">
          {dirty
            ? 'Save the scores before confirming.'
            : rows[0]?.confirmed_at
              ? `Confirmed ${dateFmt.format(new Date(rows[0].confirmed_at))}`
              : solo
                ? 'Confirming sets the student’s score to the board total.'
                : 'Confirm once each member’s score is right.'}
        </p>
        <Button
          size="sm"
          disabled={busy || !canConfirm}
          onClick={() =>
            run(
              () =>
                confirmMemberScores(
                  board.id,
                  solo ? [] : rows.map((r) => ({ student_id: r.student_id, final: Number(finalText(r)) })),
                ),
              solo ? 'Score confirmed' : 'Scores confirmed',
              () => setFinals({}),
            )
          }
        >
          {solo ? 'Confirm score' : 'Confirm scores'}
        </Button>
      </div>
    </section>
  )
}
