/**
 * What a General report shows, as one plain object.
 *
 * The URL is the source of truth: every choice in the builder is written to
 * short query keys, so a report can be bookmarked, shared, and reopened as it
 * was. Saved templates store the same object. Anything that arrives from
 * outside — a URL somebody edited, a template saved by an older version — goes
 * through `parseConfig`, which keeps what it recognises and falls back to the
 * default for anything it does not.
 */
import { RANGE_PRESETS, isDay } from './reportRange'
import type { RangePreset } from './reportRange'

export type ReportSectionId =
  | 'summary'
  | 'narrative'
  | 'progress'
  | 'status'
  | 'forecast'
  | 'people'
  | 'score'
  | 'activity'
  | 'tasks'
  | 'timeLogs'
  | 'commits'
  | 'reviews'
  | 'projectComparison'

export const SECTION_IDS: ReportSectionId[] = [
  'summary',
  'narrative',
  'progress',
  'status',
  'forecast',
  'projectComparison',
  'people',
  'score',
  'activity',
  'tasks',
  'timeLogs',
  'commits',
  'reviews',
]

export const SECTION_LABELS: Record<ReportSectionId, string> = {
  summary: 'Key figures',
  narrative: 'Summary in words',
  progress: 'Progress over time',
  status: 'Task status',
  forecast: 'Forecast',
  projectComparison: 'Project comparison',
  people: 'Who did what',
  score: 'Contribution score',
  activity: 'Activity timeline',
  tasks: 'Tasks',
  timeLogs: 'Time logs',
  commits: 'Commits',
  reviews: 'Reviews',
}

export type ActivityGroup = 'day' | 'person' | 'project'

export type ScoreWeights = { points: number; hours: number; repo: number; comments: number }

export const DEFAULT_WEIGHTS: ScoreWeights = { points: 50, hours: 20, repo: 20, comments: 10 }

export interface ReportConfig {
  version: 1
  scope: 'project' | 'space'
  projectIds: string[] | 'all'
  range: { preset: RangePreset; from?: string; to?: string }
  compare: boolean
  people: string[]
  teams: string[]
  includeArchived: boolean
  sections: Record<ReportSectionId, boolean>
  activityKinds: string[]
  groupActivityBy: ActivityGroup
  score: { weights: ScoreWeights }
  title?: string
  note?: string
  /** Which preset it started from, if any. Only for the builder's highlight. */
  preset?: ReportPresetId
}

export type ReportPresetId = 'weekly' | 'person' | 'closeout' | 'overview'

function sections(on: ReportSectionId[]): Record<ReportSectionId, boolean> {
  return Object.fromEntries(SECTION_IDS.map((id) => [id, on.includes(id)])) as Record<
    ReportSectionId,
    boolean
  >
}

export function defaultConfig(scope: 'project' | 'space' = 'space'): ReportConfig {
  return {
    version: 1,
    scope,
    projectIds: 'all',
    range: { preset: 'last30' },
    compare: false,
    people: [],
    teams: [],
    includeArchived: false,
    sections: sections(
      scope === 'space'
        ? ['summary', 'narrative', 'progress', 'status', 'projectComparison', 'people', 'activity']
        : ['summary', 'narrative', 'progress', 'status', 'forecast', 'people', 'activity', 'tasks'],
    ),
    activityKinds: [],
    groupActivityBy: 'day',
    score: { weights: { ...DEFAULT_WEIGHTS } },
  }
}

export const PRESETS: { id: ReportPresetId; label: string; body: string }[] = [
  { id: 'weekly', label: 'Weekly status', body: 'The last seven days against the week before.' },
  { id: 'person', label: 'Person report', body: 'One person over the last 30 days, across the space.' },
  { id: 'closeout', label: 'Project close-out', body: 'One project from start to end, in full.' },
  { id: 'overview', label: 'Space overview', body: 'Every project this month, side by side.' },
]

/** A preset's config. `projectId` is the project in view, `personId` whoever the report is about. */
export function presetConfig(
  id: ReportPresetId,
  ctx: { projectId?: string | null; personId?: string | null } = {},
): ReportConfig {
  const base = defaultConfig(ctx.projectId ? 'project' : 'space')
  const project = ctx.projectId ? [ctx.projectId] : 'all'
  switch (id) {
    case 'weekly':
      return {
        ...base,
        preset: id,
        projectIds: project,
        range: { preset: 'last7' },
        compare: true,
        sections: sections(['summary', 'narrative', 'progress', 'status', 'activity', 'tasks']),
      }
    case 'person':
      return {
        ...base,
        preset: id,
        scope: 'space',
        projectIds: 'all',
        range: { preset: 'last30' },
        people: ctx.personId ? [ctx.personId] : [],
        groupActivityBy: 'project',
        sections: sections(['summary', 'people', 'activity', 'timeLogs', 'commits', 'reviews']),
      }
    case 'closeout':
      return {
        ...base,
        preset: id,
        scope: 'project',
        projectIds: project,
        range: { preset: 'projectDuration' },
        sections: sections(SECTION_IDS.filter((s) => s !== 'projectComparison' && s !== 'score')),
      }
    case 'overview':
      return {
        ...base,
        preset: id,
        scope: 'space',
        projectIds: 'all',
        range: { preset: 'thisMonth' },
        compare: true,
        sections: sections(['summary', 'narrative', 'projectComparison', 'people', 'status']),
      }
  }
}

/* ------------------------------------------------------------- validating */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ids = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))] : []
const KINDS = /^[a-z_]{1,40}$/
const clampWeight = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback
}
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined

