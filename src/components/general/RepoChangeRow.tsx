import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ActionMenu } from '../ui/ActionMenu'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import {
  addRepoComment,
  answerRepoChange,
  contentAt,
  deleteRepoComment,
  listRepoComments,
  projectFileUrl,
  withdrawRepoChange,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { countShown, extensionOf, fileName, fileText, shownFiles } from '../../lib/general/files'
import { CHANGE_LABEL, FILE_ACTION_LABEL } from '../../lib/general/types'
import type {
  GeneralRepoChange,
  GeneralRepoComment,
  GeneralRepoSummary,
  RepoFile,
} from '../../lib/general/types'
import { DiffView } from './DiffView'
import { PdfPreview } from './PdfPreview'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * One proposed change, with everything a reviewer needs in one place: what it
 * would do to each file, what people have said about it, and the two buttons.
 *
 * A change written against an older commit cannot be merged. It says so rather
 * than merging something over work that landed since.
 */
export function RepoChangeRow({
  change,
  repo,
  state,
  onDone,
}: {
  change: GeneralRepoChange
  repo: GeneralRepoSummary
  state: GeneralProjectState
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [open, setOpen] = useState(change.status === 'open')
  const [before, setBefore] = useState<Record<string, string | null> | null>(null)
  const [comments, setComments] = useState<GeneralRepoComment[]>([])
  const [body, setBody] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const mine = change.author_id === state.viewerId
  const assignedToMe = change.reviewer_id === state.viewerId
  const mayAnswer = !mine && change.status === 'open' && (
    change.reviewer_id ? assignedToMe : state.can('edit_files')
  )
  const stale = change.status === 'open' && change.base_seq !== repo.commit_count
  const { shown, folders } = useMemo(() => shownFiles(change.files), [change.files])

  const load = useCallback(async () => {
    if (!open) return
    const pairs = await Promise.all(
      shown.map(
        async (f) => [f.path, await contentAt(repo.id, f.path, change.base_seq)] as const,
      ),
    )
    setBefore(Object.fromEntries(pairs))
    setComments(await listRepoComments(change.id))
  }, [open, change.id, change.base_seq, shown, repo.id])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      show(done)
      await onDone()
      await load()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-line surface p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon
            name={open ? 'chevronDown' : 'chevronRight'}
            size={14}
            className="shrink-0 text-faint"
          />
          <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{change.title}</span>
        </button>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {CHANGE_LABEL[change.status]}
        </span>
        {mine && change.status === 'open' && !state.archived && (
          <ActionMenu
            label={`Actions for ${change.title}`}
            disabled={busy}
            items={[{ label: 'Withdraw request', icon: 'x', tone: 'danger', onSelect: () => setWithdrawing(true) }]}
          />
        )}
      </div>

      <p className="mt-1 pl-6 text-[12px] text-faint">
        {change.author_id ? state.nameOf(change.author_id) : 'A former member'} ·{' '}
        {countShown(shown.length, folders.length)}{' '}
        · against commit{' '}
        {change.base_seq} · {formatDue(change.created_at)}
        {change.reviewer_id ? ` · reviewer: ${state.nameOf(change.reviewer_id)}` : ''}
      </p>

      {change.decided_note && (
        <p className="mt-2 ml-6 rounded-lg surface-sunken px-3 py-2 text-[13px] text-muted">
          {change.decided_by ? state.nameOf(change.decided_by) : 'Somebody'} said:{' '}
          {change.decided_note}
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 pl-6">
          {change.body && (
            <p className="whitespace-pre-wrap break-words text-[13px] text-muted">{change.body}</p>
          )}

          {stale && (
            <Alert tone="error">
              This was written against commit {change.base_seq} and the repository is now on commit{' '}
              {repo.commit_count}. It cannot be merged until its author brings it up to date.
            </Alert>
          )}

          {mine && change.status === 'open' && (
            <Alert tone="info">Somebody else has to review your request.</Alert>
          )}

          {!mine && change.status === 'open' && change.reviewer_id && !assignedToMe && (
            <Alert tone="info">
              Only {state.nameOf(change.reviewer_id)} can accept or close this request.
            </Alert>
          )}

          {change.files.length === 0 && (
            <p className="text-[13px] text-muted">This change carries no files.</p>
          )}

          {folders.map((path) => (
            <p key={path} className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink">
              {path}
              <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">Folder</span>
            </p>
          ))}

          {before &&
            shown.map((f) => (
              <section key={f.path}>
                <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink">
                  {f.path}
                  <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
                    {FILE_ACTION_LABEL[f.action]}
                  </span>
                </p>
                <DiffView
                  before={fileText(f.kind, before[f.path] ?? '')}
                  after={f.action === 'removed' ? '' : fileText(f.kind, f.content)}
                  caption={`What this change would do to ${f.path}, line by line`}
                />
                <ReviewFilePreview file={f} />
              </section>
            ))}

          <section>
            <h4 className="text-[13px] font-medium text-ink">Comments</h4>
            <ul className="mt-1.5 space-y-1.5">
              {comments.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-lg surface-sunken px-3 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-ink">
                    <span className="font-medium">
                      {c.author_id ? state.nameOf(c.author_id) : 'A former member'}
                    </span>
                    {c.path && <span className="ml-1.5 font-mono text-[11px] text-faint">{c.path}</span>}{' '}
                    <span className="whitespace-pre-wrap break-words text-muted">{c.body}</span>
                  </span>
                  {!state.archived && (c.author_id === state.viewerId || state.can('edit_files')) && (
                    <button
                      type="button"
                      aria-label="Remove comment"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => deleteRepoComment(c.id),
                          'Comment removed',
                          'Could not remove it.',
                        )
                      }
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-faint hover:text-red-600 dark:hover:text-red-400"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </li>
              ))}
              {comments.length === 0 && <li className="text-[12px] text-faint">No comments yet.</li>}
            </ul>

            {!state.archived && state.viewerId && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!body.trim()) return
                  void run(
                    () =>
                      addRepoComment({
                        changeId: change.id,
                        projectId: change.project_id,
                        authorId: state.viewerId as string,
                        path: null,
                        body,
                      }),
                    'Comment posted',
                    'Could not post that comment.',
                  ).then(() => setBody(''))
                }}
              >
                <Input
                  aria-label="Write a comment"
                  placeholder="Ask a question or say what you would change"
                  maxLength={5000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="!h-9 !text-[13px]"
                />
                <Button type="submit" size="sm" variant="outline" className="!h-9 shrink-0">
                  Comment
                </Button>
              </form>
            )}
          </section>

          {!state.archived && (
            <div className="flex flex-wrap items-center gap-2">
              {mayAnswer && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="A note back"
                    placeholder="A note back (optional)"
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="!h-9 !w-[16rem] !text-[13px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => void (await answerRepoChange(change.id, false, note)),
                        'Change closed',
                        'Could not close it.',
                      )
                    }
                  >
                    Close
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={stale}
                    onClick={() =>
                      void run(
                        async () => void (await answerRepoChange(change.id, true, note)),
                        'Change merged',
                        'Could not merge it.',
                      )
                    }
                  >
                    Merge
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        onConfirm={async () => {
          await withdrawRepoChange(change.id)
          show('Request withdrawn')
          await onDone()
        }}
        title="Withdraw this request?"
        body="The reviewer will no longer see it. The files stay with the withdrawn request and do not go back to your draft."
        confirmLabel="Withdraw request"
        tone="danger"
      />
    </li>
  )
}

