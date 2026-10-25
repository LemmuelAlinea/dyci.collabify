// src/lib/general/skills.ts
/**
 * Skill tags a work project member lists for themselves, which Assign by
 * position reads beside positions. The database enforces every rule here
 * (supabase/member-skills.sql); these mirror it so the app hides what it
 * would refuse and says why before it asks.
 */
import type { GeneralPermission, ProjectRole } from './permissions'

export const SKILL_LIMIT = 12
const MAX_LENGTH = 40

/** Trimmed, inner spaces collapsed; null when empty or over 40 characters. */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/\s+/g, ' ')
  return tag.length === 0 || tag.length > MAX_LENGTH ? null : tag
}

/** Why `tag` can't join `existing`, or null when it can (or there is nothing to add). */
export function skillProblem(existing: string[], tag: string): string | null {
  if (tag.trim() === '') return null
  const clean = normalizeTag(tag)
  if (!clean) return 'Keep a skill to 40 characters or fewer.'
  const lower = clean.toLowerCase()
  if (existing.some((t) => t.toLowerCase() === lower)) return 'That skill is already there.'
  if (existing.length >= SKILL_LIMIT) return 'Up to 12 skills each.'
  return null
}

const TAKES_TASKS: ProjectRole[] = ['pm', 'coordinator', 'member']

/**
 * Whether the viewer may add or remove the target's skills: the RLS on
 * general_member_skills (general_can_write, then self or manage_tasks or
 * manage_structure) plus the trigger that refuses QA and stakeholder targets.
 */
export function mayEditSkills(
  viewer: {
    id: string | undefined
    role: ProjectRole | null
    readOnly: boolean
    can: (p: GeneralPermission) => boolean
  },
  target: { userId: string; role: ProjectRole },
): boolean {
  if (viewer.readOnly || !viewer.id) return false
  if (!TAKES_TASKS.includes(target.role)) return false
  const self =
    viewer.id === target.userId && viewer.role !== 'qa' && viewer.role !== 'stakeholder'
  return self || viewer.can('manage_tasks') || viewer.can('manage_structure')
}
