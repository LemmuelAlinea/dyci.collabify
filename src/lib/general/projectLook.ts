// src/lib/general/projectLook.ts
/** The fixed sets a project's color, icon and default tab are picked from (supabase/project-settings-general.sql). */
import type { ProjectColor, ProjectIcon, ProjectView } from './types'

export const PROJECT_COLORS: readonly ProjectColor[] = [
  'navy', 'amber', 'green', 'teal', 'violet', 'rose', 'orange', 'slate',
]

/** Every name is an IconName, which the type of ProjectIcon enforces. */
export const PROJECT_ICONS: readonly ProjectIcon[] = [
  'monitor', 'board', 'kanban', 'folder', 'book', 'calendar', 'clock', 'chart', 'shield', 'palette',
  'spark', 'target', 'file', 'message', 'users', 'video', 'bell', 'mail', 'pin', 'crown',
]

export const PROJECT_VIEWS: readonly { value: ProjectView; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'plan', label: 'Plan' },
  { value: 'tasks', label: 'Tasks' },
]

/**
 * The classes for each color. Written out in full, not built from the name, so
 * Tailwind finds every one. `tile` is the ground with its glyph, `accent` the
 * word a color sets on a dark banner.
 */
export const SWATCH_CLASS: Record<ProjectColor, { tile: string; accent: string }> = {
  navy: { tile: 'bg-swatch-navy text-swatch-navy-ink', accent: 'text-swatch-navy-accent' },
  amber: { tile: 'bg-swatch-amber text-swatch-amber-ink', accent: 'text-swatch-amber-accent' },
  green: { tile: 'bg-swatch-green text-swatch-green-ink', accent: 'text-swatch-green-accent' },
  teal: { tile: 'bg-swatch-teal text-swatch-teal-ink', accent: 'text-swatch-teal-accent' },
  violet: { tile: 'bg-swatch-violet text-swatch-violet-ink', accent: 'text-swatch-violet-accent' },
  rose: { tile: 'bg-swatch-rose text-swatch-rose-ink', accent: 'text-swatch-rose-accent' },
  orange: { tile: 'bg-swatch-orange text-swatch-orange-ink', accent: 'text-swatch-orange-accent' },
  slate: { tile: 'bg-swatch-slate text-swatch-slate-ink', accent: 'text-swatch-slate-accent' },
}

/** The word for a color or icon in a picker. */
export const projectLookLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
