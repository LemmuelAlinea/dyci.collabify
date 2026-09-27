import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../components/app/Avatar'
import { DirectoryHero } from '../components/app/DirectoryHero'
import { Button, ButtonLink } from '../components/ui/Button'
import { Field, Input, Toggle } from '../components/ui/Field'
import { Alert } from '../components/ui/Alert'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'
import { Spinner } from '../components/ui/Icon'
import { useAuth } from '../context/AuthContext'
import { useGeneralNavigation } from '../context/generalNavigation'
import { AVATAR_ACCEPT, avatarExtension, avatarProblem } from '../lib/limits'
import { useThemePreference } from '../hooks/useThemePreference'
import { canTeach, membershipOf } from '../lib/access'
import { authErrorMessage } from '../lib/authError'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'
import type { NotificationKey, NotificationPrefs, Role, ThemeMode } from '../lib/types'

/**
 * Each switch controls something real, and each person sees only the ones that
 * can reach them. supabase/notifications.sql and notification-coverage.sql are
 * the map; the copy here is what each switch actually does for this reader.
 */
type Reader = {
  role: Role | null
  teaching: boolean
  inClass: boolean
  hasWork: boolean
}

type NotificationRow = {
  key: NotificationKey
  label: (r: Reader) => string
  body: (r: Reader) => string
  shown: (r: Reader) => boolean
}

const isStudent = (r: Reader) => r.role === 'student'
/** An admin in nothing gets program notices and nothing else. */
const inSomething = (r: Reader) => r.role !== 'admin' || r.inClass || r.hasWork

const NOTIFICATIONS: NotificationRow[] = [
  {
    key: 'submissions',
    label: (r) => (r.teaching ? 'Hand-ins and reviews' : 'Reviews'),
    body: (r) =>
      r.teaching
        ? 'When a group or student hands work in to your class, or a change in a work project waits for your review.'
        : 'When a change in a work project waits for your review.',
    shown: (r) => (isStudent(r) ? r.hasWork : inSomething(r)),
  },
  {
    key: 'task_assignments',
    label: () => 'Task assignments',
    body: (r) =>
      isStudent(r)
        ? r.hasWork
          ? 'When a class or work task is assigned to you.'
          : 'When a class task is assigned to you.'
        : 'When a work task is assigned to you.',
    shown: inSomething,
  },
  {
    key: 'deadline_reminders',
    label: () => 'Deadline reminders',
    body: () => 'One nudge the day before a task you hold is due. Never twice for the same task.',
    shown: inSomething,
  },
  {
    key: 'comments_mentions',
    label: () => 'Comments',
    body: () => 'When somebody writes on a task you hold, or one you have commented on.',
    shown: inSomething,
  },
  {
    key: 'project_invites',
    label: (r) => (isStudent(r) ? 'New projects and groups' : 'Accepted invitations'),
    body: (r) =>
      isStudent(r)
        ? 'When a class project opens to you, you are placed in a group, or somebody accepts an invitation you sent.'
        : 'When somebody accepts an invitation you sent to a space, class or project.',
    shown: inSomething,
  },
  {
    key: 'project_updates',
    label: () => 'Project changes',
    body: (r) =>
      isStudent(r)
        ? "When a class project's due date moves or it closes, a work project you are on is archived or restored, or your role in a space or project changes."
        : 'When a work project you are on is archived or restored, or your role in a space or project changes.',
    shown: inSomething,
  },
  {
    key: 'progress_digest',
    label: () => 'Weekly digest',
    body: () => 'Monday morning: what you finished last week, what is due next, and anything past its date.',
    shown: isStudent,
  },
  {
    key: 'announcements',
    label: () => 'Announcements',
    body: (r) =>
      isStudent(r) || r.teaching || r.inClass
        ? 'Class announcements and program notices.'
        : 'Program notices.',
    shown: () => true,
  },
]

