import { dayCount, useOrgSettings } from '../../hooks/useOrgSettings'
import { useEffect, useId, useState } from 'react'
import { ActionMenu } from '../ui/ActionMenu'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { CheckboxList } from '../ui/CheckboxList'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  archiveDraftPath,
  commitDraftPath,
  discardDraft,
  projectFileUrl,
  saveDraftFile,
  storagePathAt,
  submitDraftFolder,
  submitDraftFile,
  syncDraft,
} from '../../lib/api/general'
import { baseOf, endPull, pullFile, recordBase } from '../../lib/api/filePulls'
import { trashDraftPath } from '../../lib/api/trash'
import { writeChangeMessage } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { buildTree, describeDraft, fileName, fileText, flatFiles, isPreviewableWord, isWordPath, nodesAt } from '../../lib/general/files'
import { stalePushMessage, unknownCopyMessage } from '../../lib/general/newVersion'
import { openTabFor } from '../../lib/general/openTab'
import { pushVerdict } from '../../lib/general/pushCheck'
import type { PushVerdict } from '../../lib/general/pushCheck'
import type { TreeNode } from '../../lib/general/files'
import { matches } from '../../lib/general/search'
import { FILE_ACTION_LABEL } from '../../lib/general/types'
import type {
  DraftConflict,
  GeneralDraft,
  GeneralDraftFile,
  GeneralRepoSummary,
} from '../../lib/general/types'
import { fullName } from '../../lib/types'
import { DiffView } from './DiffView'
import type { OpenFile } from './FileEditor'
import { FolderBar } from './FolderBar'
import { HeldPush } from './HeldPush'
import { WordDiff } from './WordDiff'
import { ShareDialog } from './ShareDialog'
import type { GeneralProjectState } from './useGeneralProject'

type SubmitTarget = { type: 'file' | 'folder'; path: string }

type Held = PushVerdict & { kind: 'held' }

/** Submit or Commit, waiting on the person past the warning for copies with no known start. */
type Asking = { then: 'submit' | 'commit'; target: SubmitTarget; paths: string[] }

/** The draft paths a target carries: the file itself, or every file under the folder. */
const under = (target: SubmitTarget, path: string) =>
  target.type === 'file' ? path === target.path : path.startsWith(`${target.path}/`)

/** Why a folder cannot go anywhere yet, naming its held Word files; null when none is held. */
export function heldFolderReason(folder: string, held: Record<string, Held>) {
  const paths = Object.keys(held).filter((p) => under({ type: 'folder', path: folder }, p))
  if (paths.length === 0) return null
  return paths.length === 1
    ? `${fileName(paths[0])} is held. Combine it with Main's newer version or replace it first.`
    : `${paths.length} Word files in it are held. Combine them with Main's newer versions or replace them first.`
}

/** A stale push said in plain words; any other error as it came. */
const plainStale = (err: unknown) => {
  const message = stalePushMessage(err, null)
  return message ? new Error(message) : err
}

/** The last part of a path: what somebody types to confirm a commit. */
const baseName = (target: SubmitTarget | null) => target?.path.split('/').pop() ?? ''

/**
 * Your working copy, and the one button that hands it over.
 *
 * Everything here is yours alone until you submit. That is what makes it worth
 * having: a chapter can sit half-rewritten for a week without the group seeing
 * a mess, and the group is asked to approve one finished thought rather than
 * every save along the way.
 */
