import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { FileDrop } from '../ui/FileDrop'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import {
  deleteGroupFile,
  groupDriveUsage,
  listGroupFiles,
  uploadGroupFile,
} from '../../lib/api/groupDrive'
import { fileUrl } from '../../lib/api/files'
import { authErrorMessage } from '../../lib/authError'
import { formatBytes } from '../../lib/types'
import type { GroupFile, Role } from '../../lib/types'

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Where a group keeps work that is not a deliverable yet — a draft, the raw
 * data, the thing two members are still arguing about.
 *
 * Attaching one to a task moves it out, so this list is always and only "not
 * handed in". The professor reads it and cannot touch it: seeing that a quiet
 * group has been working is worth a lot, deleting somebody's draft is worth
 * nothing.
 */
export function GroupDrive({
  groupId,
  role,
  /** False for a professor, and for anyone not in this group. */
  canManage,
}: {
  groupId: string
  role: Role
  canManage: boolean
}) {
  const { show } = useToast()
  const [files, setFiles] = useState<GroupFile[] | null>(null)
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null)
  const [staged, setStaged] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<GroupFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [rows, use] = await Promise.all([
        listGroupFiles(groupId),
        groupDriveUsage(groupId),
      ])
      setFiles(rows)
      setUsage(use)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the group files.'))
      setFiles([])
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(file: File | null) {
    if (!file) return
    setBusy(true)
    try {
      await uploadGroupFile(groupId, file)
      show('Added to the group files')
      setStaged(null)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'Could not add that file.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function open(f: GroupFile) {
    try {
      window.open(await fileUrl('group-files', f.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  if (files === null) {
    return (
      <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading group files…
      </div>
    )
  }

  const pct = usage && usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-muted">
        {canManage
          ? 'Drafts and working files the whole group can reach. Attaching one to a task moves it out of here, so what is left is always the work you have not handed in.'
          : 'What this group is working on but has not handed in. Attaching a file to a task moves it out of this list.'}
      </p>

      {usage && (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full surface-sunken">
            <span
              className={`block h-full rounded-full transition-[width] duration-300 ${
                pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-400' : 'bg-navy-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="font-mono text-[11.5px] text-faint">
            {formatBytes(usage.used)} of {formatBytes(usage.limit)} used
          </p>
        </div>
      )}

      {files.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
          {canManage
            ? 'Nothing here yet. Put a draft in and the rest of the group can pick it up.'
            : 'This group has not put anything here yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="surface flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5"
            >
              <button
                type="button"
                onClick={() => void open(f)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
                  <Icon name="file" size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] text-ink">{f.file_name}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {f.uploaded_by_name ?? 'Someone'} · {when(f.created_at)}
                  </span>
                </span>
              </button>
              <span className="shrink-0 font-mono text-[11.5px] text-faint">
                {formatBytes(f.size_bytes)}
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setRemoving(f)}
                  aria-label={`Remove ${f.file_name}`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="space-y-2">
          <FileDrop
            file={staged}
            onPick={(f) => void upload(f)}
            maxSize={25}
            hint="Up to 25 MB each"
          />
          {busy && (
            <p className="flex items-center gap-2 text-[12.5px] text-muted">
              <Spinner size={13} />
              Adding…
            </p>
          )}
        </div>
      )}

      {role === 'professor' && files.length > 0 && (
        <p className="text-[12px] text-faint">
          These are drafts, not submissions. Only the group can remove them.
        </p>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteGroupFile(removing)
          await load()
        }}
        title="Remove this file?"
        confirmLabel="Remove"
        body={
          <p>
            {removing?.file_name} goes for everyone in the group. Anything already attached
            to a task is not affected.
          </p>
        }
      />
    </div>
  )
}
