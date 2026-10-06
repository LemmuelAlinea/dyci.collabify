import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Field'
import { formatBytes } from '../../lib/formatBytes'
import { Icon, Spinner } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { deleteTrashItem, emptyMyTrash, isArchivedTrashKind, listMyTrash, restoreTrashItem } from '../../lib/api/trash'
import type { TrashItem } from '../../lib/api/trash'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { paths } from '../../lib/paths'

const DAY = 24 * 60 * 60 * 1000

const keyOf = (item: TrashItem) => (item.kind === 'draft' ? `d:${item.repo_id}:${item.root}` : `t:${item.id}`)

/** What the kinds put in Trash from the Archive page are called, and their icons. */
const ARCHIVED_LABEL: Record<string, [string, IconName]> = {
  class: ['Class', 'folder'],
  group: ['Group', 'users'],
  class_project: ['Class project', 'kanban'],
  class_task: ['Class task', 'check'],
  space: ['Space', 'board'],
  team: ['Space team', 'users'],
  project: ['Work project', 'kanban'],
  work_task: ['Work task', 'check'],
}

/** Where the item lived, as a link that opens that place. */
function homeOf(item: TrashItem) {
  switch (item.kind) {
    case 'class':
      return paths.classes
    case 'group':
    case 'class_project':
      return item.place_id ? paths.class(item.place_id) : paths.classes
    case 'class_task':
      return item.place_id ? paths.classProject(item.place_id) : paths.classProjects
    case 'space':
      return paths.spaces
    case 'team':
      return item.place_id ? paths.spaceTeams(item.place_id) : paths.spaces
    case 'project':
      return item.place_id ? paths.space(item.place_id) : paths.projects
    case 'work_task':
      return item.project_id ? paths.project(item.project_id) : paths.projects
  }
  if (item.kind === 'resource') return item.resource_kind === 'curriculum' ? paths.curriculum : paths.syllabi
  if (!item.project_id) return paths.home
  const base = item.class_project_id ? paths.classProject(item.class_project_id) : paths.project(item.project_id)
  return item.kind === 'draft'
    ? `${base}?tab=files&view=draft`
    : item.kind === 'discussion'
      ? `${base}?tab=discussion`
      : `${base}?tab=work`
}

function daysLeft(item: TrashItem) {
  return Math.max(0, Math.ceil((new Date(item.purge_at).getTime() - Date.now()) / DAY))
}

/**
 * Everything the reader threw away, across every project, for 30 days.
 *
 * Archive and Trash look alike and mean different things. Archive keeps a file
 * inside its project, out of the way, for anybody who can read that archive.
 * Trash is on its way out: it belongs to whoever trashed it, sits here, and is
 * deleted for good once its 30 days are up.
 */
