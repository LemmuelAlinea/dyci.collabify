import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Tabs } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import {
  contentAt,
  createRepo,
  draftConflicts,
  getRepo,
  listCommitFiles,
  listCommits,
  listDraftFiles,
  listRepoChanges,
  listTree,
  myDraft,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { groupChanges } from '../../lib/general/review'
import { buildTree, fileText, flatFiles, folderOf, isKeep, nodesAt, shownFiles } from '../../lib/general/files'
import type { TreeNode } from '../../lib/general/files'
import { matches } from '../../lib/general/search'
import { FILE_ACTION_LABEL, FILE_KIND_LABEL } from '../../lib/general/types'
import type {
  DraftConflict,
  GeneralBlob,
  GeneralCommit,
  GeneralDraft,
  GeneralDraftFile,
  GeneralRepoChange,
  GeneralRepoSummary,
  GeneralTreeFile,
} from '../../lib/general/types'
import { DiffView } from './DiffView'
import { DraftPanel } from './DraftPanel'
import { FileEditor } from './FileEditor'
import type { OpenFile } from './FileEditor'
import { FolderBar } from './FolderBar'
import { NewItemDialog } from './NewItemDialog'
import { RenameFolderDialog } from './RenameFolderDialog'
import { RepoChangeRow } from './RepoChangeRow'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type View = 'main' | 'draft' | 'changes' | 'history'
const VIEWS: View[] = ['main', 'draft', 'changes', 'history']

/**
 * A project's files: a main folder everything is committed to, and a draft
 * where changes wait until the group approves them.
 *
 * The same four screens serve a research paper and a capstone system, because
 * the problem is the same one — several people changing the same work, and
 * needing to see what changed before it counts. A project that builds software
 * says so, and its code sits in the same tree under `src/`.
 */
export function FilesTab({ state }: { state: GeneralProjectState }) {
  const projectId = state.project?.id
  const [repo, setRepo] = useState<GeneralRepoSummary | null>(null)
  const [tree, setTree] = useState<GeneralTreeFile[]>([])
  const [commits, setCommits] = useState<GeneralCommit[]>([])
  const [changes, setChanges] = useState<GeneralRepoChange[]>([])
  const [draft, setDraft] = useState<GeneralDraft | null>(null)
  const [draftFiles, setDraftFiles] = useState<GeneralDraftFile[]>([])
  const [conflicts, setConflicts] = useState<DraftConflict[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view') as View | null
  const view: View = rawView && VIEWS.includes(rawView) ? rawView : 'main'
  const folder = view === 'main' || view === 'draft' ? params.get('path') ?? '' : ''
  const [renaming, setRenaming] = useState<string | null>(null)
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [view])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await getRepo(projectId)
      setRepo(r)
      if (!r) {
        setTree([])
        setCommits([])
        setChanges([])
        setDraft(null)
        setDraftFiles([])
        setConflicts([])
      } else {
        const [t, c, ch, d] = await Promise.all([
          listTree(r.id),
          listCommits(r.id),
          listRepoChanges(r.id),
          myDraft(r.id),
        ])
        setTree(t)
        setCommits(c)
        setChanges(ch)
        setDraft(d)
        const [df, cf] = await Promise.all([listDraftFiles(d.id), draftConflicts(r.id)])
        setDraftFiles(df)
        setConflicts(cf)
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

  function go(nextView: View, nextPath = '') {
    if (nextView !== view) setQuery('')
    const changed = new URLSearchParams(params)
    if (nextView === 'main') changed.delete('view')
    else changed.set('view', nextView)
    if (nextPath) changed.set('path', nextPath)
    else changed.delete('path')
    setParams(changed)
  }

  // A rename or a new item points the URL at a folder the tree only gains once
  // the reload lands, so that one path is exempt from the unresolved-path reset
  // until then.
  const pendingPath = useRef<string | null>(null)
  const [renameSettled, setRenameSettled] = useState(0)
  async function goAfterReload(path: string) {
    pendingPath.current = path
    go('draft', path)
    try {
      await load()
    } finally {
      if (pendingPath.current === path) {
        pendingPath.current = null
        setRenameSettled((n) => n + 1)
      }
    }
  }
  const resolved =
    !loaded ||
    !folder ||
    (view === 'main'
      ? tree.length === 0 || nodesAt(buildTree(tree), folder) !== null
      : nodesAt(buildTree(draftFiles as unknown as GeneralTreeFile[]), folder) !== null)

  useEffect(() => {
    if (resolved) {
      if (pendingPath.current === folder) pendingPath.current = null
      return
    }
    if (pendingPath.current === folder) return
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('path')
      return next
    })
  }, [resolved, folder, renameSettled, setParams])

  const mainOf = useCallback(
    (path: string) => tree.find((f) => f.path === path)?.content ?? '',
    [tree],
  )

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading the files…
      </div>
    )
  }

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        The files did not load. Try again in a moment.
      </Alert>
    )
  }

  if (!repo) return <StartFiles state={state} onDone={load} />

  const openChanges = changes.filter((c) => c.status === 'open')

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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!state.can('edit_files') && !state.archived && (
            <RequestAccessButton state={state} permission="edit_files" />
          )}
          {!state.archived && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              New
            </Button>
          )}
        </div>
      </header>

      {state.project?.has_code && (
        <Alert tone="info">
          This project builds software, so its code lives here beside its papers. It cannot be
          cloned or pushed to with Git — add and edit files in the site, and they carry the same
          history.
        </Alert>
      )}

      <Tabs<View>
        tabs={[
          { id: 'main', label: 'Main', icon: 'folder', count: tree.filter((f) => !isKeep(f.path)).length },
          { id: 'draft', label: 'My draft', icon: 'edit', count: draftFiles.filter((f) => !isKeep(f.path)).length },
          { id: 'changes', label: 'For review', icon: 'refresh', count: openChanges.length },
          { id: 'history', label: 'History', icon: 'clock', count: commits.length },
        ]}
        active={view}
        onChange={(v) => go(v)}
        variant="panel"
      />

      <Input
        icon="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          view === 'main' ? 'Search Main' : view === 'draft' ? 'Search your draft' : view === 'changes' ? 'Search requests' : 'Search history'
        }
        aria-label="Search this tab"
        className="max-w-md"
      />

      {view === 'main' && (
        <MainView
          repo={repo}
          tree={tree}
          draftFiles={draftFiles}
          state={state}
          path={folder}
          query={query}
          onNavigate={(p) => go(view, p)}
          onRename={setRenaming}
          onOpen={setOpen}
        />
      )}
      {view === 'draft' && (
        <DraftPanel
          draft={draft}
          files={draftFiles}
          conflicts={conflicts}
          repo={repo}
          state={state}
          mainOf={mainOf}
          path={folder}
          query={query}
          onNavigate={(p) => go(view, p)}
          onRename={setRenaming}
          onOpen={setOpen}
          onDone={load}
        />
      )}
      {view === 'changes' && (
        <ChangesView
          repo={repo}
          changes={changes.filter((c) =>
            matches(query, c.title, c.author_id ? state.nameOf(c.author_id) : '', ...c.files.map((f) => f.path)),
          )}
          state={state}
          onDone={load}
          query={query}
        />
      )}
      {view === 'history' && (
        <HistoryView
          commits={commits.filter((c) => matches(query, c.message, c.author_id ? state.nameOf(c.author_id) : ''))}
          state={state}
          query={query}
        />
      )}

      <FileEditor file={open} repo={repo} state={state} onClose={() => setOpen(null)} onSaved={load} />
      <NewItemDialog
        open={adding}
        onClose={() => setAdding(false)}
        repo={repo}
        tree={tree}
        draftFiles={draftFiles}
        folder={folder}
        onDone={goAfterReload}
      />
      <RenameFolderDialog
        repoId={repo.id}
        path={renaming}
        siblings={(nodesAt(buildTree([...tree, ...(draftFiles as unknown as GeneralTreeFile[])]), renaming ? folderOf(renaming) : '') ?? []).map((n) => n.name)}
        onClose={() => setRenaming(null)}
        onRenamed={goAfterReload}
      />
    </div>
  )
}

