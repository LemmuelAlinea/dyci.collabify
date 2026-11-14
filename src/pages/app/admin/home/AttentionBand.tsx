import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { Badge } from '../../../../components/ui/Badge'
import { Icon } from '../../../../components/ui/Icon'
import { spacesWithoutPm } from '../../../../lib/api/offboarding'
import { attentionProjects } from '../../../../lib/api/offices'
import { attentionReason } from '../../../../lib/offices'
import type { AttentionProject } from '../../../../lib/offices'
import { paths } from '../../../../lib/paths'
import { Band, BandLoading } from './Band'
import { SpacePmDialog } from './SpacePmDialog'
import { useRead } from './useRead'

const SHOWN = 6

/**
 * Work spaces with no project manager first, with an Assign; then running projects with no project manager, or quiet for two weeks. Names only:
 * a missing PM opens Work projects at that project's Assign; a quiet project is
 * only named, since nothing here opens a project. The first six show, then how
 * many more, which opens Work projects.
 */
export function AttentionBand({ className = '' }: { className?: string }) {
  const projects = useRead(attentionProjects)
  const spaces = useRead(spacesWithoutPm)
  const [assigning, setAssigning] = useState<{ space_id: string; space_name: string } | null>(null)
  const failed = projects.failed || spaces.failed
  const ready = projects.data !== null && spaces.data !== null
  const lines = [
    ...(spaces.data ?? []).map((s) => ({ kind: 'space' as const, s })),
    ...(projects.data ?? []).map((p) => ({ kind: 'project' as const, p })),
  ]
  const rest = lines.length - SHOWN
  const load = () => {
    projects.load()
    spaces.load()
  }

  return (
    <Band name="attention" eyebrow="Work projects" title="Needs attention" className={className}>
      {failed ? (
        <Alert tone="error" onRetry={load}>
          The projects that need attention did not load. Try again in a moment.
        </Alert>
      ) : !ready ? (
        <BandLoading>Reading the running projects…</BandLoading>
      ) : lines.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Icon name="checkCircle" size={16} className="shrink-0 text-success-600" />
          Every running project has a project manager and recent activity.
        </p>
      ) : (
        <>
          <ul className="-my-1 divide-y divide-line">
            {lines.slice(0, SHOWN).map((l) =>
              l.kind === 'space' ? (
                <SpaceLine key={`space-${l.s.space_id}`} space={l.s} onAssign={() => setAssigning(l.s)} />
              ) : (
                <AttentionLine key={l.p.project_id} project={l.p} />
              ),
            )}
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
      <SpacePmDialog space={assigning} onClose={() => setAssigning(null)} onDone={spaces.load} />
    </Band>
  )
}

function SpaceLine({
  space: s,
  onAssign,
}: {
  space: { space_id: string; space_name: string; office_name: string }
  onAssign: () => void
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{s.space_name}</span>
        <span className="block truncate text-[12px] text-muted">{s.office_name || 'Unassigned'}</span>
      </span>
      <Badge tone="warning">Space has no project manager</Badge>
      <Button size="sm" variant="outline" onClick={onAssign}>
        Assign
      </Button>
    </li>
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
