// src/lib/classLook.ts
/** The icons a class's tile is picked from (supabase/class-look.sql), and what each one names. */
import type { IconName } from '../components/ui/Icon'
import type { ProjectColor } from './general/types'

/** Every name is an IconName, and supabase/class-look.sql's check lists the same set. */
export const CLASS_ICONS = [
  'school', 'code', 'database', 'network', 'server', 'cpu', 'terminal', 'globe', 'mobile', 'cloud',
  'shield', 'brain', 'chart', 'math', 'flask', 'book', 'pen', 'language', 'palette', 'briefcase',
  'presentation', 'users', 'certificate',
] as const satisfies readonly IconName[]

export type ClassIcon = (typeof CLASS_ICONS)[number]

/** A class's look: a color (a project swatch or #rrggbb) and an icon; null keeps the plain tile and initials. */
export type ClassLook = { color: ProjectColor | null; icon: ClassIcon | null }

const LABEL: Record<ClassIcon, string> = {
  school: 'Class',
  code: 'Programming',
  database: 'Databases',
  network: 'Networks',
  server: 'Systems',
  cpu: 'Hardware',
  terminal: 'Command line',
  globe: 'Web',
  mobile: 'Mobile',
  cloud: 'Cloud',
  shield: 'Security',
  brain: 'AI',
  chart: 'Data',
  math: 'Math',
  flask: 'Science',
  book: 'Reading',
  pen: 'Writing',
  language: 'Language',
  palette: 'Design',
  briefcase: 'Business',
  presentation: 'Capstone',
  users: 'Teamwork',
  certificate: 'Seminar',
}

export function classIconLabel(icon: ClassIcon): string {
  return LABEL[icon]
}

export function isClassIcon(value: unknown): value is ClassIcon {
  return typeof value === 'string' && (CLASS_ICONS as readonly string[]).includes(value)
}
