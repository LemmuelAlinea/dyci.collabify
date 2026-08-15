import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../components/app/Avatar'
import { Button } from '../components/ui/Button'
import { Alert, Field, Input, Toggle } from '../components/ui/Field'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { authErrorMessage } from '../lib/authError'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'
import type { NotificationKey, NotificationPrefs, ThemeMode } from '../lib/types'

const NOTIFICATIONS: { key: NotificationKey; label: string; body: string }[] = [
  {
    key: 'task_assignments',
    label: 'Task assignments',
    body: 'When a task is assigned to you, or handed to someone else.',
  },
  {
    key: 'deadline_reminders',
    label: 'Deadline reminders',
    body: 'A nudge before a task or milestone is due, not after it slipped.',
  },
  {
    key: 'comments_mentions',
    label: 'Comments and mentions',
    body: 'When someone replies to your thread or tags you by name.',
  },
  {
    key: 'project_invites',
    label: 'Project invites',
    body: 'When you are added to a group or assigned as its adviser.',
  },
  {
    key: 'progress_digest',
    label: 'Weekly progress digest',
    body: 'A Monday summary of what moved last week and what is due next.',
  },
  {
    key: 'announcements',
    label: 'Program announcements',
    body: 'Notices sent by your program admin to the whole cohort.',
  },
]

const APPEARANCE: { mode: ThemeMode; label: string; icon: IconName; note: string }[] = [
  { mode: 'light', label: 'Light', icon: 'sun', note: 'Always bright' },
  { mode: 'dark', label: 'Dark', icon: 'moon', note: 'Always dim' },
  { mode: 'system', label: 'System', icon: 'monitor', note: 'Follow device' },
]

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="surface rounded-panel border border-line shadow-card">
      <header className="flex items-start gap-3.5 border-b border-line px-6 py-5 md:px-8">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-400 dark:bg-navy-500">
          <Icon name={icon} size={19} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[19px]">{title}</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">{description}</p>
        </div>
      </header>
      <div className="px-6 py-6 md:px-8">{children}</div>
    </section>
  )
}

function Saved({ show, text = 'Saved' }: { show: boolean; text?: string }) {
  if (!show) return null
  return (
    <span className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
      <Icon name="check" size={15} strokeWidth={2.6} />
      {text}
    </span>
  )
}

