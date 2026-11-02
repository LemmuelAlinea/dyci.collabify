// src/lib/general/history.ts
import { formatDue } from './dates'
import { ROLE_LABEL } from './permissions'
import type { ProjectRole } from './permissions'
import { TASK_STATUSES } from './progress'
import type { GeneralTaskStatus } from './progress'
import type { GeneralTaskEvent } from './types'

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  due_at: 'due date',
  starts_at: 'start date',
  team_id: 'team',
  weight: 'points',
}

function listOf(words: string[]) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

const capital = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`

function stageName(status: GeneralTaskStatus | undefined) {
  return TASK_STATUSES.find((s) => s.value === status)?.label ?? 'a new stage'
}

/** A title in a log line, short enough to read at a glance. */
function shorten(text: string, max = 60) {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 3)}…` : t
}

const HANDOFF_WORDS = {
  sent_to_coordinator: 'sent %s to a coordinator',
  sent_to_team: 'sent %s to a team',
  returned: 'returned %s to planning',
  rerouted: 'rerouted %s to another team',
} as const

const NOTIFIED = {
  team_lead: 'the team lead',
  planners: 'the project manager and coordinators',
  qa: 'QA',
  holders: "the task's holders",
  person: 'one person',
} as const

/**
 * What a workflow rule did, as a sentence naming the rule: "Moved it to Review
 * by the rule “Tell QA”". `task` is the task as the line names it ("it" inside
 * the task, its title in a report); `assignee` is who an assign rule gave it to.
 */
function ruleLine(detail: GeneralTaskEvent['detail'], task: string, assignee: string) {
  const inTask = task === 'it'
  let what: string
  switch (detail.action) {
    case 'notify':
      what = `Notified ${detail.notify_to ? NOTIFIED[detail.notify_to] : 'somebody'}${inTask ? '' : ` about ${task}`}`
      break
    case 'set_priority':
      what = `Set the priority${inTask ? '' : ` of ${task}`} to ${detail.priority ? capital(detail.priority) : 'a new level'}`
      break
    case 'assign':
      what = `Assigned ${task} to ${assignee}`
      break
    case 'move_stage':
      what = detail.stage_from ? `Moved ${task} from ${detail.stage_from} to ${detail.stage}` : `Moved ${task} to ${detail.stage ?? 'a new stage'}`
      break
    default:
      what = `Changed ${task}`
  }
  return `${what} by the rule “${detail.rule_name ?? 'a rule'}”`
}

/** One line of a task's history, as a sentence. */
export function describeEvent(event: GeneralTaskEvent, nameOf: (id: string) => string) {
  const actor = event.actor_id ? nameOf(event.actor_id) : 'Somebody'
  const subject = event.detail.user_id
  switch (event.kind) {
    case 'sent_to_coordinator':
    case 'sent_to_team':
    case 'returned':
    case 'rerouted':
      return `${actor} ${HANDOFF_WORDS[event.kind].replace('%s', 'it')}${event.detail.reason ? `: ${event.detail.reason}` : ''}`
    case 'created':
      return `${actor} created this task`
    case 'updated': {
      const d = event.detail
      const fields = d.fields ?? []

      // One field changed, and we know what it was: say so, because "changed
      // the title" is the answer to a question nobody asked.
      if (fields.length === 1) {
        if (fields[0] === 'status') {
          return d.status_from
            ? `${actor} moved it from ${stageName(d.status_from)} to ${stageName(d.status)}`
            : `${actor} moved it to ${stageName(d.status)}`
        }
        if (fields[0] === 'title' && d.title_from && d.title_to) {
          return `${actor} renamed it from "${shorten(d.title_from)}" to "${shorten(d.title_to)}"`
        }
        if (fields[0] === 'due_at' && d.due_to !== undefined) {
          if (!d.due_to) return `${actor} took the due date off`
          return d.due_from
            ? `${actor} moved the due date from ${formatDue(d.due_from)} to ${formatDue(d.due_to)}`
            : `${actor} set the due date to ${formatDue(d.due_to)}`
        }
        if (fields[0] === 'starts_at' && d.starts_to !== undefined) {
          if (!d.starts_to) return `${actor} took the start date off`
          return d.starts_from
            ? `${actor} moved the start from ${formatDue(d.starts_from)} to ${formatDue(d.starts_to)}`
            : `${actor} set the start to ${formatDue(d.starts_to)}`
        }
        if (fields[0] === 'weight' && d.weight_to !== undefined) {
          return `${actor} changed the points from ${d.weight_from} to ${d.weight_to}`
        }
      }

      return `${actor} changed the ${listOf(fields.map((f) => FIELD_WORDS[f] ?? f))}`
    }
    case 'assigned':
      return subject === event.actor_id
        ? `${actor} took this task`
        : `${actor} assigned it to ${subject ? nameOf(subject) : 'somebody'}`
    case 'unassigned':
      return subject === event.actor_id
        ? `${actor} released this task`
        : `${actor} took ${subject ? nameOf(subject) : 'somebody'} off it`
    case 'qa_passed':
      return `${actor} passed it`
    case 'qa_sent_back': {
      const note = event.detail.note?.trim()
      return note ? `${actor} sent it back: ${shorten(note, 120)}` : `${actor} sent it back`
    }
    case 'rule_applied':
      return ruleLine(event.detail, 'it', subject ? nameOf(subject) : 'somebody')
  }
}

