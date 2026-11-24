import { useContext } from 'react'
import { ThemeContext } from '../../context/ThemeContext'

/** Light or dark, as the page is drawn; light outside a ThemeProvider. */
export function useTypeMode(): 'light' | 'dark' {
  return useContext(ThemeContext)?.resolved ?? 'light'
}
