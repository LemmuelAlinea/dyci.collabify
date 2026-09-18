import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { Tabs } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  commitFiles,
  contentAt,
  createRepo,
  getRepo,
  listCommitFiles,
  listCommits,
  listRepoChanges,
  listTree,
  openRepoChange,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { documentFileName } from '../../lib/general/diff'
import { FILE_ACTION_LABEL } from '../../lib/general/types'
import type {
  FileAction,
  GeneralBlob,
  GeneralCommit,
  GeneralRepoChange,
  GeneralRepoSummary,
  GeneralTreeFile,
  RepoFile,
} from '../../lib/general/types'
import { DiffView } from './DiffView'
import { RepoChangeRow } from './RepoChangeRow'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type RepoView = 'files' | 'changes' | 'history'

/**
 * Files, commits, changes and history for a project that builds something.
 *
 * Not a Git server: `git push` from a laptop needs a host speaking the Git wire
 * protocol, which this product does not have. What it does have is everything a
 * school project actually asks a repository for — see the files, see what
 * changed, review somebody's work, and keep a history nobody can rewrite.
 */
export function RepoTab({ state }: { state: GeneralProjectState }) {
  const projectId = state.project?.id
  const [repo, setRepo] = useState<GeneralRepoSummary | null>(null)
  const [tree, setTree] = useState<GeneralTreeFile[]>([])
  const [commits, setCommits] = useState<GeneralCommit[]>([])
  const [changes, setChanges] = useState<GeneralRepoChange[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [view, setView] = useState<RepoView>('files')

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await getRepo(projectId)
      setRepo(r)
      if (r) {
        const [t, c, ch] = await Promise.all([listTree(r.id), listCommits(r.id), listRepoChanges(r.id)])
        setTree(t)
        setCommits(c)
        setChanges(ch)
      } else {
        setTree([])
        setCommits([])
        setChanges([])
      }
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['general_repos', 'general_commits', 'general_repo_changes'])

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the repository…
      </div>
    )
  }

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        The repository did not load. Try again in a moment.
      </Alert>
    )
  }

  if (!repo) return <StartRepo state={state} onDone={load} />

  const open = changes.filter((c) => c.status === 'open')

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words">{repo.name}</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {repo.file_count} {repo.file_count === 1 ? 'file' : 'files'} · {repo.commit_count}{' '}
            {repo.commit_count === 1 ? 'commit' : 'commits'}
            {repo.last_author ? ` · last by ${state.nameOf(repo.last_author)}` : ''}
            {repo.last_commit_at ? ` · ${formatDue(repo.last_commit_at)}` : ''}
          </p>
          {repo.description && <p className="mt-1 text-[13px] text-muted">{repo.description}</p>}
        </div>
        {!state.can('edit_files') && !state.archived && (
          <RequestAccessButton state={state} permission="edit_files" />
        )}
      </header>

      <Alert tone="info">
        This repository lives in Collabify, so it cannot be cloned or pushed to with Git. Add and
        edit files here, and they carry the same history.
      </Alert>

      <Tabs<RepoView>
        tabs={[
          { id: 'files', label: 'Files', icon: 'folder', count: tree.length },
          { id: 'changes', label: 'Changes', icon: 'refresh', count: open.length },
          { id: 'history', label: 'History', icon: 'clock', count: commits.length },
        ]}
        active={view}
        onChange={setView}
        variant="panel"
      />

      {view === 'files' && <FilesView repo={repo} tree={tree} state={state} onDone={load} />}
      {view === 'changes' && (
        <ChangesView repo={repo} changes={changes} state={state} onDone={load} />
      )}
      {view === 'history' && <HistoryView commits={commits} state={state} />}
    </div>
  )
}

/* ------------------------------------------------------------------- start */

