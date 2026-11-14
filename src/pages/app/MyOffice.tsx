import { Link, Navigate } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Icon, Spinner } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import {
  myHeadedOffice,
  myOfficeAttention,
  myOfficeOverview,
  myOfficePeople,
  myOfficeSpaces,
} from '../../lib/api/officeHeads'
import type { OfficeAttention, OfficeOverview } from '../../lib/officeHeads'
import { attentionReason } from '../../lib/offices'
import { paths } from '../../lib/paths'
import { Band, BandLoading } from './admin/home/Band'
import { useRead } from './admin/home/useRead'

/** Wrapped so "heads no office" (null) reads apart from "still asking". */
const readOffice = async () => ({ office: await myHeadedOffice() })

const NO_FIGURES: OfficeOverview = { spaces: 0, running_projects: 0, people: 0, needs_attention: 0 }
const readOverview = async () => (await myOfficeOverview()) ?? NO_FIGURES

/**
 * An office head's read of their office: its figures, the running projects
 * that need a look, its spaces and its people. Names and counts only; a
 * project opens only for a head who is on it. Each band loads, empties and
 * fails on its own. Anyone who heads no office is sent Home.
 */
export default function MyOffice() {
  const { data, failed, load } = useRead(readOffice)

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        Your office did not load. Try again in a moment.
      </Alert>
    )
  }
  if (data === null) {
    return (
      <div className="grid place-items-center py-16 text-faint" role="status" aria-label="Loading your office">
        <Spinner size={22} />
      </div>
    )
  }
  if (!data.office) return <Navigate to={paths.home} replace />

  return (
    <div className="space-y-6">
      <DirectoryHero
        title={data.office.office_name}
        description="Your office at a glance: its figures, the running projects that need a look, its spaces and its people. Counts and names only — what happens inside a project stays with the people in it."
      />
      <FiguresBand />
      <div className="grid gap-6 lg:grid-cols-3">
        <AttentionBand className="lg:col-span-2" />
        <SpacesBand />
      </div>
      <PeopleBand />
    </div>
  )
}

const FIGURES: { key: keyof OfficeOverview; label: string; icon: IconName }[] = [
  { key: 'spaces', label: 'Spaces', icon: 'folder' },
  { key: 'running_projects', label: 'Running projects', icon: 'kanban' },
  { key: 'people', label: 'People', icon: 'users' },
  { key: 'needs_attention', label: 'Needs attention', icon: 'alert' },
]

/** The four counts. Zero reads as 0: it is an answer, not a gap. */
function FiguresBand() {
  const { data, failed, load } = useRead(readOverview)

  return (
    <Band name="figures" eyebrow="My office" title="At a glance">
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The office figures did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the figures…</BandLoading>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIGURES.map((f) => {
            const value = data[f.key]
            const urgent = f.key === 'needs_attention' && value > 0
            return (
              <div
                key={f.key}
                data-figure
                className="flex items-center gap-3 rounded-card border border-line p-3.5"
              >
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-icon-tile text-icon-glyph">
                  <Icon name={f.icon} size={17} />
                </span>
                <dt className="min-w-0 flex-1 text-[13px] font-medium text-ink">{f.label}</dt>
                <dd
                  className={`font-mono text-[22px] leading-none font-bold ${
                    urgent ? 'text-warning-700 dark:text-warning-300' : value === 0 ? 'text-faint' : 'text-ink'
                  }`}
                >
                  {value}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </Band>
  )
}

/**
 * Running projects in the office with no project manager, or quiet for two
 * weeks. A line opens its project only when the head is on it; the rest are
 * named and nothing more.
 */
function AttentionBand({ className = '' }: { className?: string }) {
  const { data, failed, load } = useRead(myOfficeAttention)

  return (
    <Band name="attention" eyebrow="Running projects" title="Needs attention" className={className}>
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The projects that need attention did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the running projects…</BandLoading>
      ) : data.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Icon name="checkCircle" size={16} className="shrink-0 text-success-600" />
          Every running project in your office has a project manager and recent activity.
        </p>
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {data.map((p) => (
            <AttentionLine key={p.project_id} project={p} />
          ))}
        </ul>
      )}
    </Band>
  )
}

function AttentionLine({ project: p }: { project: OfficeAttention }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{p.project_name}</span>
        <span className="block truncate text-[12px] text-muted">{p.space_name}</span>
      </span>
      <Badge tone={p.no_pm ? 'warning' : 'pending'}>{attentionReason(p)}</Badge>
    </>
  )

  return (
    <li>
      {p.i_am_on ? (
        <Link
          to={paths.project(p.project_id)}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--surface-sunken)]"
        >
          {body}
          <Icon name="chevronRight" size={15} className="shrink-0 text-faint" />
        </Link>
      ) : (
        // Padded by the chevron and its gap, so both kinds of line end their badge at one edge.
        <div className="flex items-center gap-3 py-2.5 pr-[27px]">{body}</div>
      )}
    </li>
  )
}

/** The office's work spaces, each with its running projects. */
function SpacesBand() {
  const { data, failed, load } = useRead(myOfficeSpaces)

  return (
    <Band name="spaces" eyebrow="Work spaces" title="Spaces">
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The spaces did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the spaces…</BandLoading>
      ) : data.length === 0 ? (
        <p className="text-[13px] text-muted">No work spaces are filed under your office yet.</p>
      ) : (
        <>
          <div aria-hidden className="mb-1 flex justify-between gap-3 text-[12px] text-faint">
            <span>Space</span>
            <span>Running projects</span>
          </div>
          <ul className="divide-y divide-line">
            {data.map((s) => (
              <li key={s.space_id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.space_name}</span>
                <span
                  className={`font-mono text-[14px] ${s.running_projects === 0 ? 'text-faint' : 'text-ink'}`}
                >
                  {s.running_projects}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Band>
  )
}

/** Everyone filed in the office, by name. */
function PeopleBand() {
  const { data, failed, load } = useRead(myOfficePeople)

  return (
    <Band name="people" eyebrow="Filed in this office" title="People">
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The people in your office did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the people…</BandLoading>
      ) : data.length === 0 ? (
        <p className="text-[13px] text-muted">Nobody is filed in your office yet.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
          {data.map((p) => (
            <li key={p.id} className="flex min-w-0 items-center gap-2 py-1.5 text-[14px] text-ink">
              <Icon name="user" size={15} className="shrink-0 text-faint" />
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </Band>
  )
}
