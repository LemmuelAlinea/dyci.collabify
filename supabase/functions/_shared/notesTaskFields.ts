export type NotePriority = 'low' | 'normal' | 'high' | 'urgent'
export type NoteTypeChoice = { value: string; label: string }

export function noteTypeChoices(raw: unknown): NoteTypeChoice[] {
  const choices: NoteTypeChoice[] = [{ value: 'task', label: 'Task' }, { value: 'bug', label: 'Bug' }]
  if (!Array.isArray(raw)) return choices
  for (const entry of raw) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) continue
    const value = entry.slot === 'default' ? 'task' : entry.slot === 'bug' ? 'bug' : entry.name
    const index = choices.findIndex((choice) => choice.value === value)
    if (index >= 0) choices[index] = { value, label: entry.name }
    else choices.push({ value, label: entry.name })
  }
  return choices
}

export function normalizeNoteTaskFields(
  raw: { priority?: unknown; task_type?: unknown; estimated_hours?: unknown },
  types: readonly NoteTypeChoice[],
  defaultPriority: NotePriority,
) {
  const priority = String(raw.priority ?? '').trim().toLowerCase()
  const type = String(raw.task_type ?? '').trim().toLowerCase()
  const hours = String(raw.estimated_hours ?? '').trim()
  const minutes = /^\d+(\.\d+)?$/.test(hours) ? Math.round(Number(hours) * 60) : 0
  return {
    priority: (['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : defaultPriority) as NotePriority,
    task_type: types.find((choice) => choice.value.toLowerCase() === type || choice.label.toLowerCase() === type)?.value ?? 'task',
    estimated_hours: minutes >= 1 && minutes <= 60000 ? hours : '',
  }
}