/** A history row as far as folding a rule's change needs it. */
type FoldRow = { kind: string; actor_id: string | null; task_id: string | null; detail: Record<string, unknown> }

const fieldsOf = (r: FoldRow) => (Array.isArray(r.detail.fields) ? (r.detail.fields as unknown[]) : [])

/**
 * Whether `row` is the row the history triggers wrote, with no actor, for the
 * change the rule_applied row `rule` already describes. Only an action that
 * writes the task leaves one: set_priority (an 'updated' row of the priority
 * alone, should the trigger record it), move_stage (an 'updated' row of the
 * status alone; a move between two middle stages leaves none) and assign (an
 * 'assigned' row, for the same person when both rows name them). A notify rule
 * writes nothing on the task, so nothing is folded into it.
 */
function isCompanion(rule: FoldRow, row: FoldRow) {
  if (row.actor_id !== null) return false
  const fields = fieldsOf(row)
  const only = (field: string) => fields.length === 1 && fields[0] === field
  switch (rule.detail.action) {
    case 'set_priority':
      return row.kind === 'updated' && only('priority')
    case 'move_stage':
      return row.kind === 'updated' && only('status')
    case 'assign':
      return row.kind === 'assigned' && (!rule.detail.user_id || !row.detail.user_id || rule.detail.user_id === row.detail.user_id)
    default:
      return false
  }
}

/**
 * Rows in the order given, each rule change's companion folded into its
 * rule_applied row. A rule's change writes two rows at the same instant on the
 * same task: its own rule_applied row, and the row the history triggers write
 * for any change, with no actor. The rule line already says it, so the second
 * row would only read as "Somebody ...". Each rule row takes at most one
 * companion, which comes back beside it. Used by a task's history and by a
 * report's timeline and CSV.
 */
export function foldRuleCompanions<T extends FoldRow>(rows: readonly T[], at: (row: T) => string) {
  const key = (r: T) => `${r.task_id}|${at(r)}`
  const folded = new Set<T>()
  const companionOf = new Map<T, T>()
  for (const rule of rows) {
    if (rule.kind !== 'rule_applied') continue
    const companion = rows.find((r) => !folded.has(r) && key(r) === key(rule) && isCompanion(rule, r))
    if (companion) {
      folded.add(companion)
      companionOf.set(rule, companion)
    }
  }
  return rows.filter((r) => !folded.has(r)).map((row) => ({ row, companion: companionOf.get(row) }))
}

/** A task's history as lines, newest first as given, with rule changes folded. */
export function describeHistory(events: readonly GeneralTaskEvent[], nameOf: (id: string) => string) {
  return foldRuleCompanions(events, (e) => e.created_at).map(({ row: e }) => ({ id: e.id, event: e, text: describeEvent(e, nameOf) }))
}

