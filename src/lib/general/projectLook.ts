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
