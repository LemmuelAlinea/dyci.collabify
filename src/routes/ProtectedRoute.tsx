import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/workplace'
import type { Role } from '../lib/types'

function Booting() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5">
        <LogoMark size={44} />
        <Spinner size={18} className="text-muted" />
      </div>
    </div>
  )
}

/**
 * The one gate every signed-in page sits behind.
 *
 * `open` marks a page every signed-in account is owed regardless of role or
 * admission — Settings, the privacy request — so it renders as soon as there
 * is a session and a profile, before the pending check. Everything else needs
 * an admitted account: active, with a role. `allow` narrows further, to the
 * roles that page is actually for; anyone else is sent home rather than shown
 * a page that is not theirs.
 */
export function ProtectedRoute({ allow, open }: { allow?: Role[]; open?: boolean }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (open) return <Outlet />

  if (profile.status !== 'active' || !profile.role) return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />
  return <Outlet />
}
