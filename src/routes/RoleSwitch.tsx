import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { paths } from '../lib/paths'

/**
 * One URL, read differently by role.
 *
 * `/classes` used to be `/student/classes` or `/professor/classes` — two
 * routes, two links, one page. Now there is one route, and this decides which
 * element it renders from the signed-in profile's role rather than from the
 * path. Admin has no page of its own here more often than not, so it falls
 * back to Home instead of forcing every call site to supply one.
 */
export function RoleSwitch({
  student,
  professor,
  admin,
}: {
  student: ReactNode
  professor: ReactNode
  admin?: ReactNode
}) {
  const { profile } = useAuth()

  if (profile?.role === 'student') return <>{student}</>
  if (profile?.role === 'professor') return <>{professor}</>
  if (profile?.role === 'admin') return admin !== undefined ? <>{admin}</> : <Navigate to={paths.home} replace />
  return <Navigate to={paths.home} replace />
}
