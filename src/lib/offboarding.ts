/** One thing an offboarded member runs, as the admin's preview lists it. */
export type OffboardLine = {
  kind: 'space_pm' | 'project_pm' | 'team_lead' | 'reviewer' | 'open_tasks'
  item_id: string | null
  item_name: string
  project_name: string
  space_name: string
  office_name: string
  archived: boolean
  task_count: number
}

/** The lines that need a new project manager: spaces and projects. */
export function handoverLines(lines: OffboardLine[]) {
  return lines.filter((l) => l.kind === 'space_pm' || l.kind === 'project_pm')
}

/** Only the lines whose pick differs from the default successor. */
export function buildOverrides(lines: OffboardLine[], successor: string, picks: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const l of handoverLines(lines)) {
    const pick = l.item_id ? picks[l.item_id] : undefined
    if (l.item_id && pick && pick !== successor) out[l.item_id] = pick
  }
  return out
}

/** A successor is needed only when a space or project must be handed over. */
export function readyToOffboard(lines: OffboardLine[], successor: string | null) {
  return !!successor || handoverLines(lines).length === 0
}

/** An active member with Project manager on, other than the person leaving. */
export function isEligibleSuccessor(
  a: { id: string; role: string | null; status: string; can_manage_projects: boolean },
  targetId: string,
) {
  return a.role === 'member' && a.status === 'active' && a.can_manage_projects && a.id !== targetId
}
