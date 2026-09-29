import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { NotificationPrefs, Profile, Role } from '../lib/types'

export type SignUpInput = {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  password: string
  role: Exclude<Role, 'admin'>
}

export type AuthValue = {
  ready: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  configured: boolean
  signUpWithEmail: (input: SignUpInput) => Promise<{ needsConfirmation: boolean }>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateProfile: (patch: Partial<Profile>) => Promise<void>
  completeOnboarding: (input: {
    firstName: string
    middleName?: string
    lastName: string
    role: Exclude<Role, 'admin'>
  }) => Promise<void>
  loadNotificationPrefs: () => Promise<NotificationPrefs | null>
  updateNotificationPrefs: (patch: Partial<NotificationPrefs>) => Promise<void>
  refreshProfile: () => Promise<void>
}

/** Filled by AuthProvider (./AuthProvider.tsx). */
export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
