import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * An old teaching page. Members land on the page that replaced it, query kept;
 * the admin still reads the page as it was.
 */
export function TeachingRedirect({ to, page }: { to: string; page: ReactElement }) {
  const { profile } = useAuth()
  const { search } = useLocation()
  if (profile?.role === 'admin') return page
  // A target that names its own query keeps it, and the old query joins it.
  const join = to.includes('?') ? '&' : '?'
  return <Navigate to={search ? `${to}${join}${search.slice(1)}` : to} replace />
}