/** One row of a report's activity timeline: what `general_report_activity` returns. */
export type ActivityEvent = {
  kind: string
  actor_name: string | null
  subject_name: string | null
  task_title: string | null
  detail: Record<string, unknown>
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const numOf = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

/**
 * A report's activity rows with rule changes folded, as the timeline and the
 * CSV both read them. A report leaves user_id out of a row's detail, so an
 * assign rule's line takes the person from the 'assigned' row it folds.
 */
export function foldActivity<T extends ActivityEvent & { at: string; actor_id: string | null; task_id: string | null }>(
  rows: readonly T[],
): T[] {
  return foldRuleCompanions(rows, (r) => r.at).map(({ row, companion }) =>
    companion && row.subject_name === null ? { ...row, subject_name: companion.subject_name } : row,
  )
}

/** "a coordinator", "the project manager", "QA": what follows "is now". */
function rolePhrase(role: string) {
  const label = ROLE_LABEL[role as ProjectRole]
  if (!label) return 'a member'
  if (role === 'pm') return `the ${label.toLowerCase()}`
  if (role === 'qa') return label
  return `a ${label.toLowerCase()}`
}

/** Who did a report row: a person's name, "A rule" for a rule's change, else "Somebody". */
export function activityWho(e: Pick<ActivityEvent, 'kind' | 'actor_name'>) {
  return e.kind === 'rule_applied' ? 'A rule' : e.actor_name ?? 'Somebody'
}

/**
 * A report timeline line, as a sentence. Unlike `describeEvent`, which reads
 * inside one task, this one names the task, and covers every kind of activity
 * a report collects. A name the viewer may not see comes through as null and
 * reads as "Somebody".
 */
export function describeActivity(e: ActivityEvent) {
  const actor = e.actor_name ?? 'Somebody'
  const subject = e.subject_name ?? 'somebody'
  const task = e.task_title ? `"${shorten(e.task_title)}"` : 'a task'
  const d = e.detail
  switch (e.kind) {
    case 'sent_to_coordinator':
    case 'sent_to_team':
    case 'returned':
    case 'rerouted':
      return `${actor} ${HANDOFF_WORDS[e.kind].replace('%s', task)}${str(d.reason) ? `: ${str(d.reason)}` : ''}`
    case 'created':
      return `${actor} created ${task}`
    case 'updated': {
      const fields = Array.isArray(d.fields) ? (d.fields as string[]) : []
      if (fields.length === 1 && fields[0] === 'status') {
        return `${actor} moved ${task} to ${stageName(str(d.status) as GeneralTaskStatus)}`
      }
      return `${actor} changed the ${listOf(fields.map((f) => FIELD_WORDS[f] ?? f))} of ${task}`
    }
    case 'assigned':
      return e.subject_name && e.subject_name === e.actor_name
        ? `${actor} took ${task}`
        : `${actor} assigned ${task} to ${subject}`
    case 'unassigned':
      return e.subject_name && e.subject_name === e.actor_name
        ? `${actor} released ${task}`
        : `${actor} took ${subject} off ${task}`
    case 'qa_passed':
      return `${actor} passed ${task}`
    case 'qa_sent_back':
      return `${actor} sent ${task} back`
    case 'rule_applied':
      return ruleLine(d as GeneralTaskEvent['detail'], task, subject)
    case 'comment':
      return `${actor} commented on ${task}`
    case 'time_logged': {
      const m = numOf(d.minutes)
      const h = Math.round((m / 60) * 10) / 10
      return `${actor} logged ${h} ${h === 1 ? 'hour' : 'hours'} on ${task}`
    }
    case 'file_added':
      return `${actor} attached ${str(d.file_name) || 'a file'} to ${task}`
    case 'file_archived':
      return `${actor} archived ${str(d.file_name) || 'a file'} on ${task}`
    case 'commit': {
      const n = numOf(d.added) + numOf(d.changed) + numOf(d.removed)
      return `${actor} committed "${shorten(str(d.message))}" (${n} ${n === 1 ? 'file' : 'files'})`
    }
    case 'review_requested':
      return `${actor} asked ${subject} to review "${shorten(str(d.title))}"`
    case 'review_applied':
      return `${actor} merged "${shorten(str(d.title))}"`
    case 'review_declined':
      return `${actor} declined "${shorten(str(d.title))}"`
    case 'review_withdrawn':
      return `${actor} withdrew "${shorten(str(d.title))}"`
    case 'review_comment':
      return `${actor} commented on the review "${shorten(str(d.title))}"`
    case 'task_archived':
      return `${actor} archived ${task}`
    case 'task_restored':
      return `${actor} restored ${task}`
    case 'project_status':
      return `${actor} set the project to ${str(d.to).replace('_', ' ') || 'a new status'}`
    case 'project_archived':
      return `${actor} archived the project`
    case 'project_restored':
      return `${actor} restored the project`
    case 'member_joined':
      return e.actor_name && e.actor_name !== e.subject_name
        ? `${actor} added ${subject} to the project`
        : `${subject[0].toUpperCase()}${subject.slice(1)} joined the project`
    case 'member_left':
      return `${subject[0].toUpperCase()}${subject.slice(1)} left the project`
    case 'member_removed':
      return `${actor} removed ${subject} from the project`
    // Rows from before roles, kept readable.
    case 'member_level':
      return `${actor} made ${subject} ${str(d.to) === 'owner' ? 'an Owner' : str(d.to) === 'manager' ? 'a Manager' : 'a Member'}`
    case 'member_role':
      return `${capital(subject)} is now ${rolePhrase(str(d.to))}`
    case 'pm_handover':
      return `${actor} handed the project to ${subject}`
    case 'team_leader': {
      const team = str(d.team_name)
      return d.to
        ? `${capital(subject)} now leads ${team || 'a team'}`
        : `${team || 'A team'} has no leader`
    }
    default:
      return `${actor} did something on ${task}`
  }
}

/** The kinds a report's activity filter offers, grouped the way the chips show them. */
export const ACTIVITY_KINDS: { label: string; kinds: string[] }[] = [
  { label: 'Tasks', kinds: ['created', 'updated', 'assigned', 'unassigned', 'qa_passed', 'qa_sent_back', 'rule_applied', 'task_archived', 'task_restored'] },
  { label: 'Comments', kinds: ['comment'] },
  { label: 'Time', kinds: ['time_logged'] },
  { label: 'Files', kinds: ['file_added', 'file_archived'] },
  { label: 'Repository', kinds: ['commit', 'review_requested', 'review_applied', 'review_declined', 'review_withdrawn', 'review_comment'] },
  { label: 'Project and people', kinds: ['project_status', 'project_archived', 'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level', 'member_role', 'pm_handover', 'team_leader'] },
]

/** Kinds only recorded since general_project_events went live. */
export const LATE_KINDS = ['task_archived', 'task_restored', 'project_status', 'project_archived', 'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level', 'member_role', 'pm_handover', 'team_leader']
