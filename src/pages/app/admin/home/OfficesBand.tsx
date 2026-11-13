import { Link } from 'react-router-dom'
import { Alert } from '../../../../components/ui/Alert'
import { Badge } from '../../../../components/ui/Badge'
import { orgOverview } from '../../../../lib/api/offices'
import { sortOverview } from '../../../../lib/offices'
import type { OfficeOverviewRow } from '../../../../lib/offices'
import { paths } from '../../../../lib/paths'
import { Band, BandLoading } from './Band'
import { useRead } from './useRead'

// Name first and widest; the four figures share the rest. Below `sm` the
// figures drop under the name in a row of four, each with its own label.
const GRID = 'grid grid-cols-4 gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,2.4fr)_repeat(4,minmax(0,1fr))] sm:items-center'
const FIGURES = ['Spaces', 'Running projects', 'People', 'Needs attention'] as const

/** One row per office, Unassigned last. Counts only; each row opens the office. */
export function OfficesBand() {
  const { data, failed, load } = useRead(orgOverview)
  const rows = data ? sortOverview(data) : []
  const noOffices = data !== null && rows.every((r) => r.office_id === null)

  return (
    <Band
      name="offices"
      eyebrow="Organization"
      title="Offices"
      link={{ to: paths.admin.offices, label: 'Open offices' }}
      flush
    >
      {failed ? (
        <div className="p-4 sm:p-5">
          <Alert tone="error" onRetry={load}>
            The offices did not load. Try again in a moment.
          </Alert>
        </div>
      ) : data === null ? (
        <div className="px-4 py-3 sm:px-5">
          <BandLoading>Reading the offices…</BandLoading>
        </div>
      ) : (
        <>
          <div
            aria-hidden
            className={`${GRID} hidden border-b border-line px-5 py-2 text-[12px] text-faint sm:grid`}
          >
            <span>Office</span>
            {FIGURES.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
          <ul aria-label="Offices" className="divide-y divide-line">
            {rows.map((r) => (
              <OfficeRow key={r.office_id ?? 'unassigned'} row={r} />
            ))}
          </ul>
          {noOffices && (
            <p className="border-t border-line px-4 py-3 text-[13px] text-muted sm:px-5">
              No offices yet. Add one on the{' '}
              <Link to={paths.admin.offices} className="font-medium text-ink hover:underline">
                Offices page
              </Link>{' '}
              to group spaces and people.
            </p>
          )}
        </>
      )}
    </Band>
  )
}

function OfficeRow({ row }: { row: OfficeOverviewRow }) {
  const unassigned = row.office_id === null
  const values = [row.spaces, row.running_projects, row.people, row.needs_attention]

  return (
    <li>
      <Link
        data-office-row
        to={`${paths.admin.offices}?office=${row.office_id ?? 'unassigned'}`}
        className={`${GRID} px-4 py-3 transition-colors hover:bg-[var(--surface-sunken)] sm:px-5`}
      >
        <span
          data-office-name
          className={`col-span-4 truncate font-medium sm:col-span-1 ${unassigned ? 'text-muted' : 'text-ink'}`}
        >
          {unassigned ? 'Unassigned' : row.office_name}
        </span>
        {values.map((v, i) => (
          <span key={FIGURES[i]} className="min-w-0">
            <span className="block text-[11px] leading-tight text-faint sm:sr-only">
              {FIGURES[i]}
            </span>
            {i === 3 && v > 0 ? (
              <Badge tone="warning" numeric>
                {v}
              </Badge>
            ) : (
              <span className={`font-mono text-[14px] ${v === 0 ? 'text-faint' : 'text-ink'}`}>
                {v}
              </span>
            )}
          </span>
        ))}
      </Link>
    </li>
  )
}
