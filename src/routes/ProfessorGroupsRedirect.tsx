import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageLoading } from '../components/ui/PageLoading'
import { useAuth } from '../context/AuthContext'
import { listProfessorClasses } from '../lib/api/classes'
import { groupsHomeFor } from '../lib/classSpace'
import { paths } from '../lib/paths'

/**
 * `/groups` for a member. Groups live in each class now: one live taught class
 * opens on its Groups tab, anything else on the Classes page to pick one.
 */
export function ProfessorGroupsRedirect() {
  const { profile } = useAuth()
  const [to, setTo] = useState<string | null>(null)
  const userId = profile?.id

  useEffect(() => {
    if (!userId) return
    let live = true
    listProfessorClasses(userId)
      .then((classes) => {
        if (live) setTo(groupsHomeFor(classes.map((c) => c.id)))
      })
      .catch(() => {
        if (live) setTo(paths.classes)
      })
    return () => {
      live = false
    }
  }, [userId])

  if (!to) return <PageLoading />
  return <Navigate to={to} replace />
}