export default function Trash() {
  const { show } = useToast()
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<TrashItem | null>(null)
  const [emptying, setEmptying] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems(await listMyTrash())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your Trash.'))
      setItems([])
    }
  }, [])

  useEffect(() => {
    document.title = 'Trash · Collabify'
    void load()
  }, [load])

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (i) => !q || `${i.name} ${i.root ?? ''} ${i.project_name} ${i.task_title ?? ''}`.toLowerCase().includes(q),
      ),
    [items, q],
  )
  const actionable = (items ?? []).filter((i) => !i.frozen)
  const totalBytes = (items ?? []).reduce((sum, i) => sum + Number(i.size_bytes ?? 0), 0)

  async function restore(item: TrashItem) {
    setBusy(keyOf(item))
    try {
      await restoreTrashItem(item)
      show(
        isArchivedTrashKind(item.kind)
          ? `${item.name} is back in your Archive.`
          : item.kind === 'draft'
          ? `${item.name} is back in your draft.`
          : item.kind === 'resource'
            ? `${item.name} is back in ${item.project_name}.`
            : item.kind === 'discussion'
              ? `${item.name} is back in ${item.project_name}'s discussions.`
              : `${item.name} is back on ${item.task_title ?? 'its task'}.`,
      )
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not restore it.'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="w-full space-y-6">
      <DirectoryHero
        title="Your"
        accent="trash."
        description="What you moved to Trash waits here for 30 days, then goes for good. To keep something out of the way without losing it, archive it instead."
        action={
          actionable.length > 0 ? (
            <Button variant="danger" onClick={() => setEmptying(true)}>
              <Icon name="trash" size={14} />
              Empty trash
            </Button>
          ) : undefined
        }
      />

      {error && <Alert tone="error">{error}</Alert>}

      {items === null ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your Trash…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="trash"
          art="trash"
          title="Trash is empty"
          body="When you move a file, folder, discussion, syllabus or curriculum to Trash, or anything from your Archive, it waits here for 30 days before it is deleted."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              icon="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Trash"
              className="max-w-md"
            />
            <p className="font-mono text-[12px] text-muted">
              {items.length} {items.length === 1 ? 'item' : 'items'} · {formatBytes(totalBytes)}
            </p>
          </div>

          <section className="overflow-hidden rounded-panel border border-line surface">
            <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_9rem_6.5rem_9.5rem] gap-4 border-b border-line bg-[var(--surface-sunken)] px-5 py-2.5 lg:grid">
              {['Name', 'From', 'Moved to Trash', 'Deleted in', ''].map((h) => (
                <span key={h} className="eyebrow text-faint">
                  {h}
                </span>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted">Nothing in Trash matches “{query.trim()}”.</p>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map((item) => (
                  <TrashRow
                    key={keyOf(item)}
                    item={item}
                    busy={busy === keyOf(item)}
                    onRestore={() => void restore(item)}
                    onDelete={() => setDeleting(item)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteTrashItem(deleting)
          show(`${deleting.name} deleted`)
          await load()
        }}
        title={
          deleting && isArchivedTrashKind(deleting.kind)
            ? `Delete ${deleting.name} for good?`
            : `Delete this ${deleting?.is_folder ? 'folder' : 'file'} for good?`
        }
        body={
          deleting && isArchivedTrashKind(deleting.kind)
            ? `${deleting.name} and everything in it cannot be brought back.`
            : deleting?.is_folder
            ? `${deleting.name}${deleting.file_count === 0 ? '' : ` and the ${deleting.file_count === 1 ? 'file' : `${deleting.file_count} files`} in it`} cannot be brought back.`
            : deleting?.kind === 'resource'
              ? `${deleting.name} cannot be brought back. Classes using it lose the link${deleting.resource_kind === 'syllabus' ? ', and its week map goes with it' : ''}.`
              : deleting?.kind === 'discussion'
                ? `${deleting.name} and every message in it cannot be brought back, for anyone in the group.`
                : `${deleting?.name ?? 'It'} cannot be brought back.`
        }
        confirmLabel="Delete for good"
        tone="danger"
      />

      <ConfirmDialog
        open={emptying}
        onClose={() => setEmptying(false)}
        onConfirm={async () => {
          const n = await emptyMyTrash()
          show(n === 1 ? '1 item deleted' : `${n} items deleted`)
          await load()
        }}
        title="Empty your Trash?"
        body={
          actionable.length === (items ?? []).length
            ? `Everything in it, ${actionable.length === 1 ? '1 item' : `${actionable.length} items`}, is deleted for good.`
            : `${actionable.length === 1 ? '1 item is' : `${actionable.length} items are`} deleted for good. Items from archived or handed-in projects stay until their 30 days are up.`
        }
        confirmLabel="Empty trash"
        tone="danger"
      />
    </div>
  )
}

function TrashRow({
  item,
  busy,
  onRestore,
  onDelete,
}: {
  item: TrashItem
  busy: boolean
  onRestore: () => void
  onDelete: () => void
}) {
  const left = daysLeft(item)
  const size = item.size_bytes ? formatBytes(Number(item.size_bytes)) : null
  const archived = isArchivedTrashKind(item.kind) ? ARCHIVED_LABEL[item.kind] : null
  const where = archived
    ? archived[0]
    : item.kind === 'draft'
      ? 'My draft'
      : item.kind === 'resource'
        ? item.resource_kind === 'curriculum'
          ? 'Curriculum file'
          : 'Syllabus file'
        : item.kind === 'discussion'
          ? 'Discussion'
          : `Task · ${item.task_title ?? 'Untitled'}`

  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_9rem_6.5rem_9.5rem] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
          <Icon name={archived ? archived[1] : item.is_folder ? 'folder' : 'file'} size={16} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink" title={item.root ?? item.name}>
            {item.name}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {archived
              ? 'Restoring puts it back in Archive'
              : !item.is_folder
              ? 'File'
              : item.file_count === 0
                ? 'Empty folder'
                : `Folder · ${item.file_count === 1 ? '1 file' : `${item.file_count} files`}`}
            {size ? ` · ${size}` : ''}
            {item.root && item.root !== item.name ? ` · ${item.root}` : ''}
          </p>
        </div>
      </div>

      <div className="min-w-0 text-[13px] max-lg:pl-12">
        <Link to={homeOf(item)} className="block truncate font-medium text-ink hover:underline">
          {item.project_name}
        </Link>
        <p className="truncate text-[12px] text-muted">{where}</p>
      </div>

      <p className="text-[13px] text-muted max-lg:hidden">{formatDue(item.trashed_at)}</p>

      <div className="max-lg:pl-12">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] ${
            left <= 3
              ? 'bg-amber-400/25 text-amber-800 dark:text-amber-200'
              : 'surface-sunken text-muted'
          }`}
        >
          {left === 0 ? 'Today' : left === 1 ? '1 day' : `${left} days`}
        </span>
      </div>

      <div className="flex items-center gap-2 max-lg:pl-12 lg:justify-end">
        {item.frozen ? (
          <span className="text-[12px] text-faint" title="The project is archived or handed in. Restore or reopen it first.">
            Project locked
          </span>
        ) : (
          <>
            <Button size="sm" variant="ghost" loading={busy} onClick={onRestore}>
              <Icon name="refresh" size={14} />
              Restore
            </Button>
            <ActionMenu
              label={`Actions for ${item.name}`}
              disabled={busy}
              items={[
                { label: 'Delete for good', icon: 'trash', tone: 'danger', onSelect: onDelete },
              ]}
            />
          </>
        )}
      </div>
    </li>
  )
}
