import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Alert } from '../ui/Alert'
import { myGrade } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import { formatPoints } from '../../lib/scoreMath'
import type { MyGrade } from '../../lib/types'

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })

const barPct = (points: number | string | null, max: number) =>
  points === null || max <= 0 ? 0 : Math.round(Math.min(100, Math.max(0, (Number(points) / max) * 100)))

/**
 * The student's released grade: the score, the board's rubric breakdown, any
 * teamwork adjustment, and how teammates saw them beside the team's average.
 * Nothing shows before release.
 */
export function GradeCard({ projectId }: { projectId: string }) {
  const [grade, setGrade] = useState<MyGrade | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGrade(await myGrade(projectId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your grade. Reload the page to try again.'))
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])
  useLive(load, ['score_releases', 'member_scores', 'board_scores'])

  if (error) {
    return (
      <div className="lg:col-span-2">
        <Alert tone="error">{error}</Alert>
      </div>
    )
  }
  if (!grade) return null

  const final = Number(grade.final)
  const group = Number(grade.group_total)
  const adjust = Math.round((final - group) * 2) / 2
  // Only the peer factor counts as a teamwork adjustment; any other gap is the professor's call.
  const teamwork = adjust !== 0 && grade.in_group && grade.factor !== null && !grade.overridden

  return (
    <section
      aria-labelledby="your-grade"
      className="rounded-panel border border-line surface p-4 shadow-card sm:p-6 lg:col-span-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="your-grade">Your grade</h2>
        <p className="font-mono text-[12px] text-faint">
          Released {dateFmt.format(new Date(grade.released_at))}
        </p>
      </div>

      <p className="mt-3 font-display text-[40px] leading-none text-ink">
        {formatPoints(final)}
        <span className="text-[18px] text-muted"> / {grade.total_points}</span>
      </p>
      {teamwork ? (
        <p className="mt-2 text-[13px] text-muted">
          Adjusted for teamwork: {adjust > 0 ? '+' : '−'}
          {formatPoints(Math.abs(adjust))} from your group’s {formatPoints(group)}
        </p>
      ) : (
        adjust !== 0 && (
          <p className="mt-2 text-[13px] text-muted">
            Your professor set your score at {formatPoints(final)}.{' '}
            {grade.in_group ? 'Your group scored' : 'Your rubric total is'} {formatPoints(group)}.
          </p>
        )
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="eyebrow">Rubric</h3>
          <ul className="mt-3 space-y-3">
            {grade.criteria.map((c) => (
              <li key={c.label} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-ink">{c.label}</span>
                  <span className="font-mono text-[12px] text-muted">
                    {formatPoints(c.points === null ? null : Number(c.points))} / {c.max_points}
                  </span>
                </div>
                <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full surface-sunken">
                  <span
                    className="block h-full rounded-full bg-progress"
                    style={{ width: `${barPct(c.points, c.max_points)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>

        {grade.peer && (
          <div>
            <h3 className="eyebrow">How your teammates saw you</h3>
            <p className="mt-1 text-[12px] text-faint">
              Averages from {grade.peer.raters} teammates in the final round, out of 5, next to your
              team’s. Nobody sees who gave which rating.
            </p>
            <dl className="mt-3 space-y-2">
              {PEER_DIMENSIONS.map((d) => (
                <div key={d.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <dt className="text-muted">{d.label}</dt>
                  <dd className="shrink-0 font-mono text-ink">
                    {Number(grade.peer!.me[d.key]).toFixed(1)}
                    <span className="text-faint"> · team {Number(grade.peer!.team[d.key]).toFixed(1)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}
