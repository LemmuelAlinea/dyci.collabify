import type { ReactNode } from 'react'
import { SprintTimeline } from './SprintTimeline'
import { ProgressBar, StatusPill } from './MilestoneBits'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { TilePanel } from '../dashboard/Bento'
import { useNow } from '../../hooks/useNow'
import { dateRange, formatDue } from '../../lib/general/dates'
import type { MilestoneCompletion } from '../../lib/general/milestoneRules'
import { dueLine, waitingLabel } from '../../lib/work/milestones'
import type { WorkSection } from '../../lib/work/nav'
import { daysLeft, daysLeftLabel, sprintCounts } from '../../lib/work/sprints'
import type { SprintOrganization } from '../../lib/work/sprintSettings'
import type { WorkTeams } from '../../lib/work/types'
import { RunningSprintTabs } from './RunningSprintTabs'
import { useRunningSprint } from './useRunningSprint'
import { needsYou, nextMilestone } from '../../lib/work/summary'
import type { Milestone, MilestoneDependency, Sprint, WorkItem } from '../../lib/work/types'

/** Rows shown per Needs you group before "and N more". */
const LIST_CAP = 5

type GlanceProps = {
  /** A work project's sprint organization and teams; a class board has neither. */
  organization?: SprintOrganization
  teams?: WorkTeams
  items: WorkItem[]
  sprints: Sprint[]
  milestones: Milestone[]
  /** Ids of the tasks the viewer holds. */
  mine: ReadonlySet<string>
  /** May plan sprints; the empty sprint card only points to Backlog when true. */
  canPlan: boolean
  /** A work project's milestone completion; left out for a class. */
  completion?: MilestoneCompletion
  /** A work project's milestone links: which milestone waits for which. */
  dependencies?: MilestoneDependency[]
  onOpenTask: (id: string) => void
  onSection: (s: WorkSection) => void
  aside?: ReactNode
}

/**
 * The top of Summary: the running sprint, the next milestone, and what needs
 * the viewer now. The same cards in either space; each one links to the
 * section where that work is done.
 */
export function WorkGlance({ items, sprints, milestones, mine, canPlan, completion, dependencies, organization, teams, onOpenTask, onSection, aside }: GlanceProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SprintCard items={items} sprints={sprints} milestones={milestones} canPlan={canPlan} completion={completion} organization={organization} teams={teams} onSection={onSection} />
      {aside ? (
        <div className="grid gap-4 lg:grid-rows-[auto_1fr]">
          <MilestoneCard items={items} milestones={milestones} completion={completion} dependencies={dependencies} onSection={onSection} />
          {aside}
        </div>
      ) : (
        <MilestoneCard items={items} milestones={milestones} completion={completion} dependencies={dependencies} onSection={onSection} />
      )}
      <div className="lg:col-span-2">
        <NeedsYouCard items={items} mine={mine} onOpenTask={onOpenTask} />
      </div>
    </div>
  )
}

function CardHead({ icon, label, action, onAction }: { icon: IconName; label: string; action: string; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <button
        type="button"
        onClick={onAction}
        className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
      >
        {action}
      </button>
    </div>
  )
}

function Counted({ done, total, noun, pct }: { done: number; total: number; noun: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="text-muted">
          <strong className="text-ink">
            {done} of {total}
          </strong>{' '}
          {noun} done
        </span>
        <span className="font-mono text-faint">{pct}%</span>
      </div>
      <ProgressBar pct={pct} />
    </div>
  )
}

