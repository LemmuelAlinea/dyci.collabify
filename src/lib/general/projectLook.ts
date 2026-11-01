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
 * word a color sets on a dark banner, `dot` the swatch in the picker.
 */
export const SWATCH_CLASS: Record<ProjectColor, { tile: string; accent: string; dot: string }> = {
  navy: { tile: 'bg-swatch-navy text-swatch-navy-ink', accent: 'text-swatch-navy-accent', dot: 'bg-swatch-navy' },
  amber: { tile: 'bg-swatch-amber text-swatch-amber-ink', accent: 'text-swatch-amber-accent', dot: 'bg-swatch-amber' },
  green: { tile: 'bg-swatch-green text-swatch-green-ink', accent: 'text-swatch-green-accent', dot: 'bg-swatch-green' },
  teal: { tile: 'bg-swatch-teal text-swatch-teal-ink', accent: 'text-swatch-teal-accent', dot: 'bg-swatch-teal' },
  violet: { tile: 'bg-swatch-violet text-swatch-violet-ink', accent: 'text-swatch-violet-accent', dot: 'bg-swatch-violet' },
  rose: { tile: 'bg-swatch-rose text-swatch-rose-ink', accent: 'text-swatch-rose-accent', dot: 'bg-swatch-rose' },
  orange: { tile: 'bg-swatch-orange text-swatch-orange-ink', accent: 'text-swatch-orange-accent', dot: 'bg-swatch-orange' },
  slate: { tile: 'bg-swatch-slate text-swatch-slate-ink', accent: 'text-swatch-slate-accent', dot: 'bg-swatch-slate' },
}

/** The word for a color or icon in a picker. */
export const projectLookLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
