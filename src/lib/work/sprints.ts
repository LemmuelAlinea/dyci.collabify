/**
 * Sprint arithmetic for Backlog, Sprints and Summary. Calendar days are
 * YYYY-MM-DD strings read as local midnight, the way a project's dates are,
 * so a sprint ending "the 18th" ends on the 18th wherever the reader is.
 */
import { startWeekdayOf, type SprintOrganization, type SprintSettings } from './sprintSettings'
import type { Milestone, Sprint, SprintInput, WorkItem } from './types'

export const SPRINT_DAYS = 14

function parse(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toDay(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(day: string, n: number) {
  const d = parse(day)
  return toDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime())
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function dayDiff(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

export function runningSprint(sprints: readonly Sprint[]) {
  return sprints.find((s) => s.state === 'active') ?? null
}

/** Every running sprint, the one ending soonest first. */
export function runningSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'active')
    .sort((a, b) => a.ends_on.localeCompare(b.ends_on) || a.created_at.localeCompare(b.created_at))
}

/**
 * Why this sprint cannot start, or null when it can. Mirrors
 * check_general_sprint_start in supabase/sprint-organization.sql, which decides.
 */
export function canStartSprint(
  sprint: Sprint,
  sprints: readonly Sprint[],
  organization: SprintOrganization,
  context: {
    teamName?: (id: string) => string | undefined
    items?: readonly Pick<WorkItem, 'sprint_id' | 'status' | 'teamId'>[]
  } = {},
): string | null {
  if (organization === 'parallel') return null
  const others = sprints.filter((s) => s.state === 'active' && s.id !== sprint.id)
  if (organization === 'sequential') return others[0] ? `Finish ${others[0].name} first.` : null

  if (!sprint.team_id) return 'Give this sprint a team first.'
  const same = others.find((s) => s.team_id === sprint.team_id)
  if (same) return `${context.teamName?.(sprint.team_id) ?? 'This team'} is already running ${same.name}.`
  const foreign = (context.items ?? []).filter(
    (i) => i.sprint_id === sprint.id && i.status !== 'done' && (i.teamId ?? null) !== sprint.team_id,
  ).length
  if (foreign === 1) return '1 task in this sprint belongs to another team. Move it out first.'
  if (foreign > 1) return `${foreign} tasks in this sprint belong to another team. Move them out first.`
  return null
}

export type RunningTab = { key: string; label: string; sprint: Sprint | null }

type TabTeam = { id: string; name: string; archived_at?: string | null }

/**
 * The switcher over several running sprints. Streams has a tab per team: those
 * running a sprint, the viewer's own first, then idle teams (no sprint to show).
 * Parallel has a tab per running sprint. Empty when there is nothing to switch.
 */
export function runningTabs(
  sprints: readonly Sprint[],
  organization: SprintOrganization,
  teams: readonly TabTeam[],
  viewerTeamIds: readonly string[],
): RunningTab[] {
  if (organization === 'sequential') return []
  const running = runningSprints(sprints)
  if (running.length === 0) return []
  if (organization === 'parallel') {
    return running.length > 1 ? running.map((s) => ({ key: s.id, label: s.name, sprint: s })) : []
  }

  const live = teams.filter((t) => !t.archived_at)
  const mine = (id: string | null | undefined) => (id && viewerTeamIds.includes(id) ? 0 : 1)
  const active = [...running]
    .sort((a, b) => mine(a.team_id) - mine(b.team_id))
    .map((s) => ({
      key: s.team_id ?? s.id,
      label: live.find((t) => t.id === s.team_id)?.name ?? s.name,
      sprint: s as Sprint | null,
    }))
  const idle = live
    .filter((t) => !running.some((s) => s.team_id === t.id))
    .map((t) => ({ key: t.id, label: t.name, sprint: null }))
  const tabs = [...active, ...idle]
  return tabs.length > 1 ? tabs : []
}

/** How a sprint reads in a "Move to" list. */
export function sprintTargetLabel(sprint: Sprint, teamName: (id: string) => string | undefined) {
  const team = sprint.team_id ? teamName(sprint.team_id) : undefined
  const running = sprint.state === 'active'
  if (team) return `${sprint.name} · ${team}${running ? ' · running' : ''}`
  return running ? `${sprint.name} (running)` : sprint.name
}

export function plannedSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'planned')
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.created_at.localeCompare(b.created_at))
}

