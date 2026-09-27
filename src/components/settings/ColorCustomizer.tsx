import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button } from '../ui/Button'
import { ActionMenu } from '../ui/ActionMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Modal } from '../ui/Modal'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import {
  DEFAULT_PICKS,
  PREVIEW_GROUND,
  normalizeHex,
  samePalette,
  toCssVars,
} from '../../lib/palette'
import type { Mode, PaletteColors, PickKey } from '../../lib/palette'
import { PRESETS } from '../../lib/palettePresets'
import {
  createPalette,
  deletePalette,
  listPalettes,
  paletteErrorMessage,
  saveMyAppearance,
  updatePalette,
} from '../../lib/api/appearance'
import type { SavedPalette } from '../../lib/api/appearance'

type Slot = { key: PickKey; label: string; note: string }

const GROUPS: { title: string; icon: IconName; slots: Slot[] }[] = [
  {
    title: 'Page banners',
    icon: 'board',
    slots: [
      { key: 'banner', label: 'Background', note: 'The band at the top of each page. Its text turns light or dark to stay readable.' },
      { key: 'bannerAccent', label: 'Accent', note: 'The highlighted word and the glow.' },
    ],
  },
  {
    title: 'Status highlights',
    icon: 'checkCircle',
    slots: [
      { key: 'success', label: 'Done', note: 'Finished work, accepted hand-ins, active accounts.' },
      { key: 'warning', label: 'In progress', note: 'Work under way, and things waiting on you.' },
      { key: 'danger', label: 'Late', note: 'Past due, errors and warnings.' },
      { key: 'pending', label: 'Pending', note: 'Not started yet.' },
    ],
  },
  {
    title: 'Sidebar',
    icon: 'menu',
    slots: [
      { key: 'navIcon', label: 'Icons', note: 'Every icon in the sidebar.' },
      { key: 'navActive', label: 'Current page', note: 'The icon, marker and letter of the page you are on.' },
    ],
  },
  {
    title: 'Progress and notifications',
    icon: 'chart',
    slots: [
      { key: 'progress', label: 'Progress bars', note: 'How far along a project, group or task list is.' },
      { key: 'badge', label: 'Unread badges', note: 'The counts on the bell and in the sidebar.' },
    ],
  },
]

/** A spread to start from: dark grounds, the status hues, a few brights, neutrals. */
const SWATCHES = [
  '#080b21', '#26327a', '#0b2540', '#0f2a1d', '#3b0a2a', '#000000',
  '#00bc7d', '#2f9e44', '#0072b2', '#1c7ed6', '#7048e8', '#e64980',
  '#fb2c36', '#d55e00', '#f0b429', '#ffd43b', '#59627f', '#ffffff',
]

const MODE_LABEL: Record<Mode, string> = { light: 'Light', dark: 'Dark' }

