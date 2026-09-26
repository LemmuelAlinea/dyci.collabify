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
 * - Both workplaces need an admitted account: active, with a role. Faculty
 *   waiting on the admin used to be let into General; nothing opens before
 *   approval now.
 * - No workplace (Settings, Your data) stays open to every signed-in account
 *   that is not deactivated: those are owed to everybody, admitted or not.
 */
export function ProtectedRoute({ allow, workplace }: { allow?: Role[]; workplace?: Workplace }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status === 'rejected') return <Navigate to="/pending" replace />
  if (!workplace) return <Outlet />

  if (profile.status !== 'active' || !profile.role) return <Navigate to="/pending" replace />
  if (workplace === 'general') return <Outlet />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile)} replace />

  return <Outlet />
}