/* ------------------------------------------------------------------- start */

function StartFiles({ state, onDone }: { state: GeneralProjectState; onDone: () => Promise<void> }) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const may = state.can('edit_files') && !state.archived

  return (
    <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
      <Icon name="folder" size={28} className="mx-auto text-faint" />
      <h2 className="mt-3">No files yet</h2>
      <p className="mx-auto mt-1.5 max-w-[34rem] text-[13px] text-muted">
        Papers, spreadsheets, permits and code all live here, in folders, with every version kept.
        Anybody on the project can change a file in their own draft and submit it for the group to
        approve.
      </p>
      {may ? (
        <Button
          className="mt-4"
          loading={busy}
          onClick={async () => {
            if (!state.project) return
            setBusy(true)
            try {
              await createRepo(state.project.id, 'Files')
              show('Files started')
              await onDone()
            } catch (err) {
              show(authErrorMessage(err, 'Could not start them.'), 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon name="plus" size={14} />
          Start the project's files
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

/* -------------------------------------------------------------------- main */

function MainView({
  repo,
  tree,
  draftFiles,
  state,
  path,
  query,
  onNavigate,
  onRename,
  onOpen,
}: {
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  draftFiles: GeneralDraftFile[]
  state: GeneralProjectState
  path: string
  query: string
  onNavigate: (path: string) => void
  onRename: (path: string) => void
  onOpen: (file: OpenFile) => void
}) {
  const all = buildTree(tree)

  if (tree.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        Nothing has been committed yet.
      </p>
    )
  }

  if (query.trim()) {
    const hits = flatFiles(all).filter((n) => matches(query, n.path))
    return hits.length === 0 ? (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        Nothing in Main matches “{query.trim()}”.
      </p>
    ) : (
      <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
        {hits.map((node) => (
          <li key={node.path}>
            <MainFileRow node={{ ...node, name: node.path }} draftFiles={draftFiles} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    )
  }

  const level = nodesAt(all, path)

  if (level === null) return null

  return (
    <div className="space-y-2">
      <FolderBar
        rootLabel="Main"
        path={path}
        onNavigate={onNavigate}
        actions={
          path && !state.archived ? (
            <Button size="sm" variant="ghost" onClick={() => onRename(path)}>
              <Icon name="edit" size={14} />
              Rename
            </Button>
          ) : undefined
        }
      />
      <p className="text-[12px] text-muted">Everything the project holds as of commit {repo.commit_count}.</p>
      {level.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          This folder is empty.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
          {level.map((node) => (
            <li key={node.path}>
              {node.type === 'folder' ? (
                <button
                  type="button"
                  onClick={() => onNavigate(node.path)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <Icon name="folder" size={15} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{node.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
                  <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
                </button>
              ) : (
                <MainFileRow node={node} draftFiles={draftFiles} onOpen={onOpen} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MainFileRow({
  node,
  draftFiles,
  onOpen,
}: {
  node: Extract<TreeNode, { type: 'file' }>
  draftFiles: GeneralDraftFile[]
  onOpen: (file: OpenFile) => void
}) {
  const inDraft = draftFiles.some((f) => f.path === node.path)
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({ path: node.path, kind: node.file.kind, content: node.file.content, storagePath: node.file.storage_path, action: 'changed', fromDraft: false })
      }
      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
    >
      <Icon name="file" size={15} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.name}</span>
      {inDraft && (
        <span className="shrink-0 rounded-md bg-amber-400/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
          In your draft
        </span>
      )}
      <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">{FILE_KIND_LABEL[node.file.kind]}</span>
    </button>
  )
}

/* ----------------------------------------------------------------- changes */

function ChangesView({
  repo,
  changes,
  state,
  onDone,
  query,
}: {
  repo: GeneralRepoSummary
  changes: GeneralRepoChange[]
  state: GeneralProjectState
  onDone: () => Promise<void>
  query?: string
}) {
  const { mine, toMe, others } = groupChanges(changes, state.viewerId ?? null)

  if (mine.length + toMe.length + others.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        {query?.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing is waiting for review. Submitting a draft puts it here.'}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <ChangeSection title="Submitted by me" changes={mine} repo={repo} state={state} onDone={onDone} />
      <ChangeSection title="Submitted to me" changes={toMe} repo={repo} state={state} onDone={onDone} />
      <ChangeSection title="Other open requests" changes={others} repo={repo} state={state} onDone={onDone} collapsed />
    </div>
  )
}

function ChangeSection({
  title,
  changes,
  repo,
  state,
  onDone,
  collapsed = false,
}: {
  title: string
  changes: GeneralRepoChange[]
  repo: GeneralRepoSummary
  state: GeneralProjectState
  onDone: () => Promise<void>
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  if (changes.length === 0) return null
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mb-2 flex items-center gap-2 text-left"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
        <h3 className="text-[14px]">{title}</h3>
        <span className="rounded-full surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">{changes.length}</span>
      </button>
      {open && (
        <ul className="space-y-3">
          {changes.map((c) => (
            <RepoChangeRow key={c.id} change={c} repo={repo} state={state} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- history */

function HistoryView({
  commits,
  state,
  query,
}: {
  commits: GeneralCommit[]
  state: GeneralProjectState
  query?: string
}) {
  const [open, setOpen] = useState<string | null>(null)

  if (commits.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        {query?.trim() ? `Nothing matches “${query.trim()}”.` : 'No commits yet.'}
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
      const pairs = await Promise.all(
        shownFiles(rows).shown.map(async (r) => [r.path, await contentAt(r.repo_id, r.path, r.seq - 1)] as const),
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

  const { shown, folders } = shownFiles(files)

  return (
    <div className="space-y-3 px-4 pb-4">
      {folders.map((path) => (
        <p key={path} className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink">
          {path}
          <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">Folder</span>
        </p>
      ))}
      {shown.map((f) => (
        <section key={f.id}>
          <p className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-ink">
            {f.path}
            <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
              {FILE_ACTION_LABEL[f.action]}
            </span>
          </p>
          {f.kind === 'binary' ? (
            <p className="text-[12px] text-muted">
              An uploaded file. Its contents are not compared here.
            </p>
          ) : (
            <DiffView
              before={fileText(f.kind, before[f.path] ?? '')}
              after={f.action === 'removed' ? '' : fileText(f.kind, f.content)}
              caption={`What commit ${commit.seq} did to ${f.path}, line by line`}
            />
          )}
        </section>
      ))}
    </div>
  )
}
