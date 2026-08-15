export type Role = 'student' | 'professor' | 'superadmin'
export type AccountStatus = 'active' | 'pending' | 'rejected'
export type ThemeMode = 'light' | 'dark' | 'system'

export type Profile = {
  id: string
  email: string
  first_name: string
  middle_name: string | null
  last_name: string
  role: Role
  status: AccountStatus
  avatar_url: string | null
  theme: ThemeMode
  created_at: string
  updated_at: string
}

export type NotificationPrefs = {
  user_id: string
  project_invites: boolean
  task_assignments: boolean
  deadline_reminders: boolean
  comments_mentions: boolean
  progress_digest: boolean
  announcements: boolean
}

export type NotificationKey = Exclude<keyof NotificationPrefs, 'user_id'>

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student',
  professor: 'Professor',
  superadmin: 'Superadmin',
}

export function fullName(p: Pick<Profile, 'first_name' | 'middle_name' | 'last_name'>) {
  return [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ').trim()
}

export function initials(p: Pick<Profile, 'first_name' | 'last_name'>) {
  return `${p.first_name?.[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase() || '?'
}
