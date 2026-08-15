import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import type { ThemeMode } from '../lib/types'

/**
 * The single way to change appearance. Applies the theme locally and, when
 * signed in, saves it to the profile — otherwise ThemeSync would restore the
 * profile's older value on the next reload and undo the change.
 */
export function useThemePreference() {
  const { mode, resolved, setMode } = useTheme()
  const { profile, updateProfile } = useAuth()

  const choose = useCallback(
    async (next: ThemeMode) => {
      setMode(next)
      if (!profile || profile.theme === next) return
      try {
        await updateProfile({ theme: next })
      } catch {
        // The local preference is already applied; the row sync is best-effort.
      }
    },
    [profile, setMode, updateProfile],
  )

  return { mode, resolved, choose }
}