const APPEARANCE: { mode: ThemeMode; label: string; icon: IconName; note: string }[] = [
  { mode: 'light', label: 'Light', icon: 'sun', note: 'Always bright' },
  { mode: 'dark', label: 'Dark', icon: 'moon', note: 'Always dim' },
  { mode: 'system', label: 'System', icon: 'monitor', note: 'Follow device' },
]

function Section({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string
  icon: IconName
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section
      id={id}
      className="surface scroll-mt-28 overflow-hidden rounded-panel border border-line"
    >
      <header className="flex items-start gap-3.5 border-b border-line bg-[var(--surface-sunken)] px-5 py-4 sm:px-6">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-300 dark:bg-navy-500">
          <Icon name={icon} size={19} />
        </span>
        <div className="min-w-0">
          <h2>{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{description}</p>
        </div>
      </header>
      <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </section>
  )
}

function Saved({ show, text = 'Saved' }: { show: boolean; text?: string }) {
  if (!show) return null
  return (
    <span className="flex items-center gap-2 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
      <Icon name="check" size={15} strokeWidth={2.6} />
      {text}
    </span>
  )
}

export default function Settings() {
  const { profile, updateProfile, loadNotificationPrefs, updateNotificationPrefs, sendPasswordReset, signOut } =
    useAuth()
  const navigation = useGeneralNavigation()
  const membership = membershipOf(navigation.spaces, navigation.myProjects)
  const { mode, choose } = useThemePreference()

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
    /**
     * Checked by type, not by extension. `payload.svg` renamed to `photo.png`
     * passes an extension test and is still an SVG — which the old code would
     * have stored under a `.png` path in a public bucket that Supabase serves
     * without `X-Content-Type-Options`.
     *
     * The bucket's own allowlist is what actually enforces this; the check
     * here saves a doomed upload and gives a better sentence than the storage
     * API's.
     */
    const problem = avatarProblem(file)
    if (problem) {
      setAvatarError(problem)
      return
    }
    setAvatarBusy(true)
    try {
      const path = `${profile.id}/${Date.now()}.${avatarExtension(file)}`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      await updateProfile({ avatar_url: data.publicUrl })

      // Drop what the folder held before this one.
      //
      // The name carries a timestamp, so every replacement used to leave the
      // previous photo behind — and the bucket is public, so each of those
      // stayed readable by anyone holding its link, for ever. Someone who
      // changed their picture to a less identifiable one did not actually
      // withdraw the first.
      //
      // After the write, and failing quietly: the new photo is already saved
      // and a tidy-up that did not run is not worth showing an error over.
      try {
        const { data: existing } = await supabase.storage.from('avatars').list(profile.id)
        const stale = (existing ?? [])
          .map((f) => `${profile.id}/${f.name}`)
          .filter((p) => p !== path)
        if (stale.length) await supabase.storage.from('avatars').remove(stale)
      } catch {
        // Left behind rather than surfaced. The next replacement tries again.
      }
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
    setThemeSaved(true)
    setTimeout(() => setThemeSaved(false), 2200)
    await choose(next)
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

  const reader: Reader = {
    role: profile.role,
    teaching: canTeach(profile),
    inClass: membership?.inClass ?? false,
    hasWork: membership?.hasWork ?? false,
  }
  const rows = NOTIFICATIONS.filter((n) => n.shown(reader))
  const enabledNotifications = prefs ? rows.filter((n) => prefs[n.key]).length : '—'
  const themeLabel = APPEARANCE.find((appearance) => appearance.mode === mode)?.label ?? 'System'

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Set up Collabify,"
        accent="your way."
        description="Manage your identity, appearance, notifications and account access from one place."
        stats={[
          { value: profile.role ? ROLE_LABEL[profile.role] : 'Account', label: 'Signed in as' },
          { value: themeLabel, label: 'Appearance' },
          { value: enabledNotifications, label: 'Notifications on' },
        ]}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,820px)] xl:grid-cols-[260px_minmax(0,900px)]">
        <aside className="surface overflow-hidden rounded-panel border border-line lg:sticky lg:top-28">
          <div className="flex items-center gap-3 border-b border-line bg-[var(--surface-sunken)] p-4">
            <Avatar profile={profile} size={42} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-ink">
                {profile.first_name} {profile.last_name}
              </p>
              <p className="truncate text-[12px] text-muted">{profile.email}</p>
            </div>
          </div>
          <nav aria-label="Settings sections" className="p-2">
            {[
              { id: 'profile', icon: 'user' as IconName, label: 'Profile' },
              { id: 'appearance', icon: 'palette' as IconName, label: 'Appearance' },
              { id: 'notifications', icon: 'bell' as IconName, label: 'Notifications' },
              { id: 'security', icon: 'shield' as IconName, label: 'Security' },
            ].map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <Section
            id="profile"
            icon="user"
            title="Profile"
            description="How your name appears across Collabify."
          >
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
                accept={AVATAR_ACCEPT}
                className="hidden"
                onChange={(e) => onAvatarPicked(e.target.files?.[0])}
              />
              <p className="text-center text-[12px] text-faint">JPG, PNG or WebP · max 2 MB</p>
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

          <Section
            id="appearance"
            icon="palette"
            title="Appearance"
            description="Applies on this device right away, and follows your account."
          >
          <div className="grid grid-cols-3 gap-3 sm:gap-3">
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
                    className={`text-[14px] font-medium ${active ? 'text-navy-700 dark:text-navy-100' : 'text-ink'}`}
                  >
                    {a.label}
                  </span>
                  <span className="text-[12px] text-faint">{a.note}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Saved show={themeSaved} text="Appearance saved" />
          </div>
          </Section>

          <Section
            id="notifications"
            icon="bell"
            title="Notifications"
            description="Choose what shows up under the bell. Changes save as you flip them."
          >
          {prefsError && (
            <div className="mb-4">
              <Alert tone="error">{prefsError}</Alert>
            </div>
          )}
          {!prefs ? (
            <div className="flex items-center gap-3 py-4 text-[14px] text-muted">
              <Spinner size={16} />
              Loading your preferences…
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {rows.map((n) => (
                <li key={n.key} className="flex items-start justify-between gap-5 py-4 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{n.label(reader)}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{n.body(reader)}</p>
                  </div>
                  <Toggle
                    label={n.label(reader)}
                    checked={Boolean(prefs[n.key])}
                    onChange={(next) => togglePref(n.key, next)}
                  />
                </li>
              ))}
              {/* Anything somebody must act on, or asked for, arrives regardless. */}
              <li className="flex items-start justify-between gap-5 py-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">Always on</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                    {isStudent(reader)
                      ? 'Invitations to a space or project, answers to reassignment and access requests, and results for work you handed in. You need these to act, so they cannot be turned off.'
                      : 'Invitations to a space, class or project, requests waiting on you, and answers to things you asked for. You need these to act, so they cannot be turned off.'}
                  </p>
                </div>
                <Toggle label="Always on" checked disabled onChange={() => {}} />
              </li>
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Saved show={prefsSaved} />
          </div>
          </Section>

          <Section
            id="security"
            icon="shield"
            title="Security"
            description="Change your password, or end this session."
          >
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
                <p className="text-[14px] font-medium text-ink">Your data</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                  Request a copy of your Collabify data or ask for account data help.
                </p>
              </div>
              <ButtonLink to="/privacy/request" variant="outline" className="!rounded-xl sm:shrink-0">
                <Icon name="shield" size={17} />
                Open your data
              </ButtonLink>
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-line p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">Password</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
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
                <p className="text-[14px] font-medium text-ink">Sign out</p>
                <p className="mt-0.5 text-[13px] text-muted">
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
    </div>
  )
}
