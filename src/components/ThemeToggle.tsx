import { useTheme } from '../context/ThemeContext'
import { Icon } from './ui/Icon'

export function ThemeToggle({ tone = 'auto' }: { tone?: 'auto' | 'onNavy' }) {
  const { resolved, setMode } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`grid h-10 w-10 place-items-center rounded-full transition-colors duration-200 ${
        tone === 'onNavy'
          ? 'text-white/75 hover:bg-white/10 hover:text-white'
          : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
      }`}
    >
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  )
}