export default function Settings() {
  const { profile, updateProfile, loadNotificationPrefs, updateNotificationPrefs, sendPasswordReset, signOut } =
    useAuth()
  const { mode, setMode } = useTheme()

  useEffect(() => {
    document.title = 'Settings · Collabify'
  }, [])

  /* ---------- profile ---------- */
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setFirstName(profile.first_name)
    setMiddleName(profile.middle_name ?? '')
    setLastName(profile.last_name)
  }, [profile])

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    setProfileError(null)
    setProfileBusy(true)
    try {
      await updateProfile({
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim(),
      })
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2600)
    } catch (err) {
      setProfileError(authErrorMessage(err, 'Could not save your name.'))
    } finally {
      setProfileBusy(false)
    }
  }

  /* ---------- avatar ---------- */
  const fileRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)

  async function onAvatarPicked(file: File | undefined) {
    if (!file || !profile) return
    setAvatarError(null)
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('Pick an image under 2 MB.')
      return
    }
    setAvatarBusy(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${profile.id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await updateProfile({ avatar_url: data.publicUrl })
    } catch (err) {
      setAvatarError(authErrorMessage(err, 'Could not upload that photo.'))
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* ---------- appearance ---------- */
  const [themeSaved, setThemeSaved] = useState(false)

  async function pickTheme(next: ThemeMode) {
    setMode(next)
    setThemeSaved(true)
    setTimeout(() => setThemeSaved(false), 2200)
    try {
      await updateProfile({ theme: next })
    } catch {
      // Local preference already applied; the row sync is best-effort.
    }
  }

  /* ---------- notifications ---------- */
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => {
    loadNotificationPrefs().then(setPrefs)
  }, [loadNotificationPrefs])

  async function togglePref(key: NotificationKey, next: boolean) {
    if (!prefs) return
    const previous = prefs
    setPrefs({ ...prefs, [key]: next })
    setPrefsError(null)
    try {
      await updateNotificationPrefs({ [key]: next })
      setPrefsSaved(true)
      setTimeout(() => setPrefsSaved(false), 2200)
    } catch (err) {
      setPrefs(previous)
      setPrefsError(authErrorMessage(err, 'Could not save that preference.'))
    }
  }

  /* ---------- security ---------- */
  const [resetBusy, setResetBusy] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  async function emailResetLink() {
    if (!profile) return
    setResetError(null)
    setResetBusy(true)
    try {
      await sendPasswordReset(profile.email)
      setResetSent(true)
    } catch (err) {
      setResetError(authErrorMessage(err, 'Could not send the link.'))
    } finally {
      setResetBusy(false)
    }
  }

  if (!profile) return null

  return (
    <div className="mx-auto w-full max-w-[820px]">
      <header>
        <p className="eyebrow text-amber-500 dark:text-amber-300">
          {ROLE_LABEL[profile.role]} account
        </p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Settings</h1>
        <p className="mt-2.5 text-[15.5px] text-muted">
          Your name, how Collabify looks, what it emails you, and how you sign in.
        </p>
      </header>

      <div className="mt-8 space-y-5">
        <Section icon="user" title="Profile" description="How your name appears to your group and advisers.">
          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Avatar profile={profile} size={92} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarBusy}
                  aria-label="Change profile photo"
                  className="absolute right-0 bottom-0 grid h-8 w-8 place-items-center rounded-full bg-navy-600 text-white ring-3 ring-[var(--surface)] transition-colors hover:bg-navy-500 disabled:opacity-60"
                >
                  {avatarBusy ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onAvatarPicked(e.target.files?.[0])}
              />
              <p className="text-center text-[11.5px] text-faint">JPG, PNG or WebP · max 2 MB</p>
            </div>

            <form onSubmit={saveProfile} className="min-w-0 flex-1 space-y-4">
              {avatarError && <Alert tone="error">{avatarError}</Alert>}
              {profileError && <Alert tone="error">{profileError}</Alert>}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Last name">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <Field label="Middle name" optional>
                {(id) => (
                  <Input
                    id={id}
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Email" hint={<span className="text-[12px] text-faint">Can't be changed</span>}>
                {(id) => <Input id={id} value={profile.email} readOnly disabled icon="mail" />}
              </Field>

              <div className="flex items-center gap-3">
                <Button type="submit" loading={profileBusy} className="!rounded-xl">
                  Save changes
                </Button>
                <Saved show={profileSaved} />
              </div>
            </form>
          </div>
        </Section>

        <Section icon="palette" title="Appearance" description="Applies on this device right away, and follows your account.">
          <div className="grid gap-3 sm:grid-cols-3">
            {APPEARANCE.map((a) => {
              const active = mode === a.mode
              return (
                <button
                  key={a.mode}
                  type="button"
                  aria-pressed={active}
                  onClick={() => pickTheme(a.mode)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-6 transition-[border-color,background-color,box-shadow] duration-200 ${
                    active
                      ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                      : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                  }`}
                >
                  <Icon
                    name={a.icon}
                    size={22}
                    className={active ? 'text-navy-600 dark:text-navy-100' : 'text-muted'}
                  />
                  <span
                    className={`text-[14.5px] font-medium ${active ? 'text-navy-700 dark:text-navy-100' : 'text-ink'}`}
                  >
                    {a.label}
                  </span>
                  <span className="text-[11.5px] text-faint">{a.note}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Saved show={themeSaved} text="Appearance saved" />
          </div>
        </Section>

        <Section icon="bell" title="Notifications" description="Pick what reaches your inbox. Changes save as you flip them.">
          {prefsError && (
            <div className="mb-4">
              <Alert tone="error">{prefsError}</Alert>
            </div>
          )}
          {!prefs ? (
            <div className="flex items-center gap-2.5 py-4 text-[14px] text-muted">
              <Spinner size={16} />
              Loading your preferences…
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {NOTIFICATIONS.map((n) => (
                <li key={n.key} className="flex items-start justify-between gap-5 py-4 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-ink">{n.label}</p>
                    <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">{n.body}</p>
                  </div>
                  <Toggle
                    label={n.label}
                    checked={Boolean(prefs[n.key])}
                    onChange={(next) => togglePref(n.key, next)}
                  />
                </li>
              ))}
              <li className="flex items-start justify-between gap-5 py-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">Security alerts</p>
                  <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">
                    Password changes and new sign-ins. Always on, so a stolen account cannot
                    hide itself.
                  </p>
                </div>
                <Toggle label="Security alerts" checked disabled onChange={() => {}} />
              </li>
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Saved show={prefsSaved} />
          </div>
        </Section>

        <Section icon="shield" title="Security" description="Change your password, or end this session.">
          <div className="space-y-5">
            {resetError && <Alert tone="error">{resetError}</Alert>}
            {resetSent && (
              <Alert tone="success">
                A reset link is on its way to <strong>{profile.email}</strong>. It works for one
                hour.
              </Alert>
            )}

            <div className="flex flex-col gap-4 rounded-xl border border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">Password</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">
                  We email a link to {profile.email} so nobody can change it from an unlocked
                  screen.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={emailResetLink}
                loading={resetBusy}
                className="!rounded-xl sm:shrink-0"
              >
                <Icon name="mail" size={17} />
                Email me a reset link
              </Button>
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">Sign out</p>
                <p className="mt-0.5 text-[13.5px] text-muted">
                  Ends this session on this device only.
                </p>
              </div>
              <Button variant="danger" onClick={signOut} className="!rounded-xl sm:shrink-0">
                <Icon name="logout" size={17} />
                Sign out
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