export function DraftPanel({
  draft,
  files,
  conflicts,
  repo,
  state,
  mainOf,
  mainStorageOf,
  mainAtOf = () => null,
  path,
  query,
  onNavigate,
  onRename,
  onOpen,
  onDone,
}: {
  draft: GeneralDraft | null
  files: GeneralDraftFile[]
  conflicts: DraftConflict[]
  repo: GeneralRepoSummary
  state: GeneralProjectState
  /** What Main says for a path, so the diff shows what submitting would do. */
  mainOf: (path: string) => string
  /** The Storage object Main holds for a path, for Word files. */
  mainStorageOf: (path: string) => string | null
  /** When Main's version of a path was committed, for the unknown-copy warning. */
  mainAtOf?: (path: string) => string | null
  path: string
  query?: string
  onNavigate: (path: string) => void
  onRename: (path: string) => void
  onOpen: (file: OpenFile) => void
  onDone: () => Promise<void>
}) {
  const { show } = useToast()
  const { trash_retention_days: retention } = useOrgSettings()
  const [submitting, setSubmitting] = useState<SubmitTarget | null>(null)
  const [archiving, setArchiving] = useState<SubmitTarget | null>(null)
  const [committing, setCommitting] = useState<SubmitTarget | null>(null)
  const [sharing, setSharing] = useState<SubmitTarget | null>(null)
  const [typed, setTyped] = useState('')
  const mayCommit = state.can('commit_main')
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  // Word copies in the draft made from a version Main has moved past, by path.
  const [held, setHeld] = useState<Record<string, Held>>({})
  // Word copies in Main's paths with no starting version on record.
  const [unknown, setUnknown] = useState<string[]>([])
  const [asking, setAsking] = useState<Asking | null>(null)
  const [recheck, setRecheck] = useState(0)
  // Download links for the rows whose tab the browser blocked.
  const [links, setLinks] = useState<Record<string, string>>({})

  const behind = draft !== null && draft.base_seq !== repo.commit_count

  // One key for the Word copies whose push could be held, so the check reruns only when they change.
  const wordCopies = files
    .filter((f) => f.kind === 'binary' && isWordPath(f.path) && f.action !== 'removed' && f.storage_path)
    .map((f) => [f.path, f.storage_path, mainStorageOf(f.path) ? 'main' : ''].join('\t'))
    .join('\n')

  // Each copy's recorded base against Main's newest version of its path.
  useEffect(() => {
    let alive = true
    const rows = wordCopies && !state.readOnly ? wordCopies.split('\n').map((r) => r.split('\t')) : []
    void Promise.all(
      rows.map(async ([p, storage, main]) => [p, pushVerdict(await baseOf(storage).catch(() => null), main === 'main')] as const),
    ).then((pairs) => {
      if (!alive) return
      const next: Record<string, Held> = {}
      for (const [p, v] of pairs) if (v.kind === 'held') next[p] = v
      setHeld(next)
      setUnknown(pairs.filter(([, v]) => v.kind === 'unknown').map(([p]) => p))
    })
    return () => {
      alive = false
    }
  }, [repo.id, repo.commit_count, wordCopies, state.readOnly, recheck])

  /** Submit or Commit; a copy with no known start asks first. */
  function begin(then: Asking['then'], target: SubmitTarget) {
    const paths = unknown.filter((p) => under(target, p))
    if (paths.length > 0) return setAsking({ then, target, paths })
    if (then === 'submit') setSubmitting(target)
    else setCommitting(target)
  }
  const onSubmitTarget = (target: SubmitTarget) => begin('submit', target)
  const onCommitTarget = (target: SubmitTarget) => begin('commit', target)
  const folderHeld = path ? heldFolderReason(path, held) : null

  // Opens its tab inside the click (openTabFor), before any await.
  function getTheirs(f: GeneralDraftFile, verdict: Held) {
    setLinks(({ [f.path]: _old, ...rest }) => rest)
    return openTabFor(async () => {
      await pullFile(repo.id, f.path, true)
      const storagePath = await storagePathAt(repo.id, f.path, verdict.mainSeq)
      if (!storagePath) throw new Error('That version has no file to download. Reload the page and try again.')
      return projectFileUrl(storagePath, fileName(f.path))
    })
      .then((link) => {
        // The hold stays with the draft's copy until the combined copy replaces it.
        if (link) setLinks((current) => ({ ...current, [f.path]: link }))
        else show('Downloaded the newer version. Combine the two in Word, then upload your combined copy as a new version.')
      })
      .catch((err: unknown) => show(authErrorMessage(err, 'Could not download it. Try again in a moment.'), 'error'))
  }

  async function replaceAnyway(f: GeneralDraftFile, verdict: Held) {
    try {
      // The copy now counts as made from Main's newest version.
      if (f.storage_path) await recordBase(repo.id, f.path, f.storage_path, verdict.mainSeq)
      // Main removed the file, so the draft's copy goes back in as a new one.
      if (verdict.removed && f.action === 'changed') {
        await saveDraftFile({ repoId: repo.id, path: f.path, action: 'added', kind: 'binary', storagePath: f.storage_path })
      }
    } catch (err) {
      throw new Error(authErrorMessage(err, 'Could not replace it. Try again in a moment.'))
    }
    await endPull(repo.id, f.path).catch(() => {})
    show('Your copy will replace it')
    setRecheck((n) => n + 1)
    await onDone()
  }
  const all = buildTree(files as unknown as Parameters<typeof buildTree>[0])
  const level = nodesAt(all, path)

  async function run(action: () => Promise<void>, done: string, failed: string) {
    if (busy) return
    setBusy(true)
    try {
      await action()
      show(done)
      await onDone()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(false)
    }
  }

  function moveToTrash(target: SubmitTarget) {
    void run(
      async () => {
        await trashDraftPath(repo.id, target.path)
        if (target.path === path) onNavigate(path.split('/').slice(0, -1).join('/'))
      },
      `${target.type === 'folder' ? 'Folder' : 'File'} moved to Trash. It stays there for ${dayCount(retention)}.`,
      'Could not move it to Trash.',
    )
  }

  if (level === null) return null

  if (files.length === 0 && path === '') {
    return (
      <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
        <Icon name="edit" size={26} className="mx-auto text-faint" />
        <h3 className="mt-3 text-[15px]">Your draft is empty</h3>
        <p className="mx-auto mt-1.5 max-w-[32rem] text-[13px] text-muted">
          Open a file, change it, and save it here. Nothing you put in a draft reaches the project
          until you submit it for review.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {describeDraft(files)}
          {draft && <span className="text-faint"> · started from commit {draft.base_seq}</span>}
        </p>
        {!state.readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDiscarding(true)}>
              Discard it all
            </Button>
          </div>
        )}
      </div>

      {!query?.trim() && (
        <FolderBar
          rootLabel="My draft"
          path={path}
          onNavigate={onNavigate}
          actions={
            path && !state.readOnly ? (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRename(path)}>
                  <Icon name="edit" size={14} />
                  Rename
                </Button>
                <ActionMenu
                  label={`Actions for ${path}`}
                  disabled={busy}
                  items={[
                    {
                      label: 'Submit for review',
                      icon: 'refresh',
                      disabled: behind || Boolean(folderHeld),
                      hint: folderHeld ?? undefined,
                      onSelect: () => onSubmitTarget({ type: 'folder', path }),
                    },
                    ...(mayCommit
                      ? [
                          {
                            label: 'Commit to main',
                            icon: 'check' as const,
                            disabled: behind || Boolean(folderHeld),
                            hint: folderHeld ?? undefined,
                            onSelect: () => onCommitTarget({ type: 'folder', path }),
                          },
                        ]
                      : []),
                    { label: 'Share', icon: 'users', onSelect: () => setSharing({ type: 'folder', path }) },
                    { label: 'Archive', icon: 'archive', onSelect: () => setArchiving({ type: 'folder', path }) },
                    { label: 'Move to trash', icon: 'trash', tone: 'danger', separated: true, onSelect: () => moveToTrash({ type: 'folder', path }) },
                  ]}
                />
              </>
            ) : undefined
          }
        />
      )}

      {behind && (
        <Alert tone="error">
          The project moved to commit {repo.commit_count} while you were working, and your draft
          started from {draft?.base_seq}.
          {conflicts.length > 0 ? (
            <>
              {' '}
              {conflicts.length === 1 ? 'This file was' : 'These files were'} changed underneath
              you: {conflicts.map((c) => c.path).join(', ')}. Open{' '}
              {conflicts.length === 1 ? 'it' : 'them'} and check your wording still fits, then bring
              your draft up to date.
            </>
          ) : (
            ' None of your files were touched, so bringing it up to date is safe.'
          )}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                async () => void (await syncDraft(repo.id)),
                'Your draft is up to date',
                'Could not bring it up to date.',
              )
            }
            className="font-medium underline"
          >
            Bring it up to date
          </button>
          .
        </Alert>
      )}

      {query?.trim() ? (
        (() => {
          const hits = flatFiles(all).filter((n) => matches(query, n.path))
          return hits.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
              Nothing in your draft matches “{query.trim()}”.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
              {hits.map((node) => (
                <DraftNode
                  key={node.path}
                  node={node}
                  fullPath
                  readOnly={state.readOnly}
                  busy={busy}
                  behind={behind}
                  conflicts={conflicts}
                  mainOf={mainOf}
                  mainStorageOf={mainStorageOf}
                  onNavigate={onNavigate}
                  onOpen={onOpen}
                  onArchive={setArchiving}
                  onTrash={moveToTrash}
                  onSubmit={onSubmitTarget}
                  onShare={setSharing}
                  held={held}
                  links={links}
                  names={state.nameOf}
                  repoId={repo.id}
                  onGetTheirs={getTheirs}
                  onReplaceAnyway={replaceAnyway}
                  onCommit={mayCommit ? onCommitTarget : undefined}
                />
              ))}
            </ul>
          )
        })()
      ) : level.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
          This folder is empty. Use New to add a file or folder.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
          {level.map((node) => (
            <DraftNode
              key={node.path}
              node={node}
              readOnly={state.readOnly}
              busy={busy}
              behind={behind}
              conflicts={conflicts}
              mainOf={mainOf}
              mainStorageOf={mainStorageOf}
              onNavigate={onNavigate}
              onOpen={onOpen}
              onArchive={setArchiving}
              onTrash={moveToTrash}
              onSubmit={onSubmitTarget}
              onShare={setSharing}
              held={held}
              links={links}
              names={state.nameOf}
              repoId={repo.id}
              onGetTheirs={getTheirs}
              onReplaceAnyway={replaceAnyway}
              onCommit={mayCommit ? onCommitTarget : undefined}
            />
          ))}
        </ul>
      )}

      <SubmitDialog
        projectId={state.project?.id ?? ''}
        target={submitting}
        onClose={() => setSubmitting(null)}
        reviewers={state.members.filter(
          // Only people who can merge it onto Main.
          (member) =>
            member.user_id !== state.viewerId &&
            member.profile?.status !== 'rejected' &&
            state.commitRights.committers.includes(member.user_id),
        )}
        onSubmit={async (title, body, reviewerIds) => {
          if (!submitting) return
          try {
            if (submitting.type === 'folder') {
              await submitDraftFolder(repo.id, submitting.path, title, body, reviewerIds)
            } else {
              await submitDraftFile(repo.id, submitting.path, title, body, reviewerIds)
            }
          } catch (err) {
            throw plainStale(err)
          }
          show('Submitted for review')
          await onDone()
        }}
      />

      <ShareDialog repoId={repo.id} target={sharing} state={state} onClose={() => setSharing(null)} />

      <ConfirmDialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        onConfirm={() => {
          if (!asking) return
          if (asking.then === 'submit') setSubmitting(asking.target)
          else setCommitting(asking.target)
        }}
        title={asking?.paths.length === 1 ? `Check ${fileName(asking.paths[0])} first` : 'Check these Word files first'}
        body={
          <div className="space-y-3">
            {asking?.paths.map((p) => (
              <div key={p} className="space-y-1">
                <p className="font-mono text-[13px] text-ink">{p}</p>
                <p>{unknownCopyMessage(mainAtOf(p))}</p>
              </div>
            ))}
          </div>
        }
        confirmLabel="Continue"
        tone="primary"
      />

      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={async () => {
          if (!archiving) return
          await archiveDraftPath(repo.id, archiving.path, true)
          show(archiving.type === 'folder' ? 'Folder archived' : 'File archived')
          await onDone()
        }}
        title={`Archive ${archiving?.type ?? 'item'}?`}
        body="It leaves My draft and moves to the project archive. You can restore it there or delete it permanently."
        confirmLabel="Archive"
        tone="primary"
      />

      <ConfirmDialog
        open={committing !== null}
        onClose={() => {
          setCommitting(null)
          setTyped('')
        }}
        onConfirm={async () => {
          if (!committing) return
          await commitDraftPath(repo.id, committing.path, committing.type === 'folder').catch((err: unknown) => {
            throw plainStale(err)
          })
          show(committing.type === 'folder' ? 'Folder committed to Main' : 'File committed to Main')
          setTyped('')
          await onDone()
        }}
        title={`Commit this ${committing?.type ?? 'file'} to Main?`}
        body={
          <div className="space-y-3">
            <p>
              <span className="font-mono">{committing?.path}</span>
              {committing?.type === 'folder' ? ' and every file in it go' : ' goes'} straight to
              Main without a review and {committing?.type === 'folder' ? 'leave' : 'leaves'} My
              draft. History keeps the version before it.
            </p>
            <label htmlFor="commit-draft-name" className="block text-[13px] text-ink">
              Type <span className="font-mono font-medium">{baseName(committing)}</span> to confirm
            </label>
            <Input
              id="commit-draft-name"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        }
        confirmLabel="Commit to main"
        tone="primary"
        blocked={typed.trim() !== baseName(committing)}
      />

      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        onConfirm={async () => {
          await discardDraft(repo.id)
          show('Draft discarded')
          await onDone()
        }}
        title="Discard everything in your draft?"
        body={`${describeDraft(files)}. This cannot be undone, and nothing in Main changes.`}
        confirmLabel="Discard it all"
        tone="danger"
      />
    </div>
  )
}

