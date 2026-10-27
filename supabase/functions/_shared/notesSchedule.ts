type TaskDate = { start: string; due: string; sprint: string; milestone?: string }
type SprintDate = { name: string; starts_on: string; ends_on: string }
type MilestoneDate = { name: string; due: string; sprints: string[] }

export function validDay(value: unknown): string {
  const day = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''
  const parsed = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : ''
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

function workdays(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from, n = 0; day <= to && n < 730; day = addDays(day, 1), n++) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(day)
  }
  return days.length ? days : [from]
}

function moveWorkdays(day: string, count: number): string {
  let result = day
  let left = Math.abs(count)
  while (left > 0) {
    result = addDays(result, Math.sign(count))
    const weekday = new Date(`${result}T00:00:00Z`).getUTCDay()
    if (weekday !== 0 && weekday !== 6) left--
  }
  return result
}

export function completeNotesDates<T extends TaskDate, S extends SprintDate, M extends MilestoneDate>(
  tasks: T[],
  sprints: S[],
  milestones: M[],
  context: { today: string; projectStart?: string | null; projectEnd?: string | null },
): { tasks: T[]; sprints: S[]; milestones: M[] } {
  const today = validDay(context.today)
  const projectStart = validDay(context.projectStart)
  const anchor = projectStart && projectStart > today ? projectStart : today
  const projectEnd = validDay(context.projectEnd)
  let cursor = anchor
  const datedSprints = sprints.map((s) => {
    const related = tasks.filter((t) => t.sprint.toLowerCase() === s.name.toLowerCase())
    const known = related.flatMap((t) => [validDay(t.start), validDay(t.due)]).filter(Boolean).sort()
    let start = validDay(s.starts_on) || known[0] || cursor
    let end = validDay(s.ends_on) || known[known.length - 1] || addDays(start, 13)
    if (end < start) {
      if (!validDay(s.starts_on)) start = end
      else end = start
    }
    cursor = addDays(end, 1)
    return { ...s, starts_on: start, ends_on: end }
  })

  const groups = new Map<string, number[]>()
  tasks.forEach((t, i) => {
    const key = datedSprints.find((s) => s.name.toLowerCase() === t.sprint.toLowerCase())?.name ?? ''
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  const datedTasks = [...tasks]
  for (const [name, indexes] of groups) {
    const sprint = datedSprints.find((s) => s.name === name)
    const from = sprint?.starts_on ?? anchor
    const naturalEnd = addDays(from, indexes.length * 3 - 1)
    const to = sprint?.ends_on ?? (projectEnd && projectEnd >= from && projectEnd < naturalEnd ? projectEnd : naturalEnd)
    const slots = workdays(from, to)
    indexes.forEach((index, position) => {
      const t = tasks[index]
      let start = validDay(t.start)
      let due = validDay(t.due)
      if (start && due && due < start) start = ''
      if (due && !start) {
        const estimate = moveWorkdays(due, -1)
        start = due >= from && estimate < from ? workdays(from, due)[0] : estimate
      }
      if (start && !due) {
        due = moveWorkdays(start, 1)
        if (sprint && due > sprint.ends_on && sprint.ends_on >= start) due = sprint.ends_on
      }
      if (!start && !due) {
        const first = Math.floor(position * slots.length / indexes.length)
        const last = Math.max(first, Math.floor((position + 1) * slots.length / indexes.length) - 1)
        start = slots[first]
        due = slots[last]
      }
      datedTasks[index] = { ...t, start, due }
    })
  }

  const datedMilestones = milestones.map((m) => {
    if (validDay(m.due)) return m
    const linkedSprints = datedSprints.filter((s) => m.sprints.some((name) => name.toLowerCase() === s.name.toLowerCase()))
    const linkedTasks = datedTasks.filter((t) =>
      t.milestone?.toLowerCase() === m.name.toLowerCase()
      || (t.sprint && linkedSprints.some((s) => s.name.toLowerCase() === t.sprint.toLowerCase())),
    )
    const due = linkedSprints.map((s) => s.ends_on).concat(linkedTasks.map((t) => t.due)).sort().at(-1)
      ?? (projectEnd && projectEnd >= anchor ? projectEnd : datedTasks.map((t) => t.due).sort().at(-1) ?? anchor)
    return { ...m, due }
  })
  return { tasks: datedTasks, sprints: datedSprints, milestones: datedMilestones }
}
