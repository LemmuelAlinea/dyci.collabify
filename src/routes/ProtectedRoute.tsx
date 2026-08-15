import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
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

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { ready, session, profile } = useAuth()
  const location = useLocation()

  if (!ready) return <Booting />
  if (!session)
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!profile) return <Navigate to="/onboarding" replace />
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role))
    return <Navigate to={roleHome(profile.role, profile.status)} replace />

  return <Outlet />
}
