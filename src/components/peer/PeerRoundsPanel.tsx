import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  closePeerRound,
  listPeerRounds,
  openPeerRound,
  projectPeerResults,
  remindPeerRound,
  setPeerRoundClose,
} from '../../lib/api/peer'
import { authErrorMessage } from '../../lib/authError'
import { addDays, manilaDay } from '../../lib/analyticsMath'
import { PEER_MIN_RATERS, latestRoundRows } from '../../lib/peerMath'
import type { PeerResult, PeerRoundKind, PeerRoundStatus } from '../../lib/types'
import { PeerComments } from './PeerComments'
import { PeerResultsTable } from './PeerResultsTable'

const KIND: Record<PeerRoundKind, string> = { check_in: 'Check-in', final: 'Final' }
const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
/** A date input's day, closing at the end of that Manila day. */
const endOfDay = (day: string) => `${day}T23:59:00+08:00`

/**
 * Peer evaluation on one group project: open a round, watch who has answered,
 * remind the rest, and read the results group by group. Only the final round
 * will feed scores (Phase C2); a check-in is an early warning.
 */
export function PeerRoundsPanel({ projectId }: { projectId: string }) {
  const { show } = useToast()
  const [rounds, setRounds] = useState<PeerRoundStatus[]>([])
  const [results, setResults] = useState<PeerResult[]>([])
  const [kind, setKind] = useState<PeerRoundKind>('check_in')
  const [day, setDay] = useState(() => addDays(manilaDay(new Date()), 5))
  const [extendDay, setExtendDay] = useState('')
  const [reopenDay, setReopenDay] = useState('')
  const [closing, setClosing] = useState<PeerRoundStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  // Live updates retry the load often; one toast until it works again is enough.
  const erroredRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const [r, res] = await Promise.all([listPeerRounds(projectId), projectPeerResults(projectId)])
      setRounds(r)
      setResults(res)
      setRevision((n) => n + 1)
      erroredRef.current = false
    } catch (err) {
      if (erroredRef.current) return
      erroredRef.current = true
      show(authErrorMessage(err, 'Could not load the peer evaluation. Reload the page to try again.'), 'error')
    }
  }, [projectId, show])

  useEffect(() => {
    void load()
  }, [load])
  useLive(load, ['peer_rounds', 'peer_ratings', 'group_members'])

  const openRound = rounds.find((r) => r.is_open) ?? null
  // The latest round ran past its closing time without being closed. It can be reopened.
  const lapsed =
    !openRound && rounds[0] && !rounds[0].is_open && rounds[0].closed_at === null &&
    new Date(rounds[0].closes_at) <= new Date()
      ? rounds[0]
      : null
  const roundState = (r: PeerRoundStatus) => (r.closed_at ? 'closed' : r.is_open ? 'open' : 'ended')
  const hasFinal = rounds.some((r) => r.kind === 'final')
  const effectiveKind: PeerRoundKind = hasFinal && kind === 'final' ? 'check_in' : kind
  const missing = openRound
    ? results.filter((r) => r.round_id === openRound.id && !r.rated_all && r.team_size > 1)
    : []
  const latest = latestRoundRows(results)
  const boards = [...new Set(latest.map((r) => r.board_id))]

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      show(done)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-panel border border-line p-4 sm:p-5">
      <header>
        <h3>Peer evaluation</h3>
        <p className="mt-0.5 max-w-[66ch] text-[13px] text-muted">
          Students rate everyone in their group, themselves included, on five behaviours. A check-in
          warns early. Only the final round will feed scores.
        </p>
      </header>

      {openRound ? (
        <div className="space-y-3 rounded-card surface-sunken p-3">
          <p className="text-[14px] text-ink">
            {KIND[openRound.kind]} round open until {dateFmt.format(new Date(openRound.closes_at))} ·{' '}
            <span className="font-mono">{openRound.answered} of {openRound.expected}</span> answered
          </p>
          {missing.length > 0 && (
            <p className="text-[13px] text-muted">
              Still to answer: {missing.map((m) => m.student_name).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || missing.length === 0}
              onClick={async () => {
                setBusy(true)
                try {
                  const n = await remindPeerRound(openRound.id)
                  show(n > 0 ? `Reminded ${n} ${n === 1 ? 'student' : 'students'}` : 'Everyone has already answered')
                } catch (err) {
                  show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Send reminder
            </Button>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Move close to
              <input
                type="date"
                value={extendDay}
                min={manilaDay(new Date())}
                onChange={(e) => setExtendDay(e.target.value)}
                className="h-9 rounded-lg border border-line surface px-2 text-ink"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !extendDay}
              onClick={() => act(() => setPeerRoundClose(openRound.id, endOfDay(extendDay)), 'Closing date moved')}
            >
              Move
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClosing(openRound)}>
              Close now
            </Button>
          </div>
        </div>
      ) : (
        <>
          {lapsed && (
            <div className="space-y-3 rounded-card surface-sunken p-3">
              <p className="text-[14px] text-ink">
                {KIND[lapsed.kind]} round ended {dateFmt.format(new Date(lapsed.closes_at))} ·{' '}
                <span className="font-mono">{lapsed.answered} of {lapsed.expected}</span> answered
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  Reopen until
                  <input
                    type="date"
                    value={reopenDay}
                    min={manilaDay(new Date())}
                    onChange={(e) => setReopenDay(e.target.value)}
                    className="h-9 rounded-lg border border-line surface px-2 text-ink"
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !reopenDay}
                  onClick={() => act(() => setPeerRoundClose(lapsed.id, endOfDay(reopenDay)), 'Round reopened')}
                >
                  Reopen
                </Button>
              </div>
            </div>
          )}
          {/* A lapsed final round is the last one: reopen it rather than start another. */}
          {lapsed?.kind !== 'final' && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-[13px] text-muted">
                <span className="block">Round</span>
                <select
                  value={effectiveKind}
                  onChange={(e) => setKind(e.target.value as PeerRoundKind)}
                  className="h-9 rounded-lg border border-line surface px-2 text-ink"
                >
                  <option value="check_in">Check-in</option>
                  <option value="final" disabled={hasFinal}>
                    Final{hasFinal ? ' (already run)' : ''}
                  </option>
                </select>
              </label>
              <label className="space-y-1 text-[13px] text-muted">
                <span className="block">Closes at the end of</span>
                <input
                  type="date"
                  value={day}
                  min={manilaDay(new Date())}
                  onChange={(e) => setDay(e.target.value)}
                  className="h-9 rounded-lg border border-line surface px-2 text-ink"
                />
              </label>
              <Button
                size="sm"
                disabled={busy || !day}
                onClick={() => act(() => openPeerRound(projectId, effectiveKind, endOfDay(day)), 'Round opened. Each group got a notification.')}
              >
                Open round
              </Button>
            </div>
          )}
        </>
      )}

      {rounds.length > 0 && (
        <ul className="space-y-1 text-[12px] text-faint">
          {rounds.map((r) => (
            <li key={r.id}>
              {KIND[r.kind]} · {dateFmt.format(new Date(r.opens_at))} to {dateFmt.format(new Date(r.closed_at ?? r.closes_at))} ·{' '}
              {r.answered} of {r.expected} answered · {roundState(r)}
            </li>
          ))}
        </ul>
      )}

      {boards.length > 0 && (
        <div className="space-y-5 border-t border-line pt-4">
          {boards.map((b) => {
            const rows = latest.filter((r) => r.board_id === b)
            const first = rows[0]
            return (
              <div key={b} className="space-y-2">
                <p className="text-[13px] font-medium text-ink">
                  {first.group_name ?? 'Group'} · {KIND[first.kind]}
                  {first.is_open && <span className="text-faint"> · in progress</span>}
                </p>
                <PeerResultsTable rows={rows} label={first.group_name ?? 'Group'} />
                <PeerComments roundId={first.round_id} boardId={b} revision={revision} />
              </div>
            )
          })}
          <p className="text-[12px] text-faint">
            Factor is a member's average from teammates divided by the team's. It appears once at
            least {PEER_MIN_RATERS} teammates have rated them.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={closing !== null}
        title="Close this round now?"
        body={
          closing?.kind === 'final'
            ? "This is the project's final round. Once closed it can't be reopened, and no other final round can be opened."
            : 'Students can no longer save or change ratings. You can still open a new round afterwards.'
        }
        confirmLabel="Close round"
        tone="primary"
        onClose={() => setClosing(null)}
        onConfirm={() => {
          const r = closing
          setClosing(null)
          if (r) void act(() => closePeerRound(r.id), 'Round closed')
        }}
      />
    </section>
  )
}
