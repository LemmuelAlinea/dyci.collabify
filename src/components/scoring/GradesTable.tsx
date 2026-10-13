import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { clearProjectScores, releaseProjectScores, unreleaseProjectScores } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { SCORE_STATUS_META, boardScoreStatus, formatPoints } from '../../lib/scoreMath'
import { boardOwnerName } from '../../lib/types'
import type { BoardSummary, ScoreSheetRow } from '../../lib/types'
import type { ProjectScores } from './useProjectScores'

function handIn(b: BoardSummary) {
  if (b.result_verdict === 'accepted') return 'Accepted'
  if (b.result_verdict === 'returned') return 'Returned'
  return b.submitted_at ? 'Handed in' : 'Not handed in'
}

/**
 * Every board against every criterion, with where its grading stands. Opening a
 * row goes to that board's panel, where the scoring happens.
 */
export function GradesTable({
  projectId,
  boards,
  solo,
  scores,
  onOpen,
}: {
  projectId: string
  boards: BoardSummary[]
  solo: boolean
  scores: ProjectScores
  onOpen: (boardId: string) => void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { criteria, boardScores, sheet } = scores
  const totalPoints = boards[0]?.total_points ?? 0
  const released = sheet.some((r) => r.released)
  const anyConfirmed = sheet.some((r) => r.confirmed_at)

  const points = new Map(boardScores.map((s) => [`${s.board_id}:${s.criterion_id}`, s.points]))
  const rowsOf = new Map<string, ScoreSheetRow[]>()
  for (const r of sheet) rowsOf.set(r.board_id, [...(rowsOf.get(r.board_id) ?? []), r])
  const ordered = [...boards].sort((a, b) => boardOwnerName(a).localeCompare(boardOwnerName(b)))

  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      show(await fn())
      await scores.reload()
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!scores.loaded) return null
  if (criteria.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        This project has no rubric yet. Edit the project to add the criteria you mark against.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted">
          {released
            ? 'Released. Students see their confirmed score and their board’s breakdown.'
            : 'Students see nothing until you release grades.'}
        </p>
        {released ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await unreleaseProjectScores(projectId)
                return 'Grades hidden from students'
              })
            }
          >
            Unrelease
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || !anyConfirmed}
            onClick={() =>
              act(async () => {
                const n = await releaseProjectScores(projectId)
                return n > 0 ? `Grades released · ${n} notified` : 'Grades released'
              })
            }
          >
            Release grades
          </Button>
        )}
        {boardScores.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClearing(true)}>
            Clear scores…
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <caption className="sr-only">Grades by {solo ? 'student' : 'group'}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-faint">
              <th scope="col" className="px-2 py-2 font-medium">{solo ? 'Student' : 'Group'}</th>
              <th scope="col" className="px-2 py-2 font-medium">Hand-in</th>
              {criteria.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2 font-medium" title={c.description || undefined}>
                  {c.label} <span className="font-mono">/{c.max_points}</span>
                </th>
              ))}
              <th scope="col" className="px-2 py-2 font-medium">Total</th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => {
              const cells = criteria.map((c) => points.get(`${b.id}:${c.id}`) ?? null)
              const scored = cells.every((v) => v !== null)
              const total = scored ? cells.reduce<number>((s, v) => s + (v ?? 0), 0) : null
              const status = SCORE_STATUS_META[boardScoreStatus(rowsOf.get(b.id) ?? [])]
              return (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <button type="button" onClick={() => onOpen(b.id)} className="text-ink hover:underline">
                      {boardOwnerName(b)}
                    </button>
                  </th>
                  <td className="px-2 py-2 text-muted">{handIn(b)}</td>
                  {cells.map((v, i) => (
                    <td key={criteria[i].id} className="px-2 py-2 font-mono text-muted">
                      {formatPoints(v)}
                    </td>
                  ))}
                  <td className="px-2 py-2 font-mono text-ink">
                    {formatPoints(total)} <span className="text-faint">/ {totalPoints}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[status.tone]}`}>
                      {status.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        onConfirm={async () => {
          await clearProjectScores(projectId)
          show('Scores cleared. The rubric is unlocked.')
          await scores.reload()
        }}
        title="Clear every score?"
        body="This deletes every criterion score and confirmed grade on this project and hides released grades. The history keeps a record, and the rubric unlocks."
        confirmLabel="Clear scores"
      />
    </div>
  )
}
