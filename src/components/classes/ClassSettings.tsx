import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ClassForm } from './ClassForm'
import { CLASS_TILE, ClassMark } from './ClassMark'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input, Toggle } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { CustomColor, PICK } from '../general/settings/GeneralSection'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { notifyClassLooksChanged } from '../../hooks/useClassLooks'
import { setArchived, updateClass } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import { authErrorMessage } from '../../lib/authError'
import { CLASS_ICONS, classIconLabel } from '../../lib/classLook'
import type { ClassLook } from '../../lib/classLook'
import type { ClassSettingsSection } from '../../lib/classSpace'
import { PROJECT_COLORS, SWATCH_CLASS, isCustomColor, projectLookLabel } from '../../lib/general/projectLook'
import { inviteLink } from '../../lib/pendingJoin'
import type { ClassSummary, TeachingResource } from '../../lib/types'

const SECTIONS: { id: ClassSettingsSection; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'groups', label: 'Groups', icon: 'kanban' },
]

/**
 * A class's Settings, laid out like a work project's: a menu of sections, the
 * open one in `?section=`. General holds the look and access, the details and
 * the danger zone; Members and Groups are the class's people, passed in by the
 * class page that already loads them.
 */
export function ClassSettings({
  cls,
  look,
  onChanged,
  onToggleJoin,
  members,
  groups,
  removedCount,
  section: active,
}: {
  cls: ClassSummary
  look: ClassLook | null
  onChanged: () => Promise<void>
  onToggleJoin: (open: boolean) => Promise<void>
  members: ReactNode
  groups: ReactNode
  removedCount: number
  /** The open section, read by the class page (old People links included). */
  section: ClassSettingsSection
}) {
  const [params, setParams] = useSearchParams()
  const nav = useRef<HTMLElement>(null)

  // On a phone the menu scrolls sideways: keep the open section in view.
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (typeof current?.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  function open(next: ClassSettingsSection) {
    const changed = new URLSearchParams(params)
    changed.set('tab', 'settings')
    if (next === 'general') changed.delete('section')
    else changed.set('section', next)
    // An old People link's view means nothing once a section is picked.
    changed.delete('view')
    setParams(changed, { replace: true })
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
      <nav
        ref={nav}
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-4 md:w-[200px] md:shrink-0 md:flex-col md:overflow-visible"
      >
        {SECTIONS.map((s) => {
          const on = s.id === active
          return (
            <button
              key={s.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => open(s.id)}
              className={`relative flex h-9 shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-left text-[14px] transition-colors md:w-full ${
                on
                  ? 'bg-nav-active font-semibold text-nav-active-ink'
                  : 'font-medium text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
              }`}
            >
              {on && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 hidden w-[3px] rounded-full bg-nav-marker md:block"
                />
              )}
              <Icon name={s.icon} size={17} className={on ? 'shrink-0' : 'shrink-0 text-nav-icon'} />
              {s.label}
              {s.id === 'members' && (
                <span
                  title={removedCount ? `${cls.student_count} active, ${removedCount} removed` : undefined}
                  className={`rounded-full px-2 py-0.5 font-mono text-[12px] ${
                    on ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900' : 'surface-sunken text-faint'
                  }`}
                >
                  {cls.student_count}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1">
        {active === 'members' ? (
          members
        ) : active === 'groups' ? (
          groups
        ) : (
          <div className="space-y-6">
            <LookPanel cls={cls} look={look} onChanged={onChanged} onToggleJoin={onToggleJoin} />
            <DetailsPanel cls={cls} onChanged={onChanged} />
            <DangerZone cls={cls} onChanged={onChanged} />
          </div>
        )}
      </div>
    </div>
  )
}

type Draft = { color: ClassLook['color']; icon: ClassLook['icon']; cap: string }

/** Color, icon and who can get in: the code, the invite link, joining and the size limit. */
function LookPanel({
  cls,
  look,
  onChanged,
  onToggleJoin,
}: {
  cls: ClassSummary
  look: ClassLook | null
  onChanged: () => Promise<void>
  onToggleJoin: (open: boolean) => Promise<void>
}) {
  const { show } = useToast()
  const group = useId()
  const editable = !cls.archived_at
  const stored: Draft = {
    color: look?.color ?? null,
    icon: look?.icon ?? null,
    cap: cls.student_cap ? String(cls.student_cap) : '',
  }
  const [draft, setDraft] = useState<Partial<Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const now: Draft = { ...stored, ...draft }
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) => draft[k] !== stored[k])
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  async function copy(what: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(what === 'code' ? cls.code : inviteLink(cls.code, window.location.origin))
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      show('Could not copy. Select the code and copy it manually.', 'error')
    }
  }

  async function save() {
    const cap = now.cap.trim()
    const capNumber = cap ? Number(cap) : null
    if (capNumber !== null && (!Number.isInteger(capNumber) || capNumber < 1 || capNumber > 500)) {
      setError('The size limit is a whole number from 1 to 500. Leave it empty for no limit.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateClass(cls.id, { color: now.color, icon: now.icon, student_cap: capNumber })
      show('Look and access saved')
      notifyClassLooksChanged()
      await onChanged()
      setDraft({})
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the look and access.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4">
        <h2>Look and access</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          How the class appears to you and your students, and how students get in.
        </p>
      </header>

      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_272px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-[13px] font-medium text-ink">Color</legend>
              <div className="flex flex-wrap gap-2">
                <label className={`${PICK} px-2`} title="No color">
                  <input
                    type="radio"
                    name={`${group}-color`}
                    value=""
                    aria-label="No color"
                    checked={now.color === null}
                    disabled={!editable}
                    onChange={() => set('color', null)}
                    className="sr-only"
                  />
                  <span aria-hidden className="text-[12px]">None</span>
                </label>
                {PROJECT_COLORS.map((c) => (
                  <label key={c} className={PICK} title={projectLookLabel(c)}>
                    <input
                      type="radio"
                      name={`${group}-color`}
                      value={c}
                      aria-label={projectLookLabel(c)}
                      checked={now.color === c}
                      disabled={!editable}
                      onChange={() => set('color', c)}
                      className="sr-only"
                    />
                    <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-lg ${SWATCH_CLASS[c].tile}`}>
                      {now.color === c && <Icon name="check" size={14} />}
                    </span>
                  </label>
                ))}
                <CustomColor
                  group={group}
                  value={isCustomColor(now.color) ? now.color : null}
                  disabled={!editable}
                  onPick={(hex) => set('color', hex)}
                />
              </div>
            </fieldset>

            <fieldset className="min-w-0 space-y-2">
              <legend className="text-[13px] font-medium text-ink">Icon</legend>
              <p className="text-[12px] text-muted">With no icon, the tile shows the class initials.</p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2">
                <label className={`${PICK} px-1`} title="Class initials">
                  <input
                    type="radio"
                    name={`${group}-icon`}
                    value=""
                    aria-label="Class initials"
                    checked={now.icon === null}
                    disabled={!editable}
                    onChange={() => set('icon', null)}
                    className="sr-only"
                  />
                  <span aria-hidden className="max-w-full truncate font-mono text-[11px] font-bold">
                    {cls.initial}
                  </span>
                </label>
                {CLASS_ICONS.map((name) => (
                  <label key={name} className={PICK} title={classIconLabel(name)}>
                    <input
                      type="radio"
                      name={`${group}-icon`}
                      value={name}
                      aria-label={classIconLabel(name)}
                      checked={now.icon === name}
                      disabled={!editable}
                      onChange={() => set('icon', name)}
                      className="sr-only"
                    />
                    <span aria-hidden className={now.icon === name ? 'text-ink' : undefined}>
                      <Icon name={name} size={20} />
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <LookPreview cls={cls} look={{ color: now.color, icon: now.icon }} />
        </div>

        <div className="space-y-4 border-t border-line pt-5">
          <h3 className="text-[14px] font-medium text-ink">Access</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-3.5">
              <p className="text-[12px] text-muted">Class code</p>
              <button
                type="button"
                onClick={() => void copy('code')}
                title="Copy class code"
                className="mt-1 inline-flex items-center gap-2 font-mono text-[16px] font-bold tracking-wide text-ink hover:text-navy-600 dark:hover:text-amber-300"
              >
                {cls.code}
                <Icon name={copied === 'code' ? 'check' : 'copy'} size={14} />
              </button>
              <button
                type="button"
                onClick={() => void copy('link')}
                className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted transition-colors hover:text-ink"
              >
                <Icon name={copied === 'link' ? 'check' : 'copy'} size={13} />
                {copied === 'link' ? 'Invite link copied' : 'Copy invite link'}
              </button>
              <p className="mt-2 text-[12px] text-faint">The code never changes.</p>
            </div>
            <div className="rounded-xl border border-line p-3.5">
              <p className="text-[12px] text-muted">Joining</p>
              <label className="mt-2 flex items-center gap-3 text-[14px] font-medium text-ink">
                <Toggle
                  label="Allow students to join"
                  checked={cls.join_open}
                  disabled={!editable}
                  onChange={(next) => void onToggleJoin(next)}
                />
                {cls.join_open ? 'Open to new students' : 'Closed'}
              </label>
              <p className="mt-2 text-[12px] text-faint">Students already in the class stay either way.</p>
            </div>
          </div>
          <div className="max-w-xs">
            <Field
              label="Class size limit"
              optional
              hint={<span className="text-[12px] text-faint">Leave empty for no limit</span>}
            >
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  inputMode="numeric"
                  value={now.cap}
                  disabled={!editable}
                  onChange={(e) => set('cap', e.target.value)}
                  placeholder="40"
                />
              )}
            </Field>
          </div>
        </div>
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
            Save look and access
          </Button>
        </div>
      )}
    </section>
  )
}

/** How the chosen look will read: a class card, the side menu and the class banner. */
function LookPreview({ cls, look }: { cls: ClassSummary; look: ClassLook }) {
  return (
    <section aria-label="Preview" className="space-y-3 lg:sticky lg:top-4">
      <p className="eyebrow text-faint">Preview</p>

      <div className="rounded-xl border border-line bg-[var(--surface)] p-3.5">
        <div className="flex items-center gap-3">
          <ClassMark look={look} initial={cls.initial} {...CLASS_TILE.card} />
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-ink">{cls.name}</p>
            <p className="text-[12px] text-muted">Class card</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-[var(--surface-sunken)] p-2.5">
        <div className="flex items-center gap-3 rounded-lg px-1 py-1">
          <ClassMark look={look} initial={cls.name.trim().charAt(0).toUpperCase()} {...CLASS_TILE.rail} />
          <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{cls.name}</span>
        </div>
        <p className="mt-1 px-1 text-[11px] text-faint">Side menu</p>
      </div>

      <div className="@container relative overflow-hidden rounded-xl banner-fill px-3.5 py-3 text-banner-ink">
        <div className="flex items-center gap-2.5">
          <ClassMark look={look} initial={cls.initial} {...CLASS_TILE.banner} />
          <p className="min-w-0 truncate font-display text-[15px] font-semibold">{cls.name}</p>
        </div>
        <p className="mt-2 text-[11px] text-banner-faint">Class banner</p>
      </div>
    </section>
  )
}

/** The details a class was made with. The size limit lives under Access. */
function DetailsPanel({ cls, onChanged }: { cls: ClassSummary; onChanged: () => Promise<void> }) {
  const { profile } = useAuth()
  const { show } = useToast()
  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    void Promise.all([listResources(profile.id, 'syllabus'), listResources(profile.id, 'curriculum')])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns stay as they are; saving the other fields does not need them.
      })
  }, [profile])

  async function save(input: ClassInput) {
    setError(null)
    setBusy(true)
    try {
      await updateClass(cls.id, input)
      show('Class updated')
      await onChanged()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save those changes.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4">
        <h2>Details</h2>
        <p className="mt-0.5 text-[12px] text-muted">What every class has.</p>
      </header>
      <ClassForm
        formId="class-settings"
        defaults={cls}
        syllabi={syllabi}
        curricula={curricula}
        error={error}
        onSubmit={save}
        hideCap
      />
      <div className="mt-5 flex justify-end border-t border-line pt-4">
        <Button form="class-settings" type="submit" loading={busy}>
          Save details
        </Button>
      </div>
    </section>
  )
}

/** Archiving, and restoring once archived. Deleting goes through Archive → Trash. */
function DangerZone({ cls, onChanged }: { cls: ClassSummary; onChanged: () => Promise<void> }) {
  const { show } = useToast()
  // The sidebar lists classes through their spaces, which archiving changes too.
  const { reload: reloadNavigation } = useGeneralNavigation()
  const [archivePrompt, setArchivePrompt] = useState(false)

  return (
    <section className="divide-y divide-danger-600/20 rounded-xl border border-danger-600/30">
      <header className="p-4 sm:px-5">
        <h2>Danger zone</h2>
        <p className="mt-0.5 text-[12px] text-muted">Only the people who teach the class can do this.</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
        <div className="min-w-0 max-w-[60ch]">
          <h3 className="text-[14px] font-medium text-ink">{cls.archived_at ? 'Restore class' : 'Archive class'}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {cls.archived_at
              ? 'Students get the class back in their list, with its roster and announcements.'
              : 'Students lose access and it leaves their class list. The roster and announcements are kept.'}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!cls.archived_at) return setArchivePrompt(true)
            try {
              await setArchived(cls.id, false)
              show('Class restored')
              await Promise.all([onChanged(), reloadNavigation()])
            } catch (err) {
              show(authErrorMessage(err, 'Could not restore the class.'), 'error')
            }
          }}
        >
          {cls.archived_at ? 'Restore class' : 'Archive class'}
        </Button>
      </div>

      <ConfirmDialog
        open={archivePrompt}
        onClose={() => setArchivePrompt(false)}
        onConfirm={async () => {
          await setArchived(cls.id, true)
          show(`${cls.name} archived`)
          await Promise.all([onChanged(), reloadNavigation()])
        }}
        title={`Archive ${cls.name}?`}
        body="Students lose access immediately and it disappears from their class list. The roster and announcements are kept, and you can restore it any time."
        confirmLabel="Archive class"
      />
    </section>
  )
}