export function ColorCustomizer() {
  const { profile } = useAuth()
  const { resolved, colors, setColors } = useTheme()
  const { show } = useToast()
  const [editing, setEditing] = useState<Mode>(resolved)
  const [open, setOpen] = useState<PickKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [palettes, setPalettes] = useState<SavedPalette[] | null>(null)
  const [resetting, setResetting] = useState(false)
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<SavedPalette | null>(null)

  const picks = colors[editing] ?? {}

  // Save the colors in use to the account a moment after the last change, so
  // dragging through the native picker is one write, not fifty.
  const firstRun = useRef(true)
  const savedTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!profile) return
    const id = window.setTimeout(() => {
      saveMyAppearance(profile.id, colors)
        .then(() => {
          setSaved(true)
          window.clearTimeout(savedTimer.current)
          savedTimer.current = window.setTimeout(() => setSaved(false), 2200)
        })
        .catch(() => show('Your colors did not save to your account. They still apply on this device.', 'error'))
    }, 600)
    return () => window.clearTimeout(id)
  }, [colors, profile, show])

  useEffect(() => {
    listPalettes()
      .then(setPalettes)
      .catch(() => setPalettes([]))
  }, [])

  function setPick(key: PickKey, value: string | null) {
    const next = { ...picks }
    if (value) next[key] = value
    else delete next[key]
    setColors({ ...colors, [editing]: next })
  }

  function resetMode() {
    const next = { ...colors }
    delete next[editing]
    setColors(next)
    setOpen(null)
  }

  function applyPalette(c: PaletteColors, name: string) {
    setColors(c)
    setOpen(null)
    show(`${name} is on.`)
  }

  async function submitName() {
    if (!naming) return
    const name = naming.name.trim()
    if (!name) {
      setNameError('Give the palette a name.')
      return
    }
    setBusy(true)
    setNameError(null)
    try {
      if (naming.id) {
        await updatePalette(naming.id, { name })
        setPalettes((ps) => ps?.map((p) => (p.id === naming.id ? { ...p, name } : p)) ?? ps)
        show('Palette renamed.')
      } else {
        const p = await createPalette(name, colors)
        setPalettes((ps) => [...(ps ?? []), p])
        show(`Saved as ${p.name}.`)
      }
      setNaming(null)
    } catch (err) {
      setNameError(paletteErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function overwrite(p: SavedPalette) {
    try {
      await updatePalette(p.id, { colors })
      setPalettes((ps) => ps?.map((x) => (x.id === p.id ? { ...x, colors } : x)) ?? ps)
      show(`${p.name} now holds your current colors.`)
    } catch (err) {
      show(paletteErrorMessage(err), 'error')
    }
  }

  async function remove(p: SavedPalette) {
    await deletePalette(p.id)
    setPalettes((ps) => ps?.filter((x) => x.id !== p.id) ?? ps)
    show(`${p.name} deleted.`)
  }

  const touched = Object.keys(picks).length > 0
  const full = { ...DEFAULT_PICKS[editing], ...picks }

  return (
    <div className="@container mt-8 border-t border-line pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h3>Your colors</h3>
          <p className="mt-1 max-w-[60ch] text-[13px] text-muted">
            Only you see these. Light and dark each keep their own set, and anything you leave
            alone stays as it is.
          </p>
        </div>
        <div role="tablist" aria-label="Colors for" className="flex gap-1 rounded-lg surface-sunken p-1">
          {(['light', 'dark'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={editing === m}
              onClick={() => {
                setEditing(m)
                setOpen(null)
              }}
              className={`flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors ${
                editing === m ? 'surface text-ink shadow-card' : 'text-muted hover:text-ink'
              }`}
            >
              <Icon name={m === 'light' ? 'sun' : 'moon'} size={14} />
              {MODE_LABEL[m]} colors
            </button>
          ))}
        </div>
      </div>

      {editing !== resolved && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-faint">
          <Icon name="info" size={13} />
          You are in {MODE_LABEL[resolved].toLowerCase()} mode, so these show in the preview until you switch.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 @min-[720px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <fieldset key={g.title} className="min-w-0">
              <legend className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Icon name={g.icon} size={14} className="text-muted" />
                {g.title}
              </legend>
              <ul className="mt-2 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
                {g.slots.map((s) => (
                  <SlotRow
                    key={s.key}
                    slot={s}
                    value={picks[s.key] ?? null}
                    fallback={DEFAULT_PICKS[editing][s.key]}
                    open={open === s.key}
                    onToggle={() => setOpen(open === s.key ? null : s.key)}
                    onPick={(v) => setPick(s.key, v)}
                  />
                ))}
              </ul>
            </fieldset>
          ))}
        </div>

        <div className="order-first @min-[720px]:sticky @min-[720px]:top-24 @min-[720px]:order-none @min-[720px]:self-start">
          <Preview mode={editing} picks={full} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNaming({ id: null, name: '' })}
            >
              <Icon name="plus" size={14} />
              Save as palette
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!touched}
              onClick={() => setResetting(true)}
            >
              <Icon name="refresh" size={14} />
              Default colors
            </Button>
            <span className="ml-auto">
              {saved && (
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-success-600 dark:text-success-400">
                  <Icon name="check" size={14} strokeWidth={2.6} />
                  Saved
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h3>Palettes</h3>
        <p className="mt-1 text-[13px] text-muted">
          Applying one replaces both your light and dark colors. Save yours first to come back
          to it.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2 @min-[820px]:grid-cols-3">
          {PRESETS.map((p) => (
            <PaletteCard
              key={p.id}
              name={p.name}
              note={p.note}
              colors={p.colors}
              mode={editing}
              active={samePalette(p.colors, colors)}
              onApply={() => applyPalette(p.colors, p.name)}
            />
          ))}
          {(palettes ?? []).map((p) => (
            <PaletteCard
              key={p.id}
              name={p.name}
              note="Saved by you"
              colors={p.colors}
              mode={editing}
              active={samePalette(p.colors, colors)}
              onApply={() => applyPalette(p.colors, p.name)}
              menu={
                <ActionMenu
                  label={`More for ${p.name}`}
                  size="sm"
                  items={[
                    { label: 'Update with current colors', icon: 'refresh', onSelect: () => void overwrite(p) },
                    { label: 'Rename', icon: 'edit', onSelect: () => setNaming({ id: p.id, name: p.name }) },
                    { label: 'Delete', icon: 'trash', tone: 'danger', separated: true, onSelect: () => setDeleting(p) },
                  ]}
                />
              }
            />
          ))}
        </ul>
        {palettes && palettes.length === 0 && (
          <p className="mt-3 text-[12px] text-faint">
            Palettes you save show up here, up to 12.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={resetting}
        onClose={() => setResetting(false)}
        onConfirm={() => {
          resetMode()
          setResetting(false)
        }}
        title={`Go back to the default ${MODE_LABEL[editing].toLowerCase()} colors?`}
        body={`Every ${MODE_LABEL[editing].toLowerCase()} color you changed goes back to how Collabify ships. Save them as a palette first if you want them again.`}
        confirmLabel="Use default colors"
        tone="primary"
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await remove(deleting)
          } catch {
            show('The palette was not deleted. Try again.', 'error')
          }
          setDeleting(null)
        }}
        title={`Delete ${deleting?.name ?? 'this palette'}?`}
        body="The colors you are using now stay as they are."
        confirmLabel="Delete palette"
      />

      <Modal
        open={!!naming}
        onClose={() => {
          setNaming(null)
          setNameError(null)
        }}
        size="sm"
        title={naming?.id ? 'Rename palette' : 'Save as palette'}
        description={naming?.id ? undefined : 'Keeps your light and dark colors together under one name.'}
        focusField
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button size="sm" loading={busy} onClick={() => void submitName()}>
              {naming?.id ? 'Rename' : 'Save palette'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submitName()
          }}
        >
          <Field label="Name" error={nameError}>
            {(id) => (
              <Input
                id={id}
                value={naming?.name ?? ''}
                maxLength={40}
                placeholder="Evening study"
                onChange={(e) => setNaming((n) => (n ? { ...n, name: e.target.value } : n))}
              />
            )}
          </Field>
        </form>
      </Modal>
    </div>
  )
}

