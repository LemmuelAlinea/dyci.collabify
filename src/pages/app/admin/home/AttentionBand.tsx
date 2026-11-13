import { Link } from 'react-router-dom'
import { Alert } from '../../../../components/ui/Alert'
import { Badge } from '../../../../components/ui/Badge'
import { Icon } from '../../../../components/ui/Icon'
import { attentionProjects } from '../../../../lib/api/offices'
import { attentionReason } from '../../../../lib/offices'
import type { AttentionProject } from '../../../../lib/offices'
import { paths } from '../../../../lib/paths'
import { Band, BandLoading } from './Band'
import { useRead } from './useRead'

const SHOWN = 6

/**
 * Running projects with no project manager, or quiet for two weeks. Names only:
 * a missing PM opens Work projects at that project's Assign; a quiet project is
 * only named, since nothing here opens a project. The first six show, then how
 * many more, which opens Work projects.
 */
export function AttentionBand({ className = '' }: { className?: string }) {
  const { data, failed, load } = useRead(attentionProjects)
  const rest = (data?.length ?? 0) - SHOWN

  return (
    <Band name="attention" eyebrow="Work projects" title="Needs attention" className={className}>
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The projects that need attention did not load. Try again in a moment.
        </Alert>
      ) : data === null ? (
        <BandLoading>Reading the running projects…</BandLoading>
      ) : data.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Icon name="checkCircle" size={16} className="shrink-0 text-success-600" />
          Every running project has a project manager and recent activity.
        </p>
      ) : (
        <>
          <ul className="-my-1 divide-y divide-line">
            {data.slice(0, SHOWN).map((p) => (
              <AttentionLine key={p.project_id} project={p} />
            ))}
          </ul>
          {rest > 0 && (
            <Link
              data-attention-more
              to={paths.admin.projects}
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
            >
              {rest} more
            </Link>
          )}
        </>
      )}
    </Band>
  )
}

function AttentionLine({ project: p }: { project: AttentionProject }) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{p.project_name}</span>
        <span className="block truncate text-[12px] text-muted">
          {p.space_name} · {p.office_name || 'Unassigned'}
        </span>
      </span>
      <Badge tone={p.no_pm ? 'warning' : 'pending'}>{attentionReason(p)}</Badge>
    </>
  )

  return (
    <li>
      {p.no_pm ? (
        <Link
          to={`${paths.admin.projects}?assign=${encodeURIComponent(p.project_id)}`}
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
