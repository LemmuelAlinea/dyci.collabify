import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { syncStatusBar } from '../lib/systemBars'

/**
 * Keeps the phone's status bar the colour of the top of the page (lib/systemBars.ts).
 * Read again when the theme, the person's colours or the page change; a page that
 * loads its code late is read again once it has had time to draw.
 */
export function StatusBarSync() {
  const { resolved, colors } = useTheme()
  const { pathname } = useLocation()

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(syncStatusBar)
    })
    const later = [300, 1200].map((ms) => window.setTimeout(syncStatusBar, ms))
    return () => {
      cancelAnimationFrame(frame)
      later.forEach((id) => window.clearTimeout(id))
    }
  }, [resolved, colors, pathname])

  return null
}
