import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { PageLoading } from '../../components/ui/PageLoading'
import { destination } from '../../components/app/notificationDestination'
import { useAuth } from '../../context/AuthContext'
import { canTeach } from '../../lib/access'
import { getNotification, markRead } from '../../lib/api/notifications'
import { paths } from '../../lib/paths'

/**
 * Where a device push lands (/n/<notification id>): marks it read and opens the page the bell would.
 * A notification that is gone, or not this reader's, opens Home.
 */
export default function OpenNotification() {
  const { id = '' } = useParams()
  const { profile } = useAuth()
  const [to, setTo] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    let live = true
    getNotification(id)
      .then(async (n) => {
        if (!n) return paths.home
        if (!n.read_at) await markRead([n.id]).catch(() => undefined)
        return destination(n, profile.role, canTeach(profile))
      })
      .catch(() => paths.home)
      .then((next) => live && setTo(next))
    return () => {
      live = false
    }
  }, [id, profile])

  return to ? <Navigate to={to} replace /> : <PageLoading />
}