function SprintCard({ items, sprints, milestones, canPlan, completion, organization = 'sequential', teams, onSection }: Pick<GlanceProps, 'items' | 'sprints' | 'milestones' | 'canPlan' | 'completion' | 'organization' | 'teams' | 'onSection'>) {
  const now = useNow()
  const { tabs, activeKey, sprint, pick } = useRunningSprint({
    projectId: teams?.projectId,
    sprints,
    organization,
    teams: teams?.teams ?? [],
    viewerTeamIds: (teams?.members ?? []).filter((m) => m.user_id === teams?.viewerId).map((m) => m.team_id),
  })
  const teamName = organization === 'streams' ? teams?.teams.find((t) => t.id === sprint?.team_id)?.name : undefined

  if (!sprint) {
    const planned = sprints.some((s) => s.state === 'planned')
    return (
      <section className="card relative flex min-h-[310px] flex-col overflow-hidden p-4 shadow-card sm:min-h-[340px] sm:p-5">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(var(--banner-tile-glyph) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(ellipse at center, var(--banner-tile) 0%, transparent 65%)',
          }}
        />
        <span className="eyebrow relative flex items-center gap-2">
          <Icon name="target" size={14} />
          Running sprint
        </span>
        <div className="relative flex flex-1 flex-col items-center justify-center py-5 text-center">
          <span aria-hidden="true" className="relative grid h-28 w-28 place-items-center">
            <span className="absolute inset-0 rounded-full border border-banner-tile-glyph/20" />
            <span className="absolute inset-3 rounded-full border border-banner-tile-glyph/40" />
            <span className="grid h-20 w-20 place-items-center rounded-full border border-banner-tile-glyph/60 bg-banner-tile text-banner-tile-glyph">
              <Icon name="flag" size={34} />
            </span>
          </span>
          <h3 className="mt-3 font-display text-[26px] leading-tight sm:text-[30px]">No active sprint</h3>
          <p className="mt-1.5 max-w-sm text-[13px] text-muted sm:text-[14px]">
            {canPlan ? (planned ? 'Start a planned sprint from Backlog.' : 'Plan your next sprint from Backlog.') : 'A sprint appears here when the team starts one.'}
          </p>
          <button
            type="button"
            onClick={() => onSection('backlog')}
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-banner-tile-glyph/70 bg-banner-tile px-5 py-2.5 font-medium text-banner-tile-glyph transition-colors hover:border-banner-tile-glyph focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-banner-tile-glyph"
          >
            Open Backlog <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </section>
    )
  }

  const { done, total } = sprintCounts(items, sprint.id)
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="target" label={teamName ? `Running sprint · ${teamName}` : 'Running sprint'} action="Open Sprints" onAction={() => onSection('sprints')} />
      {tabs.length > 0 && (
        <div className="mt-3">
          <RunningSprintTabs tabs={tabs} activeKey={activeKey} onPick={pick} />
        </div>
      )}
      <h3 className="mt-2 truncate">{sprint.name}</h3>
      {sprint.goal && <p className="mt-0.5 text-[13px] text-muted">{sprint.goal}</p>}
      <p className="mt-1 text-[12px] text-faint">
        {dateRange(sprint.starts_on, sprint.ends_on)} · {daysLeftLabel(daysLeft(sprint, now))}
      </p>
      <div className="mt-3">
        <Counted done={done} total={total} noun="tasks" pct={pct} />
      </div>
      <div className="mt-4">
        <SprintTimeline sprint={sprint} milestones={milestones} items={items} completion={completion} />
      </div>
    </section>
  )
}

function MilestoneCard({ items, milestones, completion, dependencies, onSection }: Pick<GlanceProps, 'items' | 'milestones' | 'completion' | 'dependencies' | 'onSection'>) {
  const now = useNow()
  const next = nextMilestone(milestones, items, now, completion, dependencies)
  return (
    <section className="card p-4 shadow-card sm:p-5">
      <CardHead icon="pin" label="Next milestone" action="Open Milestones" onAction={() => onSection('milestones')} />
      {!next ? (
        <div className="mt-3">
          <TilePanel icon="pin" title={milestones.length === 0 ? 'No milestones yet.' : 'Every milestone is reached.'} body={milestones.length === 0 ? 'The next milestone shows here when one is added.' : 'The next milestone shows here when one is planned.'} />
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate">{next.milestone.name}</h3>
            <StatusPill status={next.status} />
          </div>
          <p className="mt-1 text-[12px] text-faint">
            {dueLine(next.milestone.due_on, now)}
          </p>
          {next.waitingFor.length > 0 && <p className="mt-1 text-[12px] text-muted">{waitingLabel(next.waitingFor)}</p>}
          <div className="mt-3">
            <Counted done={next.done} total={next.total} noun="tagged tasks" pct={next.pct} />
          </div>
          {next.total === 0 && <p className="mt-2 text-[12px] text-faint">No task counts toward it yet.</p>}
        </>
      )}
    </section>
  )
}

function NeedsYouCard({ items, mine, onOpenTask }: Pick<GlanceProps, 'items' | 'mine' | 'onOpenTask'>) {
  const now = useNow()
  const n = needsYou(items, mine, now)
  const groups = [
    { key: 'overdue', label: 'Overdue', tone: 'text-danger-700 dark:text-danger-300', rows: n.overdue },
    { key: 'soon', label: 'Due soon', tone: 'text-warning-800 dark:text-warning-300', rows: n.dueSoon },
    { key: 'unheld', label: 'Nobody on it', tone: 'text-pending-ink', rows: n.unheld },
  ].filter((g) => g.rows.length > 0)

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <span className="eyebrow flex items-center gap-1.5">
        <Icon name="alert" size={13} />
        Needs you
      </span>
      {groups.length === 0 ? (
        <div className="mt-3">
          <TilePanel icon="checkCircle" title="Nothing needs you right now." body="None of your tasks is late or due in the next 7 days, and every open task has someone on it." />
        </div>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {groups.map((g) => (
            <div key={g.key} className="min-w-0">
              <h4 className={`text-[13px] font-semibold ${g.tone}`}>
                {g.label} <span className="font-mono font-normal text-faint">{g.rows.length}</span>
              </h4>
              <ul className="mt-1.5 space-y-0.5">
                {g.rows.slice(0, LIST_CAP).map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(i.id)}
                      className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                    >
                      <span className="min-w-0 truncate text-[14px] text-ink">{i.title}</span>
                      {i.due_at && (
                        <span className="shrink-0 font-mono text-[11px] text-faint">{formatDue(i.due_at)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {g.rows.length > LIST_CAP && (
                <p className="mt-1 px-2 text-[12px] text-faint">and {g.rows.length - LIST_CAP} more</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
