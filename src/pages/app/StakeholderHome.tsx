import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from '../../components/motion/Reveal'
import { Alert } from '../../components/ui/Alert'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { ProgressBar } from '../../components/work/MilestoneBits'
import { listMyStakeholderProjects } from '../../lib/api/feedback'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import type { StakeholderProject } from '../../lib/general/feedback'
import { paths } from '../../lib/paths'

/**
 * Home for a member who is only a stakeholder. They read projects and give
 * feedback, so this is one card per project: how far along it is, the next
 * milestone, and how much feedback is still open.
 */
export default function StakeholderHome() {
  const [projects, setProjects] = useState<StakeholderProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProjects(await listMyStakeholderProjects())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your projects. Reload to try again.'))
      setProjects((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    document.title = 'Your projects · Collabify'
    void load()
  }, [load])

  return <StakeholderHomeView projects={projects} error={error} onRetry={() => void load()} />
}

export function StakeholderHomeView({
  projects,
  error,
  onRetry,
}: {
  /** Null while loading. */
  projects: StakeholderProject[] | null
  error?: string | null
  onRetry?: () => void
}) {
  return (
    <div className="w-full">
      <Reveal once>
        <section className="relative overflow-hidden rounded-panel border border-banner-ink/10 banner-fill px-5 py-7 text-banner-ink sm:px-7 sm:py-8 lg:px-9 lg:py-10">
          <div
            aria-hidden
            className="banner-deco pointer-events-none absolute -top-56 -right-40 h-[460px] w-[460px] rounded-full blur-[120px]"
            style={{
              background:
                'radial-gradient(circle, color-mix(in oklab, var(--banner-glow) 18%, transparent) 0%, color-mix(in oklab, var(--banner-glow) 5%, transparent) 45%, transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="banner-deco pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px)',
              backgroundSize: '54px 54px',
              maskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
            }}
          />
          <div className="relative max-w-2xl">
            <p className="font-mono text-[12px] tracking-[0.22em] text-banner-accent-soft/75 uppercase">
              Stakeholder
            </p>
            <h1 className="mt-5 font-display leading-tight text-banner-ink">Your projects</h1>
            <p className="mt-3 text-[14px] leading-relaxed text-banner-ink/60">
              See how each project is going and what is due next, then post your feedback where the
              team will see it.
            </p>
          </div>
        </section>
      </Reveal>

      <div className="mt-8">
        {error && (
          <div className="mb-5">
            <Alert tone="error" onRetry={onRetry}>
              {error}
            </Alert>
          </div>
        )}

        {projects === null ? (
          <div className="grid place-items-center py-16 text-faint" role="status" aria-label="Loading your projects">
            <Spinner size={22} />
          </div>
        ) : projects.length === 0 ? (
          error ? null : (
            <EmptyState
              icon="kanban"
              art="projects"
              title="No projects to show"
              body="A project manager adds you to a project as a stakeholder. Invitations arrive in your Inbox."
            />
          )
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p, i) => (
              <Reveal as="li" key={p.project_id} delay={i * 0.04} once>
                <ProjectCard project={p} />
              </Reveal>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ project: p }: { project: StakeholderProject }) {
  const pct = Math.max(0, Math.min(100, Math.round(p.progress_pct)))
  const feedback =
    p.open_feedback === 0 ? 'No open feedback' : `${p.open_feedback} open feedback`
  return (
    <article className="card flex h-full flex-col p-5">
      <h2 className="text-[17px] leading-snug">
        <Link
          to={paths.project(p.project_id)}
          className="text-ink hover:underline focus-visible:underline"
        >
          {p.name}
        </Link>
      </h2>
      {p.space_name && <p className="mt-0.5 text-[13px] text-muted">{p.space_name}</p>}

      <div className="mt-5">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-muted">Progress</span>
          <span className="font-mono text-ink">{pct}%</span>
        </div>
        <div
          className="mt-2"
          role="progressbar"
          aria-label={`${p.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <ProgressBar pct={pct} />
        </div>
      </div>

      <div className="mt-5 flex items-start gap-2.5 text-[13px]">
        <Icon name="calendar" size={16} className="mt-0.5 shrink-0 text-faint" />
        {p.next_milestone_name && p.next_milestone_due ? (
          <p className="min-w-0">
            <span className="block truncate font-medium text-ink">{p.next_milestone_name}</span>
            <span className="text-muted">Due {formatDay(p.next_milestone_due)}</span>
          </p>
        ) : (
          <p className="text-muted">No milestone set</p>
        )}
      </div>

      <div className="mt-auto pt-5">
        <Link
          to={`${paths.project(p.project_id)}?tab=feedback`}
          className="-my-2 inline-flex items-center gap-2 py-2 text-[13px] font-medium text-ink hover:underline focus-visible:underline"
        >
          <Icon name="message" size={16} className="text-faint" />
          {feedback}
        </Link>
      </div>
    </article>
  )
}
