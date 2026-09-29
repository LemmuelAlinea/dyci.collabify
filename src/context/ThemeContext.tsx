import { createContext, useContext } from 'react'
import type { ThemeMode } from '../lib/types'
import type { PaletteColors } from '../lib/palette'

export type ThemeValue = {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  /** The person's own colours from Settings → Appearance; empty means the defaults. */
  colors: PaletteColors
  setColors: (colors: PaletteColors) => void
}

/** Filled by ThemeProvider (./ThemeProvider.tsx). */
export const ThemeContext = createContext<ThemeValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
