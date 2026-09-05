import { Link } from 'react-router-dom'
import type { MemberProgress } from '../../lib/types'

type Row = MemberProgress & { project_title: string }

/**
 * The two numbers that mean different things: their own 100, which is the
 * individual grade, and the slice of the group's 100 they are carrying.
 */
export function StandingCard({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        Claim a task and your own progress starts counting here.
      </p>
    )
  }

  const average =
    Math.round(
      (rows.reduce((n, r) => n + (r.personal_pct ?? 0), 0) / rows.length) * 10,
    ) / 10

  return (
    <div className="card p-4 sm:p-5 shadow-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Across your projects</p>
          <p className="mt-2 text-[28px] leading-none font-semibold text-ink">
            {average}
            <span className="ml-0.5 text-[15.5px] text-muted">%</span>
          </p>
        </div>
        <p className="max-w-[280px] text-[12px] leading-relaxed text-muted">
          Your own tasks finished. The group figure beside each one is your share of that
          project's 100.
        </p>
      </div>

      <ul className="mt-4 divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.board_id}>
            <Link
              to={`/student/projects/${r.project_id}`}
              className="flex items-center gap-3 py-2.5 transition-colors hover:opacity-80"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">{r.project_title}</span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full surface-sunken">
                  <span
                    className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${r.personal_pct ?? 0}%` }}
                  />
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[14px] text-ink">
                  {r.personal_pct === null ? '—' : `${r.personal_pct}%`}
                </span>
                <span className="block font-mono text-[12px] text-faint">
                  {r.group_pct} of {r.held_pct} group
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
