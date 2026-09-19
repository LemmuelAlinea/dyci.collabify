import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
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
  saveDraftFile,
  uploadProjectFile,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import {
  actionFor,
  buildTree,
  fileName,
  fileText,
  kindForPath,
  pathProblem,
} from '../../lib/general/files'
import type { TreeNode } from '../../lib/general/files'
import { docxToHtml, OFFICE_WARNING, readAsText, xlsxToWorkbook } from '../../lib/general/office'
import { serializeWorkbook } from '../../lib/general/sheet'
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
import { RepoChangeRow } from './RepoChangeRow'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

type View = 'main' | 'draft' | 'changes' | 'history'

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
  const [view, setView] = useState<View>('main')
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [adding, setAdding] = useState(false)

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
              New file
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
          { id: 'main', label: 'Main', icon: 'folder', count: tree.length },
          { id: 'draft', label: 'My draft', icon: 'edit', count: draftFiles.length },
          { id: 'changes', label: 'For review', icon: 'refresh', count: openChanges.length },
          { id: 'history', label: 'History', icon: 'clock', count: commits.length },
        ]}
        active={view}
        onChange={setView}
        variant="panel"
      />

      {view === 'main' && (
        <MainView
          repo={repo}
          tree={tree}
          draftFiles={draftFiles}
          state={state}
          onOpen={setOpen}
        />
      )}
      {view === 'draft' && (
        <DraftPanel
          draft={draft}
          files={draftFiles}
          conflicts={conflicts}
          repo={repo}
          mainOf={mainOf}
          onOpen={setOpen}
          onDone={load}
        />
      )}
      {view === 'changes' && (
        <ChangesView repo={repo} changes={changes} state={state} onDone={load} />
      )}
      {view === 'history' && <HistoryView commits={commits} state={state} />}

      <FileEditor file={open} repo={repo} state={state} onClose={() => setOpen(null)} onSaved={load} />
      <NewFileDialog
        open={adding}
        onClose={() => setAdding(false)}
        repo={repo}
        tree={tree}
        onDone={load}
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
  onOpen,
}: {
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  draftFiles: GeneralDraftFile[]
  state: GeneralProjectState
  onOpen: (file: OpenFile) => void
}) {
  const nodes = buildTree(tree)

  if (tree.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        Nothing has been committed yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted">
        Everything the project holds as of commit {repo.commit_count}.
      </p>
      <ul className="overflow-hidden rounded-panel border border-line surface">
        {nodes.map((node) => (
          <Node
            key={node.path}
            node={node}
            depth={0}
            draftFiles={draftFiles}
            state={state}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  )
}

function Node({
  node,
  depth,
  draftFiles,
  state,
  onOpen,
}: {
  node: TreeNode
  depth: number
  draftFiles: GeneralDraftFile[]
  state: GeneralProjectState
  onOpen: (file: OpenFile) => void
}) {
  const [open, setOpen] = useState(depth === 0)

  if (node.type === 'folder') {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left hover:bg-[var(--surface-sunken)]"
          style={{ paddingLeft: `${depth * 1.25 + 1}rem` }}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
          <Icon name="folder" size={15} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{node.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
        </button>
        {open && (
          <ul>
            {node.children.map((child) => (
              <Node
                key={child.path}
                node={child}
                depth={depth + 1}
                draftFiles={draftFiles}
                state={state}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const inDraft = draftFiles.some((f) => f.path === node.path)

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onOpen({
            path: node.path,
            kind: node.file.kind,
            content: node.file.content,
            storagePath: node.file.storage_path,
            action: 'changed',
            fromDraft: false,
          })
        }
        className="flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left hover:bg-[var(--surface-sunken)]"
        style={{ paddingLeft: `${depth * 1.25 + 1}rem` }}
      >
        <Icon name="file" size={15} className="ml-[1.375rem] shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.name}</span>
        {inDraft && (
          <span className="shrink-0 rounded-md bg-amber-400/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200">
            In your draft
          </span>
        )}
        <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
          {FILE_KIND_LABEL[node.file.kind]}
        </span>
      </button>
    </li>
  )
}

/* ---------------------------------------------------------------- new file */

function NewFileDialog({
  open,
  onClose,
  repo,
  tree,
  onDone,
}: {
  open: boolean
  onClose: () => void
  repo: GeneralRepoSummary
  tree: GeneralTreeFile[]
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<File | null>(null)

  const kind = path ? kindForPath(path) : null
  const office = kind === 'rich' || kind === 'sheet'

  async function add() {
    if (busy) return
    const problem = pathProblem(path)
    if (problem) return setError(problem)
    if (tree.some((f) => f.path === path.trim())) {
      return setError('The project already has a file at that path. Open it instead.')
    }
    setError(null)
    setBusy(true)
    try {
      const target = path.trim()
      const k = kindForPath(target)
      let content = ''
      let storagePath: string | null = null

      if (picked) {
        if (k === 'rich') content = (await docxToHtml(picked)).html
        else if (k === 'sheet') content = serializeWorkbook(await xlsxToWorkbook(picked))
        else if (k === 'text') content = await readAsText(picked)
        else storagePath = await uploadProjectFile(repo.project_id, picked)
      }

      await saveDraftFile({
        repoId: repo.id,
        path: target,
        action: actionFor(target, tree),
        kind: k,
        content,
        storagePath,
      })
      show('Added to your draft')
      setPath('')
      setPicked(null)
      onClose()
      await onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that file.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New file"
      description="It goes into your draft. Submit the draft when you want the group to see it."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void add()}>
            Add to my draft
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Path in the project">
          {(id) => (
            <Input
              id={id}
              maxLength={400}
              placeholder="documents/Chapter 1.docx"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="!font-mono"
            />
          )}
        </Field>

        {kind && (
          <p className="text-[12px] text-muted">
            Saved as a {FILE_KIND_LABEL[kind].toLowerCase()}.{' '}
            {kind === 'binary'
              ? 'Kept and versioned here, opened in the program that made it.'
              : 'You can edit it in the site.'}
          </p>
        )}

        <Field label="Start from a file on your computer" optional>
          {(id) => (
            <input
              id={id}
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setPicked(f)
                if (f && !path.trim()) setPath(fileName(f.name))
              }}
              className="w-full rounded-xl border border-line surface px-3 py-2 text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-sunken)] file:px-3 file:py-1.5 file:text-[13px] file:text-ink"
            />
          )}
        </Field>

        {picked && office && <Alert tone="info">{OFFICE_WARNING}</Alert>}
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
        Nothing is waiting for review. Submitting a draft puts it here.
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
