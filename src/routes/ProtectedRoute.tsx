import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/workplace'
import type { Workplace } from '../lib/workplace'
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
 * `workplace` says which door this is.
 *
 * - Education needs a role and an active account, as every page did before.
 * - General needs only an account that is not deactivated, so a professor
 *   waiting on approval can still work there.
 * - No workplace (Settings, Your data) is the same as General: every account
 *   is owed its own settings and its own data.
 */
export function ProtectedRoute({ allow, workplace }: { allow?: Role[]; workplace?: Workplace }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (workplace !== 'education') return <Outlet />

  if (!profile.role) return <Navigate to="/education/enter" replace />
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />

  return <Outlet />
}
