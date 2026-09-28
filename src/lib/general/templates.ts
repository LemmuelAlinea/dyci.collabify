import type { PresetPayload } from './presets'
import type { GeneralField, GeneralPosition, GeneralTask, GeneralTeam } from './types'

/**
 * A project's structure as a preset payload: what the next project should
 * start with. Live tasks only, in the order they happen (by start or due date,
 * then when they were made). Dates, people, values and files stay behind.
 */
export function templatePayload(input: {
  fields: GeneralField[]
  teams: GeneralTeam[]
  positions: GeneralPosition[]
  tasks: GeneralTask[]
}): PresetPayload {
  const teamName = new Map(input.teams.map((t) => [t.id, t.name]))
  const when = (t: GeneralTask) => t.starts_at ?? t.due_at ?? t.created_at
  return {
    fields: [...input.fields]
      .sort((a, b) => a.sort - b.sort)
      .map((f, i) => ({ name: f.name, type: f.type, options: f.options ?? [], sort: i })),
    teams: input.teams.map((t) => t.name),
    positions: [...input.positions]
      .sort((a, b) => a.sort - b.sort)
      .map((p) => ({ name: p.name, team: p.team_id ? (teamName.get(p.team_id) ?? null) : null })),
    tasks: input.tasks
      .filter((t) => !t.archived_at)
      .sort((a, b) => when(a).localeCompare(when(b)) || a.created_at.localeCompare(b.created_at))
      .slice(0, 300)
      .map((t) => ({
        title: t.title,
        description: t.description,
        team: t.team_id ? (teamName.get(t.team_id) ?? null) : null,
      })),
  }
}

/** "4 fields · 2 teams · 18 tasks", leaving out what is empty. */
export function payloadSummary(p: PresetPayload) {
  const parts: string[] = []
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`)
  add(p.fields.length, 'field', 'fields')
  add(p.teams.length, 'team', 'teams')
  add(p.positions.length, 'position', 'positions')
  add(p.tasks.length, 'task', 'tasks')
  return parts.join(' · ') || 'Empty'
}
