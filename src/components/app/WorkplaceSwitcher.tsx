import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { educationHome, workplaceOf } from '../../lib/workplace'
import type { Workplace } from '../../lib/workplace'

/**
 * Education or General, always one press apart.
 *
 * Links rather than a toggle: each workplace has a real address, so the
 * browser's back button and a copied link both behave. Education goes wherever
 * the account belongs there — its dashboard, the pending page, or the one-time
 * role choice.
 */
export function WorkplaceSwitcher({
  tone = 'onNavy',
  className = '',
}: {
  tone?: 'onNavy' | 'surface'
  className?: string
}) {
  const { profile } = useAuth()
  const location = useLocation()
  if (!profile) return null

  const current = workplaceOf(location.pathname, profile.home_workplace)
  const options: { value: Workplace; label: string; to: string }[] = [
    { value: 'education', label: 'Education', to: educationHome(profile) },
    { value: 'general', label: 'General', to: '/general' },
  ]
  const onNavy = tone === 'onNavy'

  return (
    <nav
      aria-label="Workplace"
      className={`items-center gap-0.5 rounded-lg p-0.5 ${
        onNavy ? 'bg-white/8' : 'surface-sunken'
      } ${className || 'flex'}`}
    >
      {options.map((o) => {
        const on = o.value === current
        return (
          <Link
            key={o.value}
            to={o.to}
            aria-current={on ? 'page' : undefined}
            className={`flex-1 rounded-md px-2.5 py-1 text-center text-[12px] font-medium transition-colors ${
              on
                ? onNavy
                  ? 'bg-amber-400 text-navy-900'
                  : 'surface text-ink ring-1 ring-[var(--line-strong)]'
                : onNavy
                  ? 'text-amber-50/65 hover:text-amber-50'
                  : 'text-muted hover:text-ink'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </nav>
  )
}
