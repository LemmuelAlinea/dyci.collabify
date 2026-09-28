import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button } from '../ui/Button'
import { ActionMenu } from '../ui/ActionMenu'
import { Modal } from '../ui/Modal'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import {
  DEFAULT_PICKS,
  bannerReadable,
  groundFor,
  normalizeHex,
  previewGround,
  samePalette,
  toCssVars,
} from '../../lib/palette'
import type { BannerStyle, Mode, PaletteColors, PickKey, Picks } from '../../lib/palette'
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
type GroupId = 'banners' | 'buttons' | 'status' | 'sidebar' | 'progress' | 'badges' | 'icons'

const GROUPS: { id: GroupId; title: string; icon: IconName; blurb: string; slots: Slot[] }[] = [
  {
    id: 'banners',
    title: 'Page banners',
    icon: 'board',
    blurb: 'The band at the top of each page. Its text turns light or dark to stay readable.',
    slots: [
      { key: 'banner', label: 'Background', note: 'The banner color.' },
      { key: 'banner2', label: 'Right color', note: 'Where the gradient ends.' },
      { key: 'bannerAccent', label: 'Accent', note: 'The highlighted words and the glow.' },
    ],
  },
  {
    id: 'buttons',
    title: 'Buttons',
    icon: 'plus',
    blurb: 'Create and save buttons everywhere, and the other buttons on the banners. Their text adjusts to stay readable.',
    slots: [
      { key: 'btnCreate', label: 'Create and save', note: 'New project, Create class, Save changes, and every main button in a dialog.' },
      { key: 'btnAction', label: 'Other banner actions', note: 'Edit, Report, Publish, Save as template, Join with code.' },
      { key: 'btnDanger', label: 'Banner archive and delete', note: 'Archive, Delete, Empty trash, Leave group.' },
    ],
  },
  {
    id: 'status',
    title: 'Status highlights',
    icon: 'checkCircle',
    blurb: 'The pills, card outlines and chart segments that say how work stands.',
    slots: [
      { key: 'success', label: 'Done', note: 'Finished work, accepted hand-ins, active accounts.' },
      { key: 'warning', label: 'In progress', note: 'Work under way, and things waiting on you.' },
      { key: 'danger', label: 'Late', note: 'Past due, errors and warnings.' },
      { key: 'pending', label: 'Pending', note: 'Not started yet.' },
    ],
  },
  {
    id: 'sidebar',
    title: 'Sidebar',
    icon: 'menu',
    blurb: 'The icons down the left, and how the page you are on is marked.',
    slots: [
      { key: 'navIcon', label: 'Icons', note: 'Every icon in the sidebar.' },
      { key: 'navActive', label: 'Current page', note: 'Its icon, marker and letter square.' },
    ],
  },
  {
    id: 'progress',
    title: 'Progress bars',
    icon: 'chart',
    blurb: 'How far along a project, group or task list is.',
    slots: [{ key: 'progress', label: 'Fill', note: 'The filled part of every progress bar.' }],
  },
  {
    id: 'badges',
    title: 'Notifications',
    icon: 'bell',
    blurb: 'Unread counts on the bell and in the sidebar, and the dot on a new notification.',
    slots: [{ key: 'badge', label: 'Unread badges', note: 'The count and the dot.' }],
  },
  {
    id: 'icons',
    title: 'Project icons',
    icon: 'kanban',
    blurb: 'The icon squares on project, class, group, space and syllabus cards.',
    slots: [
      { key: 'iconTile', label: 'Tile', note: 'The square behind the icon.' },
      { key: 'iconGlyph', label: 'Icon', note: 'The symbol or initials on it.' },
    ],
  },
]

const BANNER_STYLES: { id: BannerStyle; label: string; note: string }[] = [
  { id: 'glow', label: 'Glow', note: 'A soft glow and grid, as Collabify ships' },
  { id: 'solid', label: 'Solid', note: 'One flat color' },
  { id: 'gradient', label: 'Gradient', note: 'Two colors, left to right' },
]