function SlotRow({
  slot,
  value,
  fallback,
  open,
  onToggle,
  onPick,
}: {
  slot: Slot
  value: string | null
  fallback: string
  open: boolean
  onToggle: () => void
  onPick: (value: string | null) => void
}) {
  const shown = value ?? fallback
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  const panelId = `slot-${slot.key}`
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <span
          aria-hidden
          className="h-7 w-7 shrink-0 rounded-lg border border-line-strong"
          style={{ background: shown }}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-ink">{slot.label}</span>
          <span className="block truncate text-[12px] text-faint">{slot.note}</span>
        </span>
        <span className="shrink-0 font-mono text-[12px] text-muted">{value ? value : 'Default'}</span>
        <Icon
          name="chevronDown"
          size={15}
          className={`shrink-0 text-faint transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={panelId} className="border-t border-line bg-[var(--surface-sunken)] px-3.5 py-3.5">
          <div className="grid grid-cols-9 gap-1.5 sm:grid-cols-[repeat(18,minmax(0,1fr))]">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use ${c}`}
                aria-pressed={shown === c}
                onClick={() => onPick(c)}
                className={`aspect-square rounded-md border transition-[box-shadow] ${
                  shown === c ? 'border-ink ring-2 ring-[var(--ring)] ring-offset-1' : 'border-line-strong'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[var(--control-line)] bg-[var(--surface)] px-2.5 text-[13px] text-ink">
              <input
                type="color"
                value={shown}
                onChange={(e) => onPick(e.target.value)}
                className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                aria-label={`Any color for ${slot.label}`}
              />
              Any color
            </label>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                const hex = normalizeHex(draft)
                if (hex) onPick(hex)
                else setDraft(shown)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              aria-label={`Hex code for ${slot.label}`}
              spellCheck={false}
              className="h-9 w-[104px] rounded-lg border border-[var(--control-line)] bg-[var(--surface)] px-2.5 font-mono text-[13px] text-ink"
            />
            {value && (
              <button
                type="button"
                onClick={() => onPick(null)}
                className="ml-auto text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Use default
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * A small page in the mode being edited. It sets every variable itself, from
 * the defaults plus the picks, so it can show dark while the site is light.
 */
function Preview({ mode, picks }: { mode: Mode; picks: Record<PickKey, string> }) {
  const style = useMemo(
    () => ({ ...PREVIEW_GROUND[mode], ...toCssVars(picks, mode) }) as CSSProperties,
    [mode, picks],
  )
  // Spelled out per mode, not built from a template: Tailwind only generates
  // classes it can read whole in the source.
  const light = mode === 'light'
  const pills: { label: string; cls: string }[] = [
    { label: 'Done', cls: `bg-success-500/15 ${light ? 'text-success-700' : 'text-success-300'}` },
    { label: 'In progress', cls: `bg-warning-400/18 ${light ? 'text-warning-700' : 'text-warning-300'}` },
    { label: 'Late', cls: `bg-danger-500/15 ${light ? 'text-danger-700' : 'text-danger-300'}` },
    { label: 'Pending', cls: 'bg-pending-soft text-pending-ink' },
  ]
  return (
    <div
      style={style}
      aria-label={`Preview of your ${mode} colors`}
      role="img"
      className="overflow-hidden rounded-xl border border-line bg-[var(--surface)] text-[var(--ink)]"
    >
      <div className="relative overflow-hidden bg-banner px-4 py-4 text-banner-ink">
        <span
          aria-hidden
          className="absolute -top-10 -right-8 h-28 w-28 rounded-full bg-banner-glow/20 blur-2xl"
        />
        <p className="relative font-display text-[16px] font-semibold">
          Your <span className="text-banner-accent">projects.</span>
        </p>
        <p className="relative mt-0.5 text-[11px] text-banner-ink/60">Everything you are working on.</p>
      </div>
      <div className="grid grid-cols-[92px_minmax(0,1fr)]">
        <div className="space-y-0.5 border-r border-[var(--line)] p-2 text-[11px] text-[var(--ink-muted)]">
          <span className="relative flex items-center gap-1.5 rounded-md bg-[var(--surface-sunken)] px-2 py-1.5 font-semibold text-[var(--ink)]">
            <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-nav-marker" />
            <Icon name="kanban" size={13} className="text-nav-active" />
            Projects
          </span>
          <span className="flex items-center gap-1.5 px-2 py-1.5">
            <Icon name="calendar" size={13} className="text-nav-icon" />
            Calendar
          </span>
          <span className="flex items-center gap-1.5 px-2 py-1.5">
            <Icon name="message" size={13} className="text-nav-icon" />
            <span className="flex-1">Inbox</span>
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-badge px-1 font-mono text-[9px] font-bold text-badge-ink">
              3
            </span>
          </span>
        </div>
        <div className="p-3">
          <div className="rounded-lg border border-warning-400/60 p-2.5">
            <p className="text-[12px] font-semibold">Database design</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {pills.map((p) => (
                <span key={p.label} className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${p.cls}`}>
                  {p.label}
                </span>
              ))}
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <span className="block h-full w-3/5 rounded-full bg-progress" />
            </div>
            <p className="mt-1 text-[10px] text-[var(--ink-faint)]">3 of 5 tasks done</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function PaletteCard({
  name,
  note,
  colors,
  mode,
  active,
  onApply,
  menu,
}: {
  name: string
  note: string
  colors: PaletteColors
  mode: Mode
  active: boolean
  onApply: () => void
  menu?: ReactNode
}) {
  const p = { ...DEFAULT_PICKS[mode], ...(colors[mode] ?? {}) }
  const chips: PickKey[] = ['banner', 'bannerAccent', 'success', 'warning', 'danger', 'progress']
  return (
    <li
      className={`flex flex-col rounded-xl border p-3.5 transition-colors ${
        active ? 'border-navy-500 bg-navy-50 dark:border-navy-300 dark:bg-navy-500/15' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink">{name}</p>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-faint">{note}</p>
        </div>
        {menu}
      </div>
      <div className="mt-3 flex items-center gap-1" aria-hidden>
        {chips.map((k) => (
          <span key={k} className="h-5 flex-1 rounded border border-line" style={{ background: p[k] }} />
        ))}
      </div>
      <div className="mt-3">
        {active ? (
          <span className="flex h-9 items-center gap-1.5 text-[13px] font-medium text-navy-600 dark:text-navy-100">
            <Icon name="check" size={14} strokeWidth={2.6} />
            In use
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={onApply}>
            Apply
          </Button>
        )}
      </div>
    </li>
  )
}