function DraftNode({
  node,
  fullPath = false,
  readOnly,
  busy,
  behind,
  conflicts,
  mainOf,
  mainStorageOf,
  onNavigate,
  onOpen,
  onArchive,
  onTrash,
  onSubmit,
  onShare,
  onCommit,
  held,
  links,
  names,
  repoId,
  onGetTheirs,
  onReplaceAnyway,
}: {
  node: TreeNode
  fullPath?: boolean
  readOnly: boolean
  busy: boolean
  behind: boolean
  conflicts: DraftConflict[]
  mainOf: (path: string) => string
  /** The Storage object Main holds for a path, for Word files. */
  mainStorageOf: (path: string) => string | null
  onNavigate: (path: string) => void
  onOpen: (file: OpenFile) => void
  onArchive: (target: SubmitTarget) => void
  onTrash: (target: SubmitTarget) => void
  onSubmit: (target: SubmitTarget) => void
  onShare: (target: SubmitTarget) => void
  /** Only for whoever may commit to Main without a review. */
  onCommit?: (target: SubmitTarget) => void
  /** Word copies made from a version Main has moved past, by path. */
  held: Record<string, Held>
  links: Record<string, string>
  names: (id: string) => string
  repoId: string
  onGetTheirs: (file: GeneralDraftFile, verdict: Held) => Promise<void>
  onReplaceAnyway: (file: GeneralDraftFile, verdict: Held) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  if (node.type === 'folder') {
    const folderHeld = heldFolderReason(node.path, held)
    return (
      <li>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => onNavigate(node.path)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Icon name="folder" size={15} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
            <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
          </button>
          {!readOnly && (
            <ActionMenu
              label={`Actions for ${node.name}`}
              disabled={busy}
              items={[
                {
                  label: 'Submit for review',
                  icon: 'refresh',
                  disabled: behind || Boolean(folderHeld),
                  hint: folderHeld ?? undefined,
                  onSelect: () => onSubmit({ type: 'folder', path: node.path }),
                },
                ...(onCommit
                  ? [
                      {
                        label: 'Commit to main',
                        icon: 'check' as const,
                        disabled: behind || Boolean(folderHeld),
                        hint: folderHeld ?? undefined,
                        onSelect: () => onCommit({ type: 'folder', path: node.path }),
                      },
                    ]
                  : []),
                { label: 'Share', icon: 'users', onSelect: () => onShare({ type: 'folder', path: node.path }) },
                { label: 'Archive', icon: 'archive', onSelect: () => onArchive({ type: 'folder', path: node.path }) },
                { label: 'Move to trash', icon: 'trash', tone: 'danger', separated: true, onSelect: () => onTrash({ type: 'folder', path: node.path }) },
              ]}
            />
          )}
        </div>
      </li>
    )
  }

  const f = node.file as unknown as GeneralDraftFile
  const clashing = conflicts.some((c) => c.path === f.path)
  const hold = held[f.path]
  // A held file goes nowhere until it is combined or knowingly replaced.
  const stuck = behind || Boolean(hold)

  return (
    <li>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
            {fullPath ? f.path : node.name}
          </span>
        </button>
        <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
          {FILE_ACTION_LABEL[f.action]}
        </span>
        {clashing && (
          <span className="shrink-0 rounded-md bg-amber-400/25 px-2 py-0.5 text-[12px] font-medium text-amber-800 dark:text-amber-200">
            Changed in Main
          </span>
        )}
        {hold && (
          <span className="shrink-0 rounded-md bg-warning-50 px-2 py-0.5 text-[12px] font-medium text-warning-800 dark:bg-warning-400/15 dark:text-warning-300">
            Held
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onOpen({
              path: f.path,
              kind: f.kind,
              content: f.content,
              storagePath: f.storage_path,
              action: f.action,
              fromDraft: true,
            })
          }
        >
          Open
        </Button>
        {!readOnly && (
          <ActionMenu
            label={`Actions for ${node.name}`}
            disabled={busy}
            items={[
              { label: 'Submit for review', icon: 'refresh', disabled: stuck, onSelect: () => onSubmit({ type: 'file', path: f.path }) },
              ...(onCommit
                ? [{ label: 'Commit to main', icon: 'check' as const, disabled: stuck, onSelect: () => onCommit({ type: 'file', path: f.path }) }]
                : []),
              // A removal has nothing in it to pass on.
              ...(f.action !== 'removed'
                ? [{ label: 'Share', icon: 'users' as const, onSelect: () => onShare({ type: 'file', path: f.path }) }]
                : []),
              { label: 'Archive', icon: 'archive', onSelect: () => onArchive({ type: 'file', path: f.path }) },
              { label: 'Move to trash', icon: 'trash', tone: 'danger', separated: true, onSelect: () => onTrash({ type: 'file', path: f.path }) },
            ]}
          />
        )}
      </div>
      {hold && !readOnly && (
        <div className="px-4 pb-3 sm:px-5">
          <HeldPush
            state={hold}
            blockedUrl={links[f.path] ?? null}
            path={f.path}
            repoId={repoId}
            names={names}
            onGetTheirs={() => onGetTheirs(f, hold)}
            onReplaceAnyway={() => onReplaceAnyway(f, hold)}
          />
        </div>
      )}
      {open && (
        <div className="px-4 pb-4 sm:px-5">
          {f.kind === 'binary' && isPreviewableWord(f.path) ? (
            <WordDiff
              key={`${f.path}:${f.storage_path}`}
              before={f.action === 'added' ? null : mainStorageOf(f.path)}
              after={f.action === 'removed' ? null : f.storage_path}
              caption={`What your draft would do to ${f.path}, by its words`}
            />
          ) : f.kind === 'binary' ? (
            <p className="text-[12px] text-muted">
              An uploaded file. Its contents are not compared here.
            </p>
          ) : (
            <DiffView
              before={f.action === 'added' ? '' : fileText(f.kind, mainOf(f.path))}
              after={f.action === 'removed' ? '' : fileText(f.kind, f.content)}
              caption={`What your draft would do to ${f.path}, line by line`}
            />
          )}
        </div>
      )}
    </li>
  )
}

function SubmitDialog({
  projectId,
  target,
  onClose,
  reviewers,
  onSubmit,
}: {
  projectId: string
  target: SubmitTarget | null
  onClose: () => void
  reviewers: GeneralProjectState['members']
  onSubmit: (title: string, body: string, reviewerIds: string[]) => Promise<void>
}) {
  const allId = useId()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [describing, setDescribing] = useState(false)
  const options = reviewers.map((member) => ({
    id: member.user_id,
    label: member.profile ? fullName(member.profile) : 'A member',
  }))
  const everyone = options.length > 0 && picked.length === options.length

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={`Submit this ${target?.type ?? 'file'}`}
      description={target ? `${target.path} goes over as one change.` : undefined}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              if (!title.trim()) return setError('Say what this change is, in a few words.')
              if (picked.length === 0) return setError('Choose at least one member to review this.')
              setError(null)
              setBusy(true)
              try {
                await onSubmit(title, body, picked)
                setTitle('')
                setBody('')
                setPicked([])
                onClose()
              } catch (err) {
                setError(authErrorMessage(err, 'Could not submit it.'))
              } finally {
                setBusy(false)
              }
            }}
          >
            Submit for review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="What this change is">
          {(id) => (
            <Input
              id={id}
              maxLength={200}
              placeholder="Rewrote chapter 3 after the adviser's comments"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Button
          size="sm"
          variant="outline"
          loading={describing}
          onClick={async () => {
            if (!target) return
            setDescribing(true)
            setError(null)
            try {
              const res = await writeChangeMessage(projectId, { paths: [target.path] })
              if (res.result !== 'ok') return setError(res.message)
              setTitle(res.title)
              if (!body.trim()) setBody(res.message)
            } catch (err) {
              setError(authErrorMessage(err, 'Could not describe it. Write it yourself, or try again.'))
            } finally {
              setDescribing(false)
            }
          }}
        >
          {!describing && <Icon name="spark" size={14} />}
          Describe it for me
        </Button>
        <Field label="Anything the reviewer should know" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={20000}
              placeholder="What you were unsure about, or what you would like them to look at."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        {options.length === 0 ? (
          <Alert tone="error">Add another project member before submitting for review.</Alert>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">Who should review this?</p>
            <p className="text-[12px] text-muted">
              Pick one member, several, or everyone. Any one of them can approve or decline it, and
              the first to answer decides.
            </p>
            <label
              htmlFor={allId}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-2 py-2 text-[13px] font-medium text-ink hover:bg-[var(--surface-sunken)]"
            >
              <input
                id={allId}
                type="checkbox"
                checked={everyone}
                onChange={() => setPicked(everyone ? [] : options.map((o) => o.id))}
                className="h-4 w-4 shrink-0 accent-navy-600"
              />
              All members
              <span className="ml-auto font-mono text-[11px] text-faint">{options.length}</span>
            </label>
            <CheckboxList items={options} selected={picked} onChange={setPicked} label="Reviewers" searchable />
          </div>
        )}
      </div>
    </Modal>
  )
}
