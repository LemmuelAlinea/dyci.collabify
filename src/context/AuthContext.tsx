import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { NotificationPrefs, Profile, Role } from '../lib/types'

type SignUpInput = {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  password: string
  role: Exclude<Role, 'superadmin'>
}

type AuthValue = {
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
    role: Exclude<Role, 'superadmin'>
  }) => Promise<void>
  loadNotificationPrefs: () => Promise<NotificationPrefs | null>
  updateNotificationPrefs: (patch: Partial<NotificationPrefs>) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const redirectTo = (path: string) => `${window.location.origin}${path}`

function requireConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not connected yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.',
    )
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const userId = session?.user.id ?? null
  const fetchedFor = useRef<string | null>(null)

  const fetchProfile = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[collabify] profile load failed', error.message)
      return null
    }
    return (data as Profile | null) ?? null
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let alive = true

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (!data.session) setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        fetchedFor.current = null
        setProfile(null)
        setReady(true)
      }
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    if (fetchedFor.current === userId) return
    fetchedFor.current = userId
    let alive = true
    fetchProfile(userId).then((p) => {
      if (!alive) return
      setProfile(p)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [userId, fetchProfile])

  const refreshProfile = useCallback(async () => {
    if (!userId) return
    setProfile(await fetchProfile(userId))
  }, [userId, fetchProfile])

  const signUpWithEmail = useCallback(async (input: SignUpInput) => {
    requireConfigured()
    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        emailRedirectTo: redirectTo('/auth/callback'),
        data: {
          first_name: input.firstName.trim(),
          middle_name: input.middleName?.trim() || null,
          last_name: input.lastName.trim(),
          role: input.role,
        },
      },
    })
    if (error) throw error
    // Supabase returns a user with no session when confirmation is required.
    return { needsConfirmation: !data.session }
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    requireConfigured()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async () => {
    requireConfigured()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo('/auth/callback'),
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    fetchedFor.current = null
    setProfile(null)
    setSession(null)
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    requireConfigured()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectTo('/reset-password'),
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }, [])

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!userId) throw new Error('Not signed in.')
      const { data, error } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', userId)
        .select('*')
        .single()
      if (error) throw error
      setProfile(data as Profile)
    },
    [userId],
  )

  const completeOnboarding = useCallback<AuthValue['completeOnboarding']>(
    async (input) => {
      if (!session?.user) throw new Error('Not signed in.')
      const row = {
        id: session.user.id,
        email: session.user.email ?? '',
        first_name: input.firstName.trim(),
        middle_name: input.middleName?.trim() || null,
        last_name: input.lastName.trim(),
        role: input.role,
        status: input.role === 'professor' ? 'pending' : 'active',
        avatar_url:
          (session.user.user_metadata?.avatar_url as string | undefined) ?? null,
      }
      const { data, error } = await supabase
        .from('profiles')
        .upsert(row, { onConflict: 'id' })
        .select('*')
        .single()
      if (error) throw error
      await supabase
        .from('notification_prefs')
        .upsert({ user_id: session.user.id }, { onConflict: 'user_id' })
      setProfile(data as Profile)
    },
    [session],
  )

  const loadNotificationPrefs = useCallback(async () => {
    if (!userId) return null
    const { data, error } = await supabase
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[collabify] notification prefs load failed', error.message)
      return null
    }
    return (data as NotificationPrefs | null) ?? null
  }, [userId])

  const updateNotificationPrefs = useCallback(
    async (patch: Partial<NotificationPrefs>) => {
      if (!userId) throw new Error('Not signed in.')
      const { error } = await supabase
        .from('notification_prefs')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      if (error) throw error
    },
    [userId],
  )

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      session,
      user: session?.user ?? null,
      profile,
      configured: isSupabaseConfigured,
      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      completeOnboarding,
      loadNotificationPrefs,
      updateNotificationPrefs,
      refreshProfile,
    }),
    [
      ready,
      session,
      profile,
      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      sendPasswordReset,
      updatePassword,
      updateProfile,
      completeOnboarding,
      loadNotificationPrefs,
      updateNotificationPrefs,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
