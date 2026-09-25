// src/lib/general/history.ts
import { formatDue } from './dates'
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

function stageName(status: GeneralTaskStatus | undefined) {
  return TASK_STATUSES.find((s) => s.value === status)?.label ?? 'a new stage'
}

/** A title in a log line, short enough to read at a glance. */
function shorten(text: string) {
  const t = text.trim()
  return t.length > 60 ? `${t.slice(0, 57)}…` : t
}

/** One line of a task's history, as a sentence. */
export function describeEvent(event: GeneralTaskEvent, nameOf: (id: string) => string) {
  const actor = event.actor_id ? nameOf(event.actor_id) : 'Somebody'
  const subject = event.detail.user_id
  switch (event.kind) {
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
  }
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
    case 'member_level':
      return `${actor} made ${subject} ${str(d.to) === 'owner' ? 'an Owner' : str(d.to) === 'manager' ? 'a Manager' : 'a Member'}`
    default:
      return `${actor} did something on ${task}`
  }
}

/** The kinds a report's activity filter offers, grouped the way the chips show them. */
export const ACTIVITY_KINDS: { label: string; kinds: string[] }[] = [
  { label: 'Tasks', kinds: ['created', 'updated', 'assigned', 'unassigned', 'task_archived', 'task_restored'] },
  { label: 'Comments', kinds: ['comment'] },
  { label: 'Time', kinds: ['time_logged'] },
  { label: 'Files', kinds: ['file_added', 'file_archived'] },
  { label: 'Repository', kinds: ['commit', 'review_requested', 'review_applied', 'review_declined', 'review_withdrawn', 'review_comment'] },
  { label: 'Project and people', kinds: ['project_status', 'project_archived', 'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level'] },
]

/** Kinds only recorded since general_project_events went live. */
export const LATE_KINDS = ['task_archived', 'task_restored', 'project_status', 'project_archived', 'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level']
