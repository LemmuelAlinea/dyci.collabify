import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { dateRange } from '../../lib/general/dates'
import { levelLabel } from '../../lib/general/permissions'
import { presetById } from '../../lib/general/presets'
import { projectStatusLabel } from '../../lib/general/types'
import type { GeneralProjectSummary, GeneralStatus } from '../../lib/general/types'
import { paths } from '../../lib/paths'

const STATUS_TONE: Record<GeneralStatus, string> = {
  planning: 'bg-pending-soft text-pending-ink',
  in_progress: 'bg-success-500/10 text-success-700 dark:text-success-300',
  on_hold: 'bg-warning-400/18 text-warning-700 dark:text-warning-300',
  done: 'bg-navy-50 text-navy-700 dark:bg-navy-500/18 dark:text-navy-100',
  cancelled: 'surface-sunken text-faint',
}

/**
 * A work project, built like a class card: a numbered eyebrow and a status, a
 * monogram of its kind beside the name, a line of description, progress, and
 * who is on it below a rule. Shared by All projects and a space's own list.
 *
 * `showSpace` names the space in the meta line — on All projects, where two
 * same-named projects in different spaces would otherwise look alike.
 */
export function WorkProjectCard({
  project: p,
  index,
  showSpace = false,
}: {
  project: GeneralProjectSummary
  index: number
  showSpace?: boolean
}) {
  const pct = Math.min(100, Number(p.progress_pct))
  const kind = presetById(p.preset)
  const shape = kind && kind.id !== 'blank' ? kind : null
  const meta = [
    // Null when the reader joined by project code and never joined its space.
    showSpace ? (p.space_name ?? 'A space you are not in') : null,
    shape?.name ?? null,
    dateRange(p.starts_on, p.ends_on),
  ].filter(Boolean)

  return (
    <Link
      to={paths.project(p.id)}
      className="group relative flex min-h-[268px] overflow-hidden rounded-card border border-line bg-[var(--surface)] transition-[border-color,transform] duration-200 hover-safe hover:border-line-strong"
    >
      <div className="flex w-full flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.18em] text-faint uppercase">
            Project {String(index + 1).padStart(2, '0')}
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              p.archived_at ? 'surface-sunken text-muted' : STATUS_TONE[p.status]
            }`}
          >
            {p.archived_at ? 'Archived' : projectStatusLabel(p.status)}
          </span>
        </div>

        <div className="mt-5 flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-icon-tile font-display text-[14px] font-bold text-icon-glyph ring-1 ring-white/10">
            {shape ? <Icon name={shape.icon} size={20} /> : p.name.trim().charAt(0).toUpperCase() || 'P'}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[17px] leading-snug text-ink transition-colors group-hover:text-navy-600 dark:group-hover:text-amber-300">
              {p.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{meta.join(' · ')}</p>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 min-h-[42px] text-[13px] leading-relaxed text-muted">
          {p.description || 'Open the project for its tasks, files, members and timeline.'}
        </p>

        <div className="mt-4">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted">
              {p.done_count} of {p.task_count} tasks done
            </span>
            <span className="font-mono text-faint">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full surface-sunken">
            <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p className="text-[11px] text-faint">Your role</p>
            <p className="mt-0.5 truncate text-[13px] font-medium text-ink">
              {p.my_level ? levelLabel(p.my_level) : 'Space member'}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {p.my_level === 'owner' && p.open_request_count > 0 && (
              <span className="rounded-full bg-amber-400/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {p.open_request_count} access {p.open_request_count === 1 ? 'request' : 'requests'}
              </span>
            )}
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <Icon name="users" size={14} />
              {p.member_count} {p.member_count === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
