import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { legacyPath } from '../lib/paths'
import NotFound from '../pages/NotFound'

/**
 * Where an old `/student`, `/professor`, `/general`, `/admin` or `/education`
 * URL is now.
 *
 * Bookmarks, emails and links already out in the wild point at the sections
 * that used to exist. Rather than 404 whoever follows one, this maps the old
 * pathname onto its replacement — keeping the query string and hash, since
 * those can carry state of their own — and lets that route's own guard decide
 * whether the visitor may see it. `legacyPath` only recognises old URLs; on
 * anything else it returns null and this renders the ordinary 404.
 */
export function LegacyRedirect() {
  const location = useLocation()
  const { profile } = useAuth()
  const to = legacyPath(location.pathname, profile?.role ?? null)
  if (!to) return <NotFound />
  return <Navigate to={`${to}${location.search}${location.hash}`} replace />
}