function ReviewFilePreview({ file }: { file: RepoFile }) {
  const [url, setUrl] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const name = fileName(file.path)
  const ext = extensionOf(file.path)
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
  const isPdf = ext === 'pdf'
  const canPreview = isPdf || isImage

  useEffect(() => {
    let alive = true
    setUrl(null)
    setDownloadUrl(null)
    setError(null)
    if (file.kind !== 'binary' || file.action === 'removed' || !file.storage_path) return
    void Promise.all([
      isPdf ? Promise.resolve(null) : projectFileUrl(file.storage_path),
      projectFileUrl(file.storage_path, name),
    ])
      .then(([preview, download]) => {
        if (!alive) return
        setUrl(preview)
        setDownloadUrl(download)
      })
      .catch((err) => {
        if (alive) setError(authErrorMessage(err, 'Could not load the file preview.'))
      })
    return () => {
      alive = false
    }
  }, [file.action, file.kind, file.storage_path, isPdf, name])

  if (file.kind !== 'binary' || file.action === 'removed') return null

  return (
    <div className="mt-2 space-y-2">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {downloadUrl && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(downloadUrl, '_blank', 'noopener')}
          >
            <Icon name="download" size={14} />
            Download
          </Button>
        )}
        {!canPreview && (
          <p className="text-[12px] text-muted">
            This uploaded file can be downloaded, but it cannot be previewed in the browser.
          </p>
        )}
      </div>
      {canPreview && (
        <div className="overflow-hidden rounded-xl border border-line bg-[var(--surface-sunken)]">
          {isPdf && file.storage_path ? (
            <PdfPreview storagePath={file.storage_path} label={name} />
          ) : !url ? (
            <div className="flex min-h-[14rem] items-center justify-center text-[13px] text-muted">
              Loading preview…
            </div>
          ) : (
            <div className="flex max-h-[70vh] justify-center overflow-auto p-3">
              <img src={url} alt={name} className="max-w-full rounded-lg" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