export function finishedSprints(sprints: readonly Sprint[], archived = false) {
  return sprints
    .filter((s) => s.state === 'completed' && s.archived === archived)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
}

export function sprintLength(sprint: Pick<Sprint, 'starts_on' | 'ends_on'>) {
  return dayDiff(sprint.starts_on, sprint.ends_on) + 1
}

/** Days from today through the last day, today included: 1 on the last day, 0 the day after. */
export function daysLeft(sprint: Pick<Sprint, 'ends_on'>, now = Date.now()) {
  return dayDiff(toDay(now), sprint.ends_on) + 1
}

export function daysLeftLabel(n: number) {
  if (n > 1) return `${n} days left`
  if (n === 1) return 'Last day'
  if (n === 0) return 'Ended yesterday'
  return `Ended ${1 - n} days ago`
}

/**
 * The next sprint: named in sequence, starting the day after the latest one ends, or today.
 * With a project's settings it runs that many days and starts on the first set weekday
 * from there; without them (a class board) it runs 14 days from that day. With a team it
 * follows that team's sprints alone and carries the team's name.
 */
export function nextSprintDraft(
  sprints: readonly Sprint[],
  now = Date.now(),
  settings?: SprintSettings,
  team?: { id: string; name: string },
): SprintInput {
  const chain = team ? sprints.filter((s) => s.team_id === team.id) : sprints
  const today = toDay(now)
  const latest = chain.reduce<string | null>((max, s) => (max && max > s.ends_on ? max : s.ends_on), null)
  let startsOn = latest && addDays(latest, 1) > today ? addDays(latest, 1) : today
  if (settings) {
    const weekday = startWeekdayOf(settings, chain)
    const [y, m, d] = startsOn.split('-').map(Number)
    startsOn = addDays(startsOn, (weekday - new Date(y, m - 1, d).getDay() + 7) % 7)
  }
  return {
    name: team ? `${team.name} sprint ${chain.length + 1}` : `Sprint ${chain.length + 1}`,
    goal: '',
    startsOn,
    endsOn: addDays(startsOn, (settings?.lengthDays ?? SPRINT_DAYS) - 1),
    ...(team ? { teamId: team.id } : {}),
  }
}

export function sprintCounts(items: readonly WorkItem[], sprintId: string) {
  const mine = items.filter((i) => i.sprint_id === sprintId)
  return { done: mine.filter((i) => i.status === 'done').length, total: mine.length }
}

export type TimelineState = 'done' | 'today' | 'late' | 'upcoming'
/** `marker` is the Today point, added when no checkpoint falls on today. */
export type TimelinePoint = { day: string; label: string; state: TimelineState; marker?: boolean }

/**
 * The checkpoints a running sprint passes: its first day, the milestones due
 * inside it, and its last day, with Today placed among them. A milestone is
 * done once reached and late once its day passes without that.
 */
export function sprintTimeline<M extends Pick<Milestone, 'id' | 'name' | 'due_on'>>(
  sprint: Pick<Sprint, 'starts_on' | 'ends_on'>,
  milestones: readonly M[],
  reached: (m: M) => boolean,
  now = Date.now(),
): TimelinePoint[] {
  const today = toDay(now)
  const ahead = (day: string): TimelineState => (day === today ? 'today' : 'upcoming')
  const points: TimelinePoint[] = [
    { day: sprint.starts_on, label: 'Kickoff', state: sprint.starts_on <= today ? 'done' : 'upcoming' },
    ...milestones
      .flatMap((m) => (m.due_on !== null && m.due_on > sprint.starts_on && m.due_on <= sprint.ends_on ? [{ m, day: m.due_on }] : []))
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ m, day }) => ({
        day,
        label: m.name,
        state: reached(m) ? ('done' as const) : day < today ? ('late' as const) : ahead(day),
      })),
    { day: sprint.ends_on, label: 'Sprint ends', state: sprint.ends_on < today ? 'done' : ahead(sprint.ends_on) },
  ]
  if (today > sprint.starts_on && today < sprint.ends_on && !points.some((p) => p.day === today)) {
    const at = points.findIndex((p) => p.day > today)
    points.splice(at, 0, { day: today, label: 'Today', state: 'today', marker: true })
  }
  return points
}

/** The next checkpoint still to come, today included; null once the sprint is over. */
export function nextCheckpoint(points: readonly TimelinePoint[]) {
  return points.find((p) => !p.marker && (p.state === 'today' || p.state === 'upcoming')) ?? null
}
