import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, Spinner } from '../ui/Icon'
import { useAuth } from '../../context/AuthContext'
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from '../../lib/api/notifications'
import type { AppNotification, Role } from '../../lib/types'

const ROLE_BASE: Record<Role, string> = {
  student: '/student',
  professor: '/professor',
  admin: '/admin',
}

function ago(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function NotificationBell() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(async () => {
    if (!profile) return
    try {
      setUnread(await unreadCount(profile.id))
    } catch {
      // A failing badge must never take the topbar down with it.
    }
  }, [profile])

  useEffect(() => {
    void refreshCount()
    const id = setInterval(refreshCount, 60_000)
    return () => clearInterval(id)
  }, [refreshCount])

  useEffect(() => {
    if (!open || !profile) return
    setItems(null)
    void listNotifications(profile.id)
      .then(setItems)
      .catch(() => setItems([]))
  }, [open, profile])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!profile) return null

  async function openNotification(n: AppNotification) {
    setOpen(false)
    if (!n.read_at) {
      await markRead([n.id])
      void refreshCount()
    }
    if (!profile) return
    const base = ROLE_BASE[profile.role]
    if (n.project_id && profile.role !== 'admin') {
      navigate(`${base}/projects/${n.project_id}`)
    } else if (n.class_id) {
      navigate(profile.role === 'admin' ? base : `${base}/classes/${n.class_id}`)
    } else if (n.type === 'weekly_digest' && profile.role === 'student') {
      // The digest is about everything at once, so it has no one project to
      // open. My tasks is the page it is a summary of. Only students have it.
      navigate('/student/tasks')
    } else {
      navigate(base)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
      >
        <Icon name="bell" size={19} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 font-mono text-[9.5px] font-bold text-navy-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        // The bell is not the rightmost control in the topbar, so anchoring the
        // panel to it pushed the panel's left edge off a phone screen. Below sm
        // it spans the viewport instead; from sm up it hangs off the button.
        <div
          data-state="open"
          className="motion-overlay surface fixed inset-x-3 top-[78px] z-50 origin-top overflow-hidden rounded-2xl border border-line shadow-lift sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px] sm:origin-top-right"
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (!profile) return
                  await markAllRead(profile.id)
                  setItems((list) =>
                    (list ?? []).map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
                  )
                  void refreshCount()
                }}
                className="text-[12.5px] font-medium text-navy-600 hover:underline dark:text-navy-200"
              >
                Mark all read
              </button>
            )}
          </header>

          <div className="max-h-[380px] overflow-y-auto">
            {items === null ? (
              <div className="flex items-center gap-2.5 px-4 py-8 text-[13.5px] text-muted">
                <Spinner size={15} />
                Loading…
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13.5px] text-muted">
                Nothing yet. Announcements and new projects land here.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(n)}
                      className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          n.read_at ? 'bg-transparent' : 'bg-amber-400'
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">
                          {n.title}
                        </span>
                        {n.preview && (
                          <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-muted">
                            {n.preview}
                          </span>
                        )}
                        <span className="mt-1 block text-[11.5px] text-faint">
                          {ago(n.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
