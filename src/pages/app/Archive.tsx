import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { Alert } from '../../components/ui/Alert'
import { Button, ButtonLink } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Field'
import { FilterPopover } from '../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { ScopeFilter } from '../../components/ui/ScopeFilter'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { membershipOf } from '../../lib/access'
import { listMyArchive, restoreArchiveItem, trashArchiveItem } from '../../lib/api/archive'
import {
  ARCHIVE_SECTIONS,
  archiveKindsFor,
  areasOf,
  filterArchive,
  hrefOf,
  openLabelOf,
  readKinds,
  sectionOf,
  whereOf,
} from '../../lib/archive'
import type { ArchiveArea, ArchiveItem, ArchiveKind, ArchivedBy, ArchiveSort } from '../../lib/archive'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { paths } from '../../lib/paths'
import { readScope, writeScope } from '../../lib/scope'

const ICONS: Record<ArchiveKind, IconName> = {
  class: 'folder',
  group: 'users',
  class_project: 'kanban',
  class_task: 'check',
  class_file: 'file',
  syllabus: 'file',
  curriculum: 'target',
  space: 'board',
  team: 'users',
  project: 'kanban',
  work_task: 'check',
  work_file: 'file',
}

const AREA_LABEL: Record<ArchiveArea, string> = { classes: 'Classes', work: 'Work' }

const BY_OPTIONS: { value: ArchivedBy; label: string }[] = [
  { value: 'anyone', label: 'Anyone' },
  { value: 'me', label: 'You' },
  { value: 'others', label: 'Someone else' },
]

const SORT_OPTIONS: { value: ArchiveSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name' },
]

const keyOf = (item: ArchiveItem) => `${item.kind}:${item.id}`

/** What else goes to Trash with it, said before it goes. */
function trashBody(item: ArchiveItem) {
  const tail = 'It waits in your Trash for 30 days, then it is deleted for good. Nobody else sees it there.'
  switch (item.kind) {
    case 'class':
      return `${item.name} goes with its roster, announcements, groups and every project, board, task and file in it. ${tail}`
    case 'space':
      return `${item.name} goes with every project, task and file in it. ${tail}`
    case 'project':
      return `${item.name} goes with its tasks, files and history. ${tail}`
    case 'class_project':
      return `${item.name} goes with every group's board, tasks and submissions for it. ${tail}`
    case 'group':
      return `${item.name} goes with its board and chat, which hold nothing yet. ${tail}`
    case 'team':
      return `${item.name} goes. Projects it worked on keep their work. ${tail}`
    case 'syllabus':
      return `Classes using ${item.name} keep it until it is deleted. ${tail}`
    default:
      return tail
  }
}

/** Where a restored item turns up, for the toast. */
function restoredTo(item: ArchiveItem) {
  switch (item.kind) {
    case 'class':
      return `${item.name} is back in your classes.`
    case 'space':
      return `${item.name} is back in Spaces.`
    case 'class_file':
    case 'work_file':
      return item.file_source === 'draft' ? `${item.name} is back in your draft.` : `${item.name} is back on ${item.detail ?? 'its task'}.`
    default:
      return `${item.name} is back in ${whereOf(item)}.`
  }
}

/**
 * Everything the reader put away, or may act on in an archive, in one place.
 *
 * Which sections show follows what the reader can do, not what happens to be
 * in the list: faculty who do not teach get no class sections, a student with
 * no work gets no work sections. An empty section stays, with a line on where
 * that kind is archived from, so the page doubles as the list of what can be.
 *
 * Restore puts an item back where it was, through that item's own archive
 * call. Move to trash is the step before deleting: the item waits 30 days in
 * the reader's Trash, and the database refuses it to anyone who could not
 * delete it for good.
 */