function StartRepo({ state, onDone }: { state: GeneralProjectState; onDone: () => Promise<void> }) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const may = state.can('edit_files') && !state.archived

  return (
    <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
      <Icon name="folder" size={28} className="mx-auto text-faint" />
      <h2 className="mt-3">No repository yet</h2>
      <p className="mx-auto mt-1.5 max-w-[34rem] text-[13px] text-muted">
        For a project that builds something. Files live here with their history, and anybody on the
        project can open a change for review — the work a capstone team would otherwise take
        elsewhere.
      </p>
      {may ? (
        <Button
          className="mt-4"
          loading={busy}
          onClick={async () => {
            if (!state.project) return
            setBusy(true)
            try {
              await createRepo(state.project.id, 'Repository')
              show('Repository started')
              await onDone()
            } catch (err) {
              show(authErrorMessage(err, 'Could not start it.'), 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon name="plus" size={14} />
          Start a repository
        </Button>
      ) : (
        !state.archived && (
          <div className="mt-4">
            <RequestAccessButton state={state} permission="edit_files" />
          </div>
        )
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- files */

function FilesView({
  repo,
  tree,
  state,
  onDone,
}: {
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  state: GeneralProjectState
  onDone: () => Promise<void>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const shown = tree.find((f) => f.path === open) ?? null
  const may = !state.archived && state.viewerId

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          Everything the repository holds as of commit {repo.commit_count}.
        </p>
        {may && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            New file
          </Button>
        )}
      </div>

      {tree.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          No files yet.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
          {tree.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setOpen(f.path)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
              >
                <Icon name="file" size={15} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{f.path}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">{f.size} chars</span>
                <Icon name="chevronRight" size={15} className="shrink-0 text-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <FileDialog
        file={shown}
        repo={repo}
        state={state}
        onClose={() => setOpen(null)}
        onDone={onDone}
      />
      <FileDialog
        file={null}
        repo={repo}
        state={state}
        creating={adding}
        onClose={() => setAdding(false)}
        onDone={onDone}
      />
    </div>
  )
}

/**
 * One file, opened to be read or rewritten.
 *
 * Whoever holds `edit_files` commits; everybody else's save opens a change with
 * the same one-file payload, which is the only difference between the two.
 */
function FileDialog({
  file,
  repo,
  state,
  creating = false,
  onClose,
  onDone,
}: {
  file: GeneralTreeFile | null
  repo: GeneralRepoSummary
  state: GeneralProjectState
  creating?: boolean
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const open = creating || Boolean(file)
  const mayCommit = state.can('edit_files')
  const [path, setPath] = useState(file?.path ?? '')
  const [body, setBody] = useState(file?.content ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seen = file?.id ?? (creating ? 'new' : '')
  useEffect(() => {
    setPath(file?.path ?? '')
    setBody(file?.content ?? '')
    setMessage('')
    setError(null)
  }, [seen]) // eslint-disable-line react-hooks/exhaustive-deps

  const action: FileAction = creating ? 'added' : 'changed'
  const dirty = creating ? path.trim() !== '' : body !== (file?.content ?? '')

  async function save(remove = false) {
    if (busy || !state.viewerId) return
    setError(null)
    if (!path.trim()) return setError('Give the file a path, like src/app.ts.')
    if (!message.trim()) return setError('Say what you changed. A history without messages is a list of dates.')
    const files: RepoFile[] = [
      { path: path.trim(), action: remove ? 'removed' : action, content: remove ? '' : body },
    ]
    setBusy(true)
    try {
      if (mayCommit) {
        await commitFiles({ repoId: repo.id, message, baseSeq: repo.commit_count, files })
        show(remove ? 'File removed' : 'Committed')
      } else {
        await openRepoChange({
          repoId: repo.id,
          projectId: repo.project_id,
          authorId: state.viewerId,
          title: message,
          body: '',
          baseSeq: repo.commit_count,
          files,
        })
        show('Change opened for review')
      }
      onClose()
      await onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that.'))
    } finally {
      setBusy(false)
    }
  }

  function download() {
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = path.split('/').pop() || documentFileName(repo.name, repo.commit_count, 'txt')
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? 'New file' : (file?.path ?? 'File')}
      size="xl"
      focusField={creating}
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        {!mayCommit && !state.archived && (
          <Alert tone="info">
            Your save opens a change for somebody with file access to review, rather than going
            straight in.
          </Alert>
        )}

        {creating ? (
          <Field label="Path">
            {(id) => (
              <Input
                id={id}
                maxLength={400}
                placeholder="src/app.ts"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="!font-mono"
              />
            )}
          </Field>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="font-mono">{file?.path}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={download}>
              <Icon name="download" size={14} />
              Download
            </Button>
          </div>
        )}

        <Field label="Contents">
          {(id) => (
            <Textarea
              id={id}
              rows={16}
              maxLength={400000}
              readOnly={state.archived}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="!font-mono !text-[12px] !leading-relaxed"
            />
          )}
        </Field>

        {!state.archived && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <Field label={mayCommit ? 'Commit message' : 'What you changed'}>
                {(id) => (
                  <Input
                    id={id}
                    maxLength={200}
                    placeholder="Fixed the login redirect"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                )}
              </Field>
            </div>
            {!creating && mayCommit && (
              <Button variant="ghost" disabled={busy} onClick={() => void save(true)}>
                Remove file
              </Button>
            )}
            <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
              {mayCommit ? 'Commit' : 'Open a change'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- changes */

function ChangesView({
  repo,
  changes,
  state,
  onDone,
}: {
  repo: GeneralRepoSummary
  changes: GeneralRepoChange[]
  state: GeneralProjectState
  onDone: () => Promise<void>
}) {
  if (changes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        Nobody has opened a change yet. Editing a file without file access opens one.
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {changes.map((c) => (
        <RepoChangeRow key={c.id} change={c} repo={repo} state={state} onDone={onDone} />
      ))}
    </ul>
  )
}

/* ----------------------------------------------------------------- history */

function HistoryView({ commits, state }: { commits: GeneralCommit[]; state: GeneralProjectState }) {
  const [open, setOpen] = useState<string | null>(null)

  if (commits.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        No commits yet.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
      {commits.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => setOpen(open === c.id ? null : c.id)}
            aria-expanded={open === c.id}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
          >
            <span className="w-10 shrink-0 font-mono text-[12px] text-faint">#{c.seq}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{c.message}</span>
              <span className="block text-[12px] text-faint">
                {c.author_id ? state.nameOf(c.author_id) : 'A former member'} ·{' '}
                {formatDue(c.created_at)}
                {c.change_id ? ' · from a reviewed change' : ''}
              </span>
            </span>
            <Icon
              name={open === c.id ? 'chevronDown' : 'chevronRight'}
              size={15}
              className="shrink-0 text-faint"
            />
          </button>
          {open === c.id && <CommitFiles commit={c} />}
        </li>
      ))}
    </ul>
  )
}

function CommitFiles({ commit }: { commit: GeneralCommit }) {
  const [files, setFiles] = useState<GeneralBlob[] | null>(null)
  const [before, setBefore] = useState<Record<string, string | null>>({})

  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await listCommitFiles(commit.id)
      if (!alive) return
      setFiles(rows)
      // What each path said the commit before, so the diff is real rather than
      // "here is the whole file".
      const pairs = await Promise.all(
        rows.map(async (r) => [r.path, await contentAt(r.repo_id, r.path, r.seq - 1)] as const),
      )
      if (alive) setBefore(Object.fromEntries(pairs))
    })()
    return () => {
      alive = false
    }
  }, [commit.id])

  if (!files) {
    return (
      <div className="flex items-center gap-2 px-4 pb-3 text-[12px] text-muted">
        <Spinner size={13} />
        Loading what changed…
      </div>
    )
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      {files.map((f) => (
        <section key={f.id}>
          <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink">
            {f.path}
            <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
              {FILE_ACTION_LABEL[f.action]}
            </span>
          </p>
          <DiffView
            before={before[f.path] ?? ''}
            after={f.action === 'removed' ? '' : f.content}
            caption={`What commit ${commit.seq} did to ${f.path}, line by line`}
          />
        </section>
      ))}
    </div>
  )
}
