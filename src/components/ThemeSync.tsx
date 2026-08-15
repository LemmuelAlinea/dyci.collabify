import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

/**
 * The account's saved appearance wins once per sign-in, so a user who picked dark
 * on their laptop gets dark on the lab machine too. Local changes after that stick.
 */
export function ThemeSync() {
  const { profile } = useAuth()
  const { setMode } = useTheme()
  const applied = useRef<string | null>(null)

  useEffect(() => {
    if (!profile) {
      applied.current = null
      return
    }
    if (applied.current === profile.id) return
    applied.current = profile.id
    if (profile.theme) setMode(profile.theme)
  }, [profile, setMode])

  return null
}
