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