/** A spread to start from: dark grounds, the status hues, a few brights, neutrals. */
const SWATCHES = [
  '#080b21', '#26327a', '#0b2540', '#0f2a1d', '#3b0a2a', '#000000',
  '#00bc7d', '#2f9e44', '#0072b2', '#1c7ed6', '#7048e8', '#e64980',
  '#fb2c36', '#d55e00', '#f0b429', '#ffd43b', '#59627f', '#ffffff',
]

const MODE_LABEL: Record<Mode, string> = { light: 'Light', dark: 'Dark' }

type Strip =
  | { kind: 'name'; id: string | null; name: string }
  | { kind: 'reset' }
  | { kind: 'delete'; palette: SavedPalette }

/**
 * The "Your colors" row in Settings → Appearance, and the editor it opens.
 * Changes apply to the site as they are made and save to the account a moment
 * later; each group has its own preview so the effect shows even for the mode
 * the site is not in.
 */
export function ColorCustomizer() {
  const { profile } = useAuth()
  const { resolved, colors, setColors } = useTheme()
  const { show } = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Mode>(resolved)
  const [openSlot, setOpenSlot] = useState<PickKey | null>(null)
  const [saved, setSaved] = useState(false)
  const [palettes, setPalettes] = useState<SavedPalette[] | null>(null)
  const [strip, setStrip] = useState<Strip | null>(null)
  const [stripError, setStripError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const picks: Picks = colors[editing] ?? {}
  // The outlined banner buttons follow the banner's text until picked, so the
  // previews leave them unset rather than filling in a fixed default.
  const full: Picks = { ...DEFAULT_PICKS[editing], btnAction: undefined, btnDanger: undefined, ...picks }

  // Save the colors in use to the account a moment after the last change, so
  // dragging the native picker or the depth slider is one write, not fifty.
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
    if (!open || palettes) return
    listPalettes()
      .then(setPalettes)
      .catch(() => setPalettes([]))
  }, [open, palettes])

  function openEditor() {
    setEditing(resolved)
    setOpenSlot(null)
    setStrip(null)
    setOpen(true)
  }

  function patch(next: Picks) {
    const clean: Picks = {}
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== null && v !== '') (clean as Record<string, unknown>)[k] = v
    }
    const all = { ...colors }
    if (Object.keys(clean).length) all[editing] = clean
    else delete all[editing]
    setColors(all)
  }

  function setPick(key: PickKey, value: string | null) {
    patch({ ...picks, [key]: value ?? undefined })
  }

  function resetGroup(keys: (keyof Picks)[]) {
    const next = { ...picks }
    for (const k of keys) delete next[k]
    patch(next)
    setOpenSlot(null)
  }

  function applyPalette(c: PaletteColors, name: string) {
    setColors(c)
    setOpenSlot(null)
    show(`${name} is on.`)
  }

  async function submitName() {
    if (strip?.kind !== 'name') return
    const name = strip.name.trim()
    if (!name) {
      setStripError('Give the palette a name.')
      return
    }
    setBusy(true)
    setStripError(null)
    try {
      if (strip.id) {
        const id = strip.id
        await updatePalette(id, { name })
        setPalettes((ps) => ps?.map((p) => (p.id === id ? { ...p, name } : p)) ?? ps)
        show('Palette renamed.')
      } else {
        const p = await createPalette(name, colors)
        setPalettes((ps) => [...(ps ?? []), p])
        show(`Saved as ${p.name}.`)
      }
      setStrip(null)
    } catch (err) {
      setStripError(paletteErrorMessage(err))
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
    setBusy(true)
    try {
      await deletePalette(p.id)
      setPalettes((ps) => ps?.filter((x) => x.id !== p.id) ?? ps)
      show(`${p.name} deleted.`)
      setStrip(null)
    } catch {
      setStripError('The palette was not deleted. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const style: BannerStyle = picks.bannerStyle ?? 'glow'
  const depth = editing === 'dark' ? (picks.depth ?? 0) : 0
  const touched = Object.keys(picks).length > 0
  const inUse = colors[resolved] ?? {}
  const summary = { ...DEFAULT_PICKS[resolved], ...inUse }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-5">
      <div className="min-w-0 flex-1">
        <h3>Your colors</h3>
        <p className="mt-1 max-w-[62ch] text-[13px] text-muted">
          Banners and their buttons, statuses, the sidebar, progress bars, badges and project icons, set apart for
          light and dark, plus how black dark mode goes. Only you see them.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            {(['banner', 'bannerAccent', 'success', 'warning', 'danger', 'progress', 'iconTile'] as const).map((k) => (
              <span key={k} className="h-4 w-4 rounded border border-line-strong" style={{ background: summary[k] }} />
            ))}
          </span>
          <span className="text-[12px] text-faint">
            {Object.keys(inUse).length ? `Your ${resolved} colors` : `Default ${resolved} colors`}
          </span>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={openEditor}>
        <Icon name="palette" size={15} />
        Customize colors
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Your colors"
        description="Changes show on the site as you make them and save to your account. Only you see them."
        bodyClassName="!px-0 !py-0"
        footer={
          <Footer
            strip={strip}
            error={stripError}
            busy={busy}
            saved={saved}
            editing={editing}
            touched={touched}
            onStrip={(s) => {
              setStrip(s)
              setStripError(null)
            }}
            onName={(name) => setStrip((s) => (s?.kind === 'name' ? { ...s, name } : s))}
            onSubmitName={() => void submitName()}
            onReset={() => {
              patch({})
              setStrip(null)
              setOpenSlot(null)
            }}
            onDelete={(p) => void remove(p)}
            onDone={() => setOpen(false)}
          />
        }
      >
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[var(--surface)] px-6 py-3">
          <div role="tablist" aria-label="Colors for" className="flex gap-1 rounded-lg surface-sunken p-1">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={editing === m}
                onClick={() => {
                  setEditing(m)
                  setOpenSlot(null)
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
          <p className="text-[12px] text-faint">
            {editing === resolved
              ? `You are in ${resolved} mode, so these show on the site now.`
              : `You are in ${resolved} mode. These show in the previews until you switch.`}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          {editing === 'dark' ? (
            <Group
              icon="moon"
              title="Background depth"
              blurb="How dark the pages, cards and panels go. Slide right for full black."
              onReset={depth ? () => resetGroup(['depth']) : undefined}
              preview={<DepthPreview picks={full} depth={depth} />}
            >
              <DepthSlider value={depth} onChange={(v) => patch({ ...picks, depth: v || undefined })} />
            </Group>
          ) : (
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
              <Icon name="moon" size={14} />
              Background depth, down to full black, is in Dark colors.
            </p>
          )}

          {GROUPS.map((g) => {
            const slots =
              g.id === 'banners' && style !== 'gradient' ? g.slots.filter((s) => s.key !== 'banner2') : g.slots
            const keys: (keyof Picks)[] = [
              ...g.slots.map((s) => s.key),
              ...(g.id === 'banners' ? (['bannerStyle'] as const) : []),
            ]
            const groupTouched = keys.some((k) => picks[k] !== undefined)
            return (
              <Group
                key={g.id}
                icon={g.icon}
                title={g.title}
                blurb={g.blurb}
                onReset={groupTouched ? () => resetGroup(keys) : undefined}
                preview={<GroupPreview id={g.id} mode={editing} picks={full} depth={depth} />}
              >
                {g.id === 'banners' && (
                  <div role="radiogroup" aria-label="Banner style" className="mb-3 grid grid-cols-3 gap-2">
                    {BANNER_STYLES.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        role="radio"
                        aria-checked={style === b.id}
                        onClick={() => patch({ ...picks, bannerStyle: b.id === 'glow' ? undefined : b.id })}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          style === b.id
                            ? 'border-navy-500 bg-navy-50 dark:border-navy-300 dark:bg-navy-500/15'
                            : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <span className="block text-[13px] font-medium text-ink">{b.label}</span>
                        <span className="block text-[11.5px] leading-snug text-faint">{b.note}</span>
                      </button>
                    ))}
                  </div>
                )}
                {g.id === 'banners' && !bannerReadable(picks, editing) && (
                  <p className="mb-3 flex gap-2 rounded-lg bg-warning-400/18 px-3 py-2 text-[12.5px] text-warning-700 dark:text-warning-300">
                    <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                    These two colors are too far apart for the banner text to read well on both ends.
                    Bring them closer, or pick Solid.
                  </p>
                )}
                <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
                  {slots.map((s) => (
                    <SlotRow
                      key={s.key}
                      slot={
                        s.key === 'banner' && style === 'gradient'
                          ? { ...s, label: 'Left color', note: 'Where the gradient starts.' }
                          : s
                      }
                      value={picks[s.key] ?? null}
                      fallback={DEFAULT_PICKS[editing][s.key]}
                      open={openSlot === s.key}
                      onToggle={() => setOpenSlot(openSlot === s.key ? null : s.key)}
                      onPick={(v) => setPick(s.key, v)}
                    />
                  ))}
                </ul>
              </Group>
            )
          })}

          <section className="pt-2">
            <h3>Palettes</h3>
            <p className="mt-1 text-[13px] text-muted">
              Applying one replaces both your light and dark colors. Save yours first to come back
              to it.
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                        { label: 'Rename', icon: 'edit', onSelect: () => setStrip({ kind: 'name', id: p.id, name: p.name }) },
                        {
                          label: 'Delete',
                          icon: 'trash',
                          tone: 'danger',
                          separated: true,
                          onSelect: () => setStrip({ kind: 'delete', palette: p }),
                        },
                      ]}
                    />
                  }
                />
              ))}
            </ul>
            {palettes && palettes.length === 0 && (
              <p className="mt-3 text-[12px] text-faint">Palettes you save show up here, up to 12.</p>
            )}
          </section>
        </div>
      </Modal>
    </div>
  )
}

