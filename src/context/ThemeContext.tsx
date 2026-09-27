import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemeMode } from '../lib/types'
import { applyPalette, readCachedPicks } from '../lib/palette'
import type { PaletteColors } from '../lib/palette'

const STORAGE_KEY = 'collabify.theme'

type ThemeValue = {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  /** The person's own colours from Settings → Appearance; empty means the defaults. */
  colors: PaletteColors
  setColors: (colors: PaletteColors) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStored)
  const [colors, setColors] = useState<PaletteColors>(readCachedPicks)
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? false : systemPrefersDark(),
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#080b21' : '#26327A')
  }, [resolved])

  // Each mode has its own colours, so a swap between light and dark re-applies.
  useEffect(() => {
    applyPalette(colors, resolved)
  }, [colors, resolved])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const value = useMemo(
    () => ({ mode, resolved, setMode, colors, setColors }),
    [mode, resolved, setMode, colors],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
