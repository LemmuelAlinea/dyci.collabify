import { ROLE_BADGE } from '../../lib/general/permissions'
import type { ProjectRole } from '../../lib/general/permissions'

const BASE =
  'inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]'

const TONE: Record<ProjectRole, string> = {
  pm: 'bg-navy-600 text-white dark:bg-navy-200 dark:text-navy-900',
  coordinator: 'bg-navy-600/10 text-navy-700 dark:bg-navy-300/15 dark:text-navy-100',
  member: '',
  qa: 'surface-sunken text-muted',
  stakeholder: 'surface-sunken text-muted',
}

/**
 * The words a person's name wears: their role, if it has a badge, then Lead
 * when they lead a team. A plain Member who leads nobody wears nothing.
 */
export function badgesFor(role: ProjectRole, lead: boolean): string[] {
  const badge = ROLE_BADGE[role]
  return [...(badge ? [badge] : []), ...(lead ? ['Lead'] : [])]
}

export function RoleBadge({ role, lead = false }: { role: ProjectRole; lead?: boolean }) {
  const words = badgesFor(role, lead)
  if (words.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {words.map((word) => (
        <span
          key={word}
          className={`${BASE} ${word === 'Lead' ? 'bg-badge text-badge-ink' : TONE[role]}`}
        >
          {word}
        </span>
      ))}
    </span>
  )
}