/**
 * The editor's footer. Naming, resetting and deleting happen here in place,
 * not in a second dialog over the first.
 */
function Footer({
  strip,
  error,
  busy,
  saved,
  editing,
  touched,
  onStrip,
  onName,
  onSubmitName,
  onReset,
  onDelete,
  onDone,
}: {
  strip: Strip | null
  error: string | null
  busy: boolean
  saved: boolean
  editing: Mode
  touched: boolean
  onStrip: (s: Strip | null) => void
  onName: (name: string) => void
  onSubmitName: () => void
  onReset: () => void
  onDelete: (p: SavedPalette) => void
  onDone: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (strip?.kind === 'name') nameRef.current?.focus()
  }, [strip?.kind])

  if (strip?.kind === 'name') {
    return (
      <form
        className="flex w-full flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmitName()
        }}
      >
        <label className="text-[13px] font-medium text-ink" htmlFor="palette-name">
          {strip.id ? 'New name' : 'Palette name'}
        </label>
        <input
          ref={nameRef}
          id="palette-name"
          value={strip.name}
          maxLength={40}
          placeholder="Evening study"
          onChange={(e) => onName(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--control-line)] bg-[var(--surface)] px-3 text-[14px] text-ink"
        />
        {error && <span className="basis-full text-[12px] text-danger-600 dark:text-danger-400">{error}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={() => onStrip(null)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {strip.id ? 'Rename' : 'Save palette'}
        </Button>
      </form>
    )
  }

  if (strip?.kind === 'reset' || strip?.kind === 'delete') {
    const reset = strip.kind === 'reset'
    return (
      <div className="flex w-full flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-ink">
          {reset
            ? `Every ${editing} color you changed goes back to how Collabify ships. Save them as a palette first if you want them again.`
            : `Delete ${strip.palette.name}? The colors you are using now stay as they are.`}
          {error && <span className="block text-[12px] text-danger-600 dark:text-danger-400">{error}</span>}
        </p>
        <Button variant="ghost" size="sm" onClick={() => onStrip(null)}>
          Cancel
        </Button>
        <Button
          variant={reset ? 'primary' : 'danger'}
          size="sm"
          loading={busy}
          onClick={() => (reset ? onReset() : onDelete(strip.palette))}
        >
          {reset ? `Use default ${editing} colors` : 'Delete palette'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" disabled={!touched} onClick={() => onStrip({ kind: 'reset' })}>
        <Icon name="refresh" size={14} />
        Default {editing} colors
      </Button>
      <span className="ml-auto flex items-center gap-3">
        {saved && (
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-success-600 dark:text-success-400">
            <Icon name="check" size={14} strokeWidth={2.6} />
            Saved
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => onStrip({ kind: 'name', id: null, name: '' })}>
          <Icon name="plus" size={14} />
          Save as palette
        </Button>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </span>
    </div>
  )
}

function Group({
  icon,
  title,
  blurb,
  onReset,
  preview,
  children,
}: {
  icon: IconName
  title: string
  blurb: string
  onReset?: () => void
  preview: ReactNode
  children: ReactNode
}) {
  return (
    <section className="@container rounded-xl border border-line p-4">
      <header className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
          <Icon name={icon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3>{title}</h3>
          <p className="mt-0.5 text-[12.5px] text-muted">{blurb}</p>
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Reset
          </button>
        )}
      </header>
      <div className="mt-4 grid grid-cols-1 gap-4 @min-[620px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">{children}</div>
        <div className="min-w-0">{preview}</div>
      </div>
    </section>
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
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
      >
        <span aria-hidden className="h-7 w-7 shrink-0 rounded-lg border border-line-strong" style={{ background: shown }} />
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
          <div className="grid max-w-[360px] grid-cols-9 gap-1.5">
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

/** A level control, like a volume slider: navy on the left, black on the right. */
function DepthSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const from = groundFor('dark', 0).page
  const to = groundFor('dark', 100).page
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor="depth" className="text-[13px] font-medium text-ink">
          Depth
        </label>
        <span className="font-mono text-[13px] text-muted">{value === 0 ? 'Default' : `${value}%`}</span>
      </div>
      <input
        id="depth"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={value === 0 ? 'Default navy' : value === 100 ? 'Full black' : `${value} percent toward black`}
        className="level-range mt-3 w-full"
        style={{ '--level-from': from, '--level-to': to } as CSSProperties}
      />
      <div className="mt-1.5 flex justify-between text-[11.5px] text-faint">
        <span>Navy</span>
        <span>Black</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        {[0, 50, 100].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
              value === v ? 'border-navy-500 text-ink dark:border-navy-300' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {v === 0 ? 'Default' : v === 50 ? 'Deeper' : 'Full black'}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- previews

/**
 * Sets every variable itself, from the defaults plus the picks, so a preview
 * can show dark while the site is light.
 */
function Frame({
  mode,
  picks,
  depth,
  label,
  children,
}: {
  mode: Mode
  picks: Picks
  depth: number
  label: string
  children: ReactNode
}) {
  const style = useMemo(
    () =>
      ({
        ...previewGround(mode, depth),
        '--btn-action': 'var(--banner-ink)',
        '--btn-danger': 'var(--banner-ink)',
        ...toCssVars(picks, mode),
      }) as CSSProperties,
    [mode, picks, depth],
  )
  return (
    <div
      style={style}
      role="img"
      aria-label={label}
      className="overflow-hidden rounded-xl border border-line bg-[var(--page)] p-3 text-[var(--ink)]"
    >
      {children}
    </div>
  )
}

function GroupPreview({ id, mode, picks, depth }: { id: GroupId; mode: Mode; picks: Picks; depth: number }) {
  const light = mode === 'light'
  const frame = (label: string, children: ReactNode) => (
    <Frame mode={mode} picks={picks} depth={depth} label={label}>
      {children}
    </Frame>
  )

  switch (id) {
    case 'banners':
      return frame(
        'Preview of a page banner',
        <div className="banner-fill relative overflow-hidden rounded-lg px-4 py-4 text-banner-ink">
          <span
            aria-hidden
            className="banner-deco absolute -top-10 -right-8 h-28 w-28 rounded-full bg-banner-glow/25 blur-2xl"
          />
          <span
            aria-hidden
            className="banner-deco absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                'linear-gradient(color-mix(in oklab, var(--banner-ink) 6%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 6%, transparent) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          />
          <p className="relative font-display text-[17px] font-semibold">
            Your <span className="text-banner-accent">projects.</span>
          </p>
          <p className="relative mt-0.5 text-[11.5px] text-banner-ink/60">Everything you are working on.</p>
          <span className="relative mt-3 inline-flex h-7 items-center rounded-md bg-btn-create px-2.5 text-[11px] font-medium text-btn-create-ink">
            New project
          </span>
        </div>,
      )
    case 'buttons':
      return frame(
        'Preview of the buttons on a banner',
        <div className="banner-fill relative overflow-hidden rounded-lg px-4 py-4 text-banner-ink">
          <p className="relative font-display text-[15px] font-semibold">
            Capstone <span className="text-banner-accent">project.</span>
          </p>
          <div className="relative mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
            <span className="inline-flex h-7 items-center gap-1 rounded-md bg-btn-create px-2.5 text-btn-create-ink">
              <Icon name="plus" size={12} />
              New project
            </span>
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-btn-action/25 px-2.5 text-btn-action">
              <Icon name="chart" size={12} />
              Report
            </span>
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-btn-danger/25 px-2.5 text-btn-danger">
              <Icon name="archive" size={12} />
              Archive
            </span>
          </div>
        </div>,
      )
    case 'status':
      return frame(
        'Preview of status highlights',
        <div className="space-y-2">
          <div className="rounded-lg border border-warning-400/60 bg-[var(--surface)] p-2.5">
            <p className="text-[12px] font-semibold">Database design</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <span
                className={`rounded-full bg-success-500/15 px-1.5 py-0.5 text-[10.5px] font-medium ${light ? 'text-success-700' : 'text-success-300'}`}
              >
                Done
              </span>
              <span
                className={`rounded-full bg-warning-400/18 px-1.5 py-0.5 text-[10.5px] font-medium ${light ? 'text-warning-700' : 'text-warning-300'}`}
              >
                In progress
              </span>
              <span
                className={`rounded-full bg-danger-500/15 px-1.5 py-0.5 text-[10.5px] font-medium ${light ? 'text-danger-700' : 'text-danger-300'}`}
              >
                Late
              </span>
              <span className="rounded-full bg-pending-soft px-1.5 py-0.5 text-[10.5px] font-medium text-pending-ink">
                Pending
              </span>
            </div>
          </div>
          <div
            className={`flex items-center justify-between rounded-lg border bg-[var(--surface)] px-2.5 py-2 text-[11.5px] ${light ? 'border-danger-300' : 'border-danger-500/40'}`}
          >
            <span>ERD draft</span>
            <span className={light ? 'text-danger-700' : 'text-danger-300'}>2 days late</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <span className="w-2/5 bg-success-500" />
            <span className="w-1/4 bg-warning-400" />
            <span className="w-1/6 bg-danger-500" />
          </div>
        </div>,
      )
    case 'sidebar':
      return frame(
        'Preview of the sidebar',
        <div className="space-y-0.5 rounded-lg bg-[var(--surface)] p-2 text-[12px] text-[var(--ink-muted)]">
          <span className="relative flex items-center gap-2 rounded-md bg-[var(--surface-sunken)] px-2.5 py-1.5 font-semibold text-[var(--ink)]">
            <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-nav-marker" />
            <Icon name="kanban" size={14} className="text-nav-active" />
            Class projects
          </span>
          <span className="flex items-center gap-2 px-2.5 py-1.5">
            <Icon name="calendar" size={14} className="text-nav-icon" />
            Calendar
          </span>
          <span className="flex items-center gap-2 px-2.5 py-1.5">
            <Icon name="users" size={14} className="text-nav-icon" />
            Groups
          </span>
          <span className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="grid h-4 w-4 place-items-center rounded bg-nav-active font-mono text-[9px] font-bold text-nav-active-ink">
              Q
            </span>
            Quantitative Methods
          </span>
        </div>,
      )
    case 'progress':
      return frame(
        'Preview of progress bars',
        <div className="space-y-3 rounded-lg bg-[var(--surface)] p-3">
          {[
            ['Capstone 2', '80%', 'w-4/5'],
            ['Lab 6', '45%', 'w-[45%]'],
            ['Group 1', '20%', 'w-1/5'],
          ].map(([name, pct, w]) => (
            <div key={name}>
              <div className="flex justify-between text-[11.5px]">
                <span>{name}</span>
                <span className="font-mono text-[var(--ink-muted)]">{pct}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                <span className={`block h-full rounded-full bg-progress ${w}`} />
              </div>
            </div>
          ))}
        </div>,
      )
    case 'badges':
      return frame(
        'Preview of notification badges',
        <div className="space-y-2 rounded-lg bg-[var(--surface)] p-3 text-[12px]">
          <div className="flex items-center gap-3">
            <span className="relative grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--ink-muted)]">
              <Icon name="bell" size={17} />
              <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-badge px-1 font-mono text-[10px] font-bold text-badge-ink">
                3
              </span>
            </span>
            <span className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[var(--ink-muted)]">
              <Icon name="message" size={14} />
              <span className="flex-1">Inbox</span>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-badge px-1.5 font-mono text-[10px] font-bold text-badge-ink">
                12
              </span>
            </span>
          </div>
          <div className="flex items-start gap-2 rounded-md bg-[var(--surface-sunken)] px-2.5 py-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-badge" />
            <span>
              <span className="font-medium">Lab 6</span> was handed back with comments.
            </span>
          </div>
        </div>,
      )
    case 'icons':
      return frame(
        'Preview of project icons',
        <div className="grid grid-cols-2 gap-2">
          {[
            { icon: 'kanban' as IconName, name: 'Lab 6', meta: 'Class project' },
            { icon: null, name: 'Capstone 2', meta: 'Work project' },
          ].map((c) => (
            <div key={c.name} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-icon-tile font-display text-[12px] font-bold text-icon-glyph">
                {c.icon ? <Icon name={c.icon} size={16} /> : 'C2'}
              </span>
              <p className="mt-2 truncate text-[12px] font-semibold">{c.name}</p>
              <p className="truncate text-[10.5px] text-[var(--ink-faint)]">{c.meta}</p>
            </div>
          ))}
        </div>,
      )
  }
}

function DepthPreview({ picks, depth }: { picks: Picks; depth: number }) {
  return (
    <Frame mode="dark" picks={picks} depth={depth} label="Preview of dark mode's background depth">
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
        <div className="space-y-1 rounded-lg bg-[var(--surface)] p-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`block h-2.5 rounded ${i === 0 ? 'bg-[var(--surface-sunken)]' : 'bg-[var(--line)]'}`}
            />
          ))}
        </div>
        <div className="space-y-2">
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5">
            <p className="text-[12px] font-semibold">Database design</p>
            <p className="text-[10.5px] text-[var(--ink-muted)]">Due Friday</p>
            <span className="mt-2 block h-1.5 rounded-full bg-[var(--surface-sunken)]" />
          </div>
          <div className="rounded-lg bg-[var(--surface-sunken)] px-2.5 py-2 text-[10.5px] text-[var(--ink-muted)]">
            A sunken panel
          </div>
        </div>
      </div>
    </Frame>
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
  const chips: PickKey[] = ['banner', 'bannerAccent', 'success', 'warning', 'danger', 'progress', 'iconTile']
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