export default function Archive() {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigation = useGeneralNavigation()
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<ArchiveItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ArchiveItem | null>(null)
  const [trashing, setTrashing] = useState<ArchiveItem | null>(null)

  const membership = useMemo(
    () => membershipOf(navigation.spaces, navigation.myProjects),
    [navigation.spaces, navigation.myProjects],
  )
  const allowed = useMemo(() => archiveKindsFor(profile, membership), [profile, membership])
  const areas = areasOf(allowed)
  const bothAreas = areas.length === 2

  const area = bothAreas ? readScope(params) : 'all'
  const typeParam = params.get('type')
  const kinds = useMemo(() => readKinds(typeParam).filter((k) => allowed.includes(k)), [typeParam, allowed])
  const by = (BY_OPTIONS.some((o) => o.value === params.get('by')) ? params.get('by') : 'anyone') as ArchivedBy
  const sort = (SORT_OPTIONS.some((o) => o.value === params.get('sort')) ? params.get('sort') : 'newest') as ArchiveSort
  const query = params.get('q') ?? ''

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const load = useCallback(async () => {
    try {
      setItems(await listMyArchive())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your archive. Reload to try again.'))
      setItems([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Archive · Collabify'
    void load()
  }, [load])

  const shown = useMemo(
    () => filterArchive(items ?? [], allowed, { area, kinds, by, query, sort }, profile?.id),
    [items, allowed, area, kinds, by, query, sort, profile?.id],
  )
  const mineOnly = useMemo(() => (items ?? []).filter((i) => allowed.includes(i.kind)), [items, allowed])
  const countOf = (kind: ArchiveKind) => mineOnly.filter((i) => i.kind === kind).length
  const narrowed = query.trim() !== '' || by !== 'anyone'

  // Sections on the page: every kind the reader has, in the chosen area and
  // type; while searching or filtering by who, only the ones with a match.
  const sections = ARCHIVE_SECTIONS.filter(
    (s) =>
      allowed.includes(s.kind) &&
      (area === 'all' || s.area === area) &&
      (kinds.length === 0 || kinds.includes(s.kind)) &&
      (!narrowed || shown.some((i) => i.kind === s.kind)),
  )

  async function restore(item: ArchiveItem) {
    setBusy(keyOf(item))
    try {
      await restoreArchiveItem(item)
      show(restoredTo(item))
      await Promise.all([load(), navigation.reload()])
    } catch (err) {
      show(authErrorMessage(err, `Could not restore ${item.name}. Reload and try again.`), 'error')
    } finally {
      setBusy(null)
    }
  }

  const activeFilters = (by !== 'anyone' ? 1 : 0) + (sort !== 'newest' ? 1 : 0)
  const summary = [
    by !== 'anyone' && `Archived by ${BY_OPTIONS.find((o) => o.value === by)!.label.toLowerCase()}`,
    sort !== 'newest' && SORT_OPTIONS.find((o) => o.value === sort)!.label,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Your"
        accent="archive."
        description="What you put away stays here, readable, until you bring it back. Restore puts it where it was. Move to trash starts a 30-day countdown to deleting it."
        action={
          <ButtonLink variant="onNavy" to={paths.trash}>
            <Icon name="trash" size={14} />
            Open Trash
          </ButtonLink>
        }
      />

      {error && (
        <Alert tone="error" onRetry={() => void load()}>
          {error}
        </Alert>
      )}

      {allowed.length === 0 ? (
        <EmptyState
          icon="archive"
          title="Nothing to archive yet"
          body="Once you are in a class or a work space, what you archive there collects here."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
          <SectionRail
            allowed={allowed}
            areas={areas}
            area={area}
            kinds={kinds}
            countOf={countOf}
            total={mineOnly.length}
            loading={items === null}
            onPick={(kind) => setParam('type', kind)}
          />

          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 basis-64">
                <Input
                  icon="search"
                  value={query}
                  onChange={(e) => setParam('q', e.target.value || null)}
                  placeholder="Search your archive"
                  aria-label="Search your archive"
                />
              </div>
              {bothAreas && (
                <ScopeFilter
                  value={area}
                  onChange={(next) => {
                    const out = writeScope(params, next)
                    // A type from the other area would leave the page empty.
                    out.delete('type')
                    setParams(out, { replace: true })
                  }}
                  counts={
                    items
                      ? {
                          all: mineOnly.length,
                          classes: mineOnly.filter((i) => i.area === 'classes').length,
                          work: mineOnly.filter((i) => i.area === 'work').length,
                        }
                      : undefined
                  }
                />
              )}
              <FilterPopover
                active={activeFilters}
                summary={summary}
                align="right"
                onClear={() => {
                  const next = new URLSearchParams(params)
                  next.delete('by')
                  next.delete('sort')
                  setParams(next, { replace: true })
                }}
              >
                <Choice
                  legend="Archived by"
                  options={BY_OPTIONS}
                  value={by}
                  onChange={(v) => setParam('by', v === 'anyone' ? null : v)}
                />
                <Choice
                  legend="Sort"
                  options={SORT_OPTIONS}
                  value={sort}
                  onChange={(v) => setParam('sort', v === 'newest' ? null : v)}
                />
              </FilterPopover>
            </div>

            {items === null ? (
              <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
                <Spinner size={16} />
                Loading your archive…
              </div>
            ) : sections.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matches"
                body={
                  query.trim()
                    ? `Nothing in your archive matches “${query.trim()}”. Try another word, or clear the filters.`
                    : 'Nothing in your archive matches these filters. Clear them to see everything.'
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              (['classes', 'work'] as const).map((a) => {
                const inArea = sections.filter((s) => s.area === a)
                if (inArea.length === 0) return null
                return (
                  <div key={a} className="space-y-3">
                    {(bothAreas && area === 'all') && <p className="eyebrow text-faint">{AREA_LABEL[a]}</p>}
                    {inArea.map((section) => (
                      <SectionCard
                        key={section.kind}
                        kind={section.kind}
                        rows={shown.filter((i) => i.kind === section.kind)}
                        busy={busy}
                        onView={setViewing}
                        onRestore={(item) => void restore(item)}
                        onTrash={setTrashing}
                      />
                    ))}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <DetailsDialog
        item={viewing}
        busy={viewing !== null && busy === keyOf(viewing)}
        onClose={() => setViewing(null)}
        onRestore={(item) => {
          setViewing(null)
          void restore(item)
        }}
        onTrash={(item) => {
          setViewing(null)
          setTrashing(item)
        }}
      />

      <ConfirmDialog
        open={trashing !== null}
        onClose={() => setTrashing(null)}
        onConfirm={async () => {
          if (!trashing) return
          try {
            await trashArchiveItem(trashing)
          } catch (err) {
            await load()
            throw new Error(authErrorMessage(err, `Could not move ${trashing.name} to Trash.`), { cause: err })
          }
          show(`${trashing.name} moved to Trash`)
          await Promise.all([load(), navigation.reload()])
        }}
        title={`Move ${trashing?.name ?? 'this'} to Trash?`}
        body={trashing ? trashBody(trashing) : ''}
        confirmLabel="Move to trash"
        tone="danger"
      />
    </div>
  )
}

/** The sections down the side on a desktop, a scrolling strip above the list on a phone. */
function SectionRail({
  allowed,
  areas,
  area,
  kinds,
  countOf,
  total,
  loading,
  onPick,
}: {
  allowed: ArchiveKind[]
  areas: ArchiveArea[]
  area: 'all' | ArchiveArea
  kinds: ArchiveKind[]
  countOf: (kind: ArchiveKind) => number
  total: number
  loading: boolean
  onPick: (kind: ArchiveKind | null) => void
}) {
  const picked = kinds.length === 1 ? kinds[0] : null
  const visibleAreas = areas.filter((a) => area === 'all' || a === area)

  return (
    <nav
      aria-label="Archive sections"
      className="surface rounded-panel border border-line p-2 max-lg:-mx-1 max-lg:overflow-x-auto lg:sticky lg:top-4"
    >
      <ul className="flex gap-1 lg:flex-col">
        <li>
          <RailButton
            label="All sections"
            icon="archive"
            count={loading ? null : total}
            active={picked === null}
            onClick={() => onPick(null)}
          />
        </li>
        {visibleAreas.map((a) => (
          <li key={a} className="contents lg:block">
            {areas.length > 1 && (
              <p className="eyebrow px-3 pt-3 pb-1 text-faint max-lg:hidden">{AREA_LABEL[a]}</p>
            )}
            <ul className="contents lg:flex lg:flex-col lg:gap-0.5">
              {ARCHIVE_SECTIONS.filter((s) => s.area === a && allowed.includes(s.kind)).map((s) => (
                <li key={s.kind}>
                  <RailButton
                    label={s.label}
                    icon={ICONS[s.kind]}
                    count={loading ? null : countOf(s.kind)}
                    active={picked === s.kind}
                    onClick={() => onPick(picked === s.kind ? null : s.kind)}
                  />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function RailButton({
  label,
  icon,
  count,
  active,
  onClick,
}: {
  label: string
  icon: IconName
  count: number | null
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] whitespace-nowrap transition-colors duration-150 ${
        active ? 'surface-sunken font-medium text-ink' : 'text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
      }`}
    >
      <Icon name={icon} size={15} className={active ? 'text-nav-icon' : 'text-faint'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== null && <span className="font-mono text-[12px] text-faint">{count}</span>}
    </button>
  )
}

function Choice<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="eyebrow text-faint">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors duration-150 ${
              value === o.value
                ? 'border-navy-400 bg-navy-500/10 font-medium text-ink'
                : 'border-line text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function SectionCard({
  kind,
  rows,
  busy,
  onView,
  onRestore,
  onTrash,
}: {
  kind: ArchiveKind
  rows: ArchiveItem[]
  busy: string | null
  onView: (item: ArchiveItem) => void
  onRestore: (item: ArchiveItem) => void
  onTrash: (item: ArchiveItem) => void
}) {
  const section = sectionOf(kind)
  return (
    <section aria-labelledby={`archive-${kind}`} className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-icon-tile text-icon-glyph">
          <Icon name={ICONS[kind]} size={15} />
        </span>
        <h2 id={`archive-${kind}`} className="font-display text-[15px] font-semibold text-ink">
          {section.label}
        </h2>
        <span className="font-mono text-[12px] text-faint">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="flex items-start gap-2 px-4 py-4 text-[13px] text-muted sm:px-5">
          <Icon name="info" size={14} className="mt-0.5 shrink-0 text-faint" />
          <span>
            Nothing archived. {section.hint}
          </span>
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((item) => (
            <ArchiveRow
              key={keyOf(item)}
              item={item}
              busy={busy === keyOf(item)}
              onView={() => onView(item)}
              onRestore={() => onRestore(item)}
              onTrash={() => onTrash(item)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchiveRow({
  item,
  busy,
  onView,
  onRestore,
  onTrash,
}: {
  item: ArchiveItem
  busy: boolean
  onView: () => void
  onRestore: () => void
  onTrash: () => void
}) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const by = item.archived_by
    ? item.archived_by === profile?.id
      ? 'you'
      : item.archived_by_name
    : null
  const sub = [item.detail, item.path && item.path !== item.name ? item.path : null].filter(Boolean).join(' · ')

  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_9.5rem] md:items-center lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_10rem_9.5rem]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
          <Icon name={ICONS[item.kind]} size={16} />
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={onView}
            className="block max-w-full truncate text-left font-medium text-ink hover:underline"
            title={item.path ?? item.name}
          >
            {item.name}
          </button>
          {sub && <p className="mt-0.5 truncate text-[12px] text-muted">{sub}</p>}
        </div>
      </div>

      {/* One cell from tablet width, two once there is room for both. */}
      <div className="min-w-0 space-y-1 max-md:pl-12 lg:contents">
        <div className="min-w-0 text-[13px]">
          <Link to={hrefOf(item)} className="block truncate text-ink hover:underline">
            {whereOf(item)}
          </Link>
        </div>
        <p className="text-[12px] text-muted">
          {formatDue(item.archived_at)}
          {by && (
            <span className="text-faint">
              <span className="lg:hidden"> · </span>
              <span className="lg:block lg:truncate">by {by}</span>
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 max-md:pl-12 md:justify-end">
        {item.restore_block ? (
          <span className="px-2 text-[12px] text-faint" title={item.restore_block}>
            View only
          </span>
        ) : (
          <Button size="sm" variant="ghost" loading={busy} onClick={onRestore}>
            <Icon name="refresh" size={14} />
            Restore
          </Button>
        )}
        <ActionMenu
          label={`Actions for ${item.name}`}
          disabled={busy}
          items={[
            { label: 'View details', icon: 'eye', onSelect: onView },
            { label: openLabelOf(item), icon: 'arrowRight', onSelect: () => navigate(hrefOf(item)) },
            {
              label: 'Move to trash',
              icon: 'trash',
              tone: 'danger',
              disabled: Boolean(item.trash_block),
              separated: true,
              onSelect: onTrash,
            },
          ]}
        />
      </div>
    </li>
  )
}

function DetailsDialog({
  item,
  busy,
  onClose,
  onRestore,
  onTrash,
}: {
  item: ArchiveItem | null
  busy: boolean
  onClose: () => void
  onRestore: (item: ArchiveItem) => void
  onTrash: (item: ArchiveItem) => void
}) {
  const { profile } = useAuth()
  const section = item ? sectionOf(item.kind) : null
  const rows: [string, string | null][] = item
    ? [
        ['Type', section!.noun.charAt(0).toUpperCase() + section!.noun.slice(1)],
        ['Where', whereOf(item)],
        [item.kind === 'work_file' && item.file_source === 'task' ? 'Task' : 'Detail', item.detail],
        ['Path', item.path && item.path !== item.name ? item.path : null],
        ['Archived', formatDue(item.archived_at)],
        [
          'Archived by',
          item.archived_by ? (item.archived_by === profile?.id ? 'You' : item.archived_by_name) : null,
        ],
      ]
    : []

  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={item?.name ?? ''}
      description={section ? `Archived ${section.noun}` : undefined}
      footer={
        item && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ButtonLink variant="outline" size="sm" to={hrefOf(item)}>
              {openLabelOf(item)}
              <Icon name="arrowRight" size={14} />
            </ButtonLink>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={Boolean(item.trash_block)}
                onClick={() => onTrash(item)}
              >
                <Icon name="trash" size={14} />
                Move to trash
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={Boolean(item.restore_block)}
                onClick={() => onRestore(item)}
              >
                <Icon name="refresh" size={14} />
                Restore
              </Button>
            </div>
          </div>
        )
      }
    >
      {item && (
        <div className="space-y-4">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 break-words text-ink">{v}</dd>
                </div>
              ))}
          </dl>
          {(item.restore_block || item.trash_block) && (
            <div className="space-y-1.5 rounded-lg surface-sunken px-3.5 py-3 text-[13px] text-muted">
              {item.restore_block && <p>Restore: {item.restore_block}</p>}
              {item.trash_block && <p>Move to trash: {item.trash_block}</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
