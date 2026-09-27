import { useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { getMyAppearance } from '../lib/api/appearance'

/**
 * The account's saved appearance wins once per sign-in, so a user who picked dark
 * on their laptop gets dark on the lab machine too. Local changes after that stick.
 *
 * Their own colours come along the same way. Signing out puts the defaults back,
 * so the next person at a shared machine does not start in someone else's colours.
 */
export function ThemeSync() {
  const { profile } = useAuth()
  const { setMode, setColors } = useTheme()
  const applied = useRef<string | null>(null)

  useEffect(() => {
    if (!profile) {
      if (applied.current !== null) setColors({})
      applied.current = null
      return
    }
    if (applied.current === profile.id) return
    applied.current = profile.id
    if (profile.theme) setMode(profile.theme)
    const id = profile.id
    getMyAppearance()
      .then((colors) => {
        if (applied.current === id) setColors(colors)
      })
      .catch(() => {
        // Keep whatever this device had; the defaults are never wrong, only plain.
      })
  }, [profile, setMode, setColors])

  return null
}