export function parseConfig(input: unknown): ReportConfig {
  const raw = isObj(input) ? input : {}
  const scope = raw.scope === 'project' ? 'project' : 'space'
  const out = defaultConfig(scope)

  if (raw.projectIds === 'all') out.projectIds = 'all'
  else if (Array.isArray(raw.projectIds)) {
    const list = ids(raw.projectIds)
    out.projectIds = list.length ? list : 'all'
  }

  const range = raw.range
  if (isObj(range)) {
    const preset = RANGE_PRESETS.some((p) => p.value === range.preset)
      ? (range.preset as RangePreset)
      : out.range.preset
    out.range = { preset }
    if (isDay(range.from)) out.range.from = range.from
    if (isDay(range.to)) out.range.to = range.to
  }

  out.compare = raw.compare === true
  out.people = ids(raw.people)
  out.teams = ids(raw.teams)
  out.includeArchived = raw.includeArchived === true

  if (isObj(raw.sections)) {
    const given = raw.sections
    out.sections = Object.fromEntries(
      SECTION_IDS.map((id) => [id, typeof given[id] === 'boolean' ? given[id] : out.sections[id]]),
    ) as Record<ReportSectionId, boolean>
  }

  if (Array.isArray(raw.activityKinds)) {
    out.activityKinds = [
      ...new Set(raw.activityKinds.filter((k): k is string => typeof k === 'string' && KINDS.test(k))),
    ]
  }
  if (raw.groupActivityBy === 'person' || raw.groupActivityBy === 'project') {
    out.groupActivityBy = raw.groupActivityBy
  }

  const w = isObj(raw.score) && isObj(raw.score.weights) ? raw.score.weights : {}
  out.score = {
    weights: {
      points: clampWeight(w.points, DEFAULT_WEIGHTS.points),
      hours: clampWeight(w.hours, DEFAULT_WEIGHTS.hours),
      repo: clampWeight(w.repo, DEFAULT_WEIGHTS.repo),
      comments: clampWeight(w.comments, DEFAULT_WEIGHTS.comments),
    },
  }

  const title = text(raw.title, 120)
  const note = text(raw.note, 2000)
  if (title) out.title = title
  if (note) out.note = note
  if (raw.preset === 'weekly' || raw.preset === 'person' || raw.preset === 'closeout' || raw.preset === 'overview') {
    out.preset = raw.preset
  }
  return out
}

/* ------------------------------------------------------------------- URLs */

const SECTION_KEYS: Record<ReportSectionId, string> = {
  summary: 'su',
  narrative: 'na',
  progress: 'pr',
  status: 'st',
  forecast: 'fo',
  projectComparison: 'pc',
  people: 'pe',
  score: 'sc',
  activity: 'ac',
  tasks: 'ta',
  timeLogs: 'tl',
  commits: 'co',
  reviews: 'rv',
}

/** Short keys, so a shared link stays readable. Only what differs from nothing is written. */
export function toSearchParams(config: ReportConfig) {
  const q = new URLSearchParams()
  q.set('s', config.scope)
  q.set('p', config.projectIds === 'all' ? 'all' : config.projectIds.join(','))
  q.set('r', config.range.preset)
  if (config.range.from) q.set('f', config.range.from)
  if (config.range.to) q.set('t', config.range.to)
  if (config.compare) q.set('c', '1')
  if (config.people.length) q.set('who', config.people.join(','))
  if (config.teams.length) q.set('tm', config.teams.join(','))
  if (config.includeArchived) q.set('a', '1')
  q.set('x', SECTION_IDS.filter((id) => config.sections[id]).map((id) => SECTION_KEYS[id]).join('.'))
  if (config.activityKinds.length) q.set('k', config.activityKinds.join(','))
  if (config.groupActivityBy !== 'day') q.set('g', config.groupActivityBy)
  const w = config.score.weights
  if (w.points !== DEFAULT_WEIGHTS.points || w.hours !== DEFAULT_WEIGHTS.hours ||
      w.repo !== DEFAULT_WEIGHTS.repo || w.comments !== DEFAULT_WEIGHTS.comments) {
    q.set('w', [w.points, w.hours, w.repo, w.comments].join('.'))
  }
  if (config.title) q.set('ti', config.title)
  if (config.note) q.set('n', config.note)
  if (config.preset) q.set('ps', config.preset)
  return q
}

export function fromSearchParams(q: URLSearchParams): ReportConfig {
  const list = (key: string) => (q.get(key) ?? '').split(',').filter(Boolean)
  const scope = q.get('s') === 'project' ? 'project' : 'space'
  const raw: Record<string, unknown> = { scope }
  const p = q.get('p')
  raw.projectIds = !p || p === 'all' ? 'all' : list('p')
  raw.range = { preset: q.get('r') ?? undefined, from: q.get('f') ?? undefined, to: q.get('t') ?? undefined }
  raw.compare = q.get('c') === '1'
  raw.people = list('who')
  raw.teams = list('tm')
  raw.includeArchived = q.get('a') === '1'
  if (q.has('x')) {
    const on = new Set((q.get('x') ?? '').split('.'))
    raw.sections = Object.fromEntries(SECTION_IDS.map((id) => [id, on.has(SECTION_KEYS[id])]))
  }
  raw.activityKinds = list('k')
  raw.groupActivityBy = q.get('g') ?? 'day'
  const w = (q.get('w') ?? '').split('.').map(Number)
  if (w.length === 4) raw.score = { weights: { points: w[0], hours: w[1], repo: w[2], comments: w[3] } }
  raw.title = q.get('ti') ?? undefined
  raw.note = q.get('n') ?? undefined
  raw.preset = q.get('ps') ?? undefined
  return parseConfig(raw)
}
