import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LogoMark } from '../components/brand/Logo'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { gate } from './gate'
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
  const result = gate(Boolean(session), profile, { open, allow })
  if (result === 'ok') return <Outlet />
  if (result === '/login') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Navigate to={result} replace />
}

/**
 * The same admission rules as `ProtectedRoute`, without the shell and without
 * re-checking the session and profile presence the parent `<ProtectedRoute
 * open />` already did. Used to guard a group of pages sitting inside the one
 * shell so crossing between them never remounts it.
 */
export function RequireAdmitted({ allow }: { allow?: Role[] }) {
  const { profile } = useAuth()
  const result = gate(true, profile, { allow })
  if (result === 'ok') return <Outlet />
  return <Navigate to={result === '/login' ? '/login' : result} replace />
}
