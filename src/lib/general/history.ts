// src/lib/general/history.ts
import { TASK_STATUSES } from './progress'
import type { GeneralTaskEvent } from './types'

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  due_at: 'due date',
  team_id: 'team',
  weight: 'points',
}

function listOf(words: string[]) {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** One line of a task's history, as a sentence. */
export function describeEvent(event: GeneralTaskEvent, nameOf: (id: string) => string) {
  const actor = event.actor_id ? nameOf(event.actor_id) : 'Somebody'
  const subject = event.detail.user_id
  switch (event.kind) {
    case 'created':
      return `${actor} created this task`
    case 'updated': {
      const fields = event.detail.fields ?? []
      if (fields.length === 1 && fields[0] === 'status') {
        const label = TASK_STATUSES.find((s) => s.value === event.detail.status)?.label ?? 'a new stage'
        return `${actor} moved it to ${label}`
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
