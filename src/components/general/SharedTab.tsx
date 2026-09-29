import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ActionMenu } from '../ui/ActionMenu'
import type { ActionMenuItem } from '../ui/ActionMenu'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useLive } from '../../hooks/useLive'
import { copyShareToDraft, dismissShare, getRepo, listShares, unshareShare } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { buildTree, fileName, nodesAt, shownFiles } from '../../lib/general/files'
import { downloadBlob } from '../../lib/general/office'
import { repoFileAsUpload } from '../../lib/general/repoAttach'
import { matches } from '../../lib/general/search'
import type { GeneralRepoSummary, GeneralShare, GeneralSharedFile, GeneralTreeFile } from '../../lib/general/types'
import { FILE_KIND_LABEL } from '../../lib/general/types'
import { zipFolder } from '../../lib/general/zipFolder'
import { FileEditor } from './FileEditor'
import type { OpenFile } from './FileEditor'
import { FolderBar } from './FolderBar'
import type { GeneralProjectState } from './useGeneralProject'

const asTree = (files: GeneralSharedFile[]) => files as unknown as GeneralTreeFile[]

/**
 * Copies of draft files and folders teammates passed to the viewer, and the
 * ones the viewer passed on. A share is fixed as it was when sent: it can be
 * read, downloaded or copied into your own draft, never changed in place.
 */
export function SharedTab({ state }: { state: GeneralProjectState }) {
  const projectId = state.project?.id
  const viewerId = state.viewerId
  const { show } = useToast()
  const [repo, setRepo] = useState<GeneralRepoSummary | null>(null)
  const [shares, setShares] = useState<GeneralShare[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<OpenFile | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sentOpen, setSentOpen] = useState(false)
  const [params, setParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [r, s] = await Promise.all([getRepo(projectId), listShares(projectId)])
      setRepo(r)
      setShares(s)
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

  useLive(load, ['general_shares', 'general_share_recipients'])

  const browsing = shares.find((s) => s.id === params.get('share') && s.type === 'folder') ?? null
  const folder = browsing ? params.get('spath') || browsing.path : ''

  function browse(share: GeneralShare | null, path = '') {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (share && path && (path === share.path || path.startsWith(`${share.path}/`))) {
        next.set('share', share.id)
        next.set('spath', path)
      } else {
        next.delete('share')
        next.delete('spath')
      }
      return next
    })
  }

  const senderLabel = (share: GeneralShare) => (share.sender_id === viewerId ? 'you' : state.nameOf(share.sender_id))

  function openFile(share: GeneralShare, file: GeneralSharedFile) {
    setOpen({
      path: file.path,
      kind: file.kind,
      content: file.content,
      storagePath: file.storage_path,
      action: 'changed',
      fromDraft: false,
      sharedBy: senderLabel(share),
    })
  }

  async function run(id: string, action: () => Promise<string | void>, failedMessage: string) {
    if (busy) return
    setBusy(id)
    try {
      const done = await action()
      if (done) show(done)
      await load()
    } catch (err) {
      show(authErrorMessage(err, failedMessage), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function download(share: GeneralShare, path: string) {
    const single = share.type === 'file'
    await run(
      share.id,
      async () => {
        if (single) {
          const file = await repoFileAsUpload(asTree(share.files)[0])
          downloadBlob(file, file.name)
        } else {
          const blob = await zipFolder(asTree(share.files), path)
          downloadBlob(blob, `${fileName(path).replace(/[/:*?"<>|]+/g, ' ').trim() || 'Shared'}.zip`)
        }
      },
      'Could not prepare that download. Try again in a moment.',
    )
  }

  function copy(share: GeneralShare) {
    void run(
      share.id,
      async () => {
        await copyShareToDraft(share.id)
        return `Copied to your draft. Find it under My draft in Files.`
      },
      'Could not copy it to your draft. Try again in a moment.',
    )
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading what is shared…
      </div>
    )
  }

  if (failed) {
    return (
      <Alert tone="error" onRetry={load}>
        What is shared with you did not load. Try again in a moment.
      </Alert>
    )
  }

  const received = shares.filter((s) => s.sender_id !== viewerId && viewerId && s.recipient_ids.includes(viewerId))
  const sent = shares.filter((s) => s.sender_id === viewerId)
  const mayCopy = !state.archived
  const hit = (s: GeneralShare) =>
    matches(query, s.path, state.nameOf(s.sender_id), ...s.recipient_ids.map((id) => state.nameOf(id)))

  function menu(share: GeneralShare, mine: boolean): ActionMenuItem[] {
    return [
      share.type === 'file'
        ? { label: 'Open', icon: 'eye', onSelect: () => openFile(share, share.files[0]) }
        : { label: 'Open folder', icon: 'folder', onSelect: () => browse(share, share.path) },
      {
        label: share.type === 'file' ? 'Download' : 'Download as zip',
        icon: 'download',
        onSelect: () => void download(share, share.path),
      },
      ...(!mine && mayCopy ? [{ label: 'Copy to my draft', icon: 'copy' as const, onSelect: () => copy(share) }] : []),
      mine
        ? {
            label: 'Stop sharing',
            icon: 'x',
            separated: true,
            onSelect: () =>
              void run(share.id, async () => {
                await unshareShare(share.id)
                return 'Stopped sharing it'
              }, 'Could not stop sharing it. Try again in a moment.'),
          }
        : {
            label: 'Remove from my list',
            icon: 'x',
            separated: true,
            onSelect: () =>
              void run(share.id, async () => {
                await dismissShare(share.id)
                return 'Removed from your list'
              }, 'Could not remove it. Try again in a moment.'),
          },
    ]
  }

  const editor = repo && (
    <FileEditor file={open} repo={repo} state={state} onClose={() => setOpen(null)} onSaved={load} />
  )

  if (browsing) {
    const mine = browsing.sender_id === viewerId
    const level = nodesAt(buildTree(asTree(browsing.files)), folder) ?? []
    return (
      <div className="space-y-4">
        <Header />
        <FolderBar
          rootLabel="Shared with me"
          path={folder}
          onNavigate={(p) => browse(browsing, p)}
          actions={
            <>
              <Button size="sm" variant="ghost" loading={busy === browsing.id} onClick={() => void download(browsing, folder)}>
                {busy !== browsing.id && <Icon name="download" size={14} />}
                Download
              </Button>
              {!mine && mayCopy && (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => copy(browsing)}>
                  <Icon name="copy" size={14} />
                  Copy to my draft
                </Button>
              )}
            </>
          }
        />
        <p className="text-[12px] text-muted">
          Shared by {senderLabel(browsing)} · {formatDue(browsing.created_at)}. A copy as it was then.
        </p>
        {level.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
            This folder is empty.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
            {level.map((node) => (
              <li key={node.path}>
                <button
                  type="button"
                  onClick={() =>
                    node.type === 'folder'
                      ? browse(browsing, node.path)
                      : openFile(browsing, node.file as unknown as GeneralSharedFile)
                  }
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <Icon name={node.type === 'folder' ? 'folder' : 'file'} size={15} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{node.name}</span>
                  {node.type === 'folder' ? (
                    <>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{node.fileCount}</span>
                      <Icon name="chevronRight" size={14} className="shrink-0 text-faint" />
                    </>
                  ) : (
                    <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
                      {FILE_KIND_LABEL[node.file.kind]}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {editor}
      </div>
    )
  }

  const receivedShown = received.filter(hit)
  const sentShown = sent.filter(hit)

  return (
    <div className="space-y-4">
      <Header />
      <Input
        icon="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search what is shared"
        aria-label="Search what is shared"
        className="max-w-md"
      />

      {receivedShown.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line px-4 py-10 text-center">
          <Icon name="users" size={26} className="mx-auto text-faint" />
          <p className="mx-auto mt-3 max-w-[32rem] text-[13px] text-muted">
            {query.trim()
              ? `Nothing shared with you matches “${query.trim()}”.`
              : 'Nothing is shared with you yet. When a teammate shares a file or folder from their draft, it shows here.'}
          </p>
        </div>
      ) : (
        <ShareList
          shares={receivedShown}
          busy={busy}
          detail={(s) => `From ${state.nameOf(s.sender_id)} · ${formatDue(s.created_at)}`}
          onOpen={(s) => (s.type === 'file' ? openFile(s, s.files[0]) : browse(s, s.path))}
          menu={(s) => menu(s, false)}
        />
      )}

      {sentShown.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setSentOpen(!sentOpen)}
            aria-expanded={sentOpen}
            className="mb-2 flex items-center gap-2 text-left"
          >
            <Icon name={sentOpen ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
            <h3 className="text-[14px]">Shared by me</h3>
            <span className="rounded-full surface-sunken px-2 py-0.5 font-mono text-[11px] text-muted">{sentShown.length}</span>
          </button>
          {sentOpen && (
            <ShareList
              shares={sentShown}
              busy={busy}
              detail={(s) => `To ${s.recipient_ids.map((id) => state.nameOf(id)).join(', ')} · ${formatDue(s.created_at)}`}
              onOpen={(s) => (s.type === 'file' ? openFile(s, s.files[0]) : browse(s, s.path))}
              menu={(s) => menu(s, true)}
            />
          )}
        </section>
      )}

      {editor}
    </div>
  )
}

function Header() {
  return (
    <header className="min-w-0">
      <h2>Shared with me</h2>
      <p className="mt-0.5 text-[12px] text-muted">
        Files and folders your teammates shared from their drafts. Each is a copy as it was when
        shared.
      </p>
    </header>
  )
}

function ShareList({
  shares,
  busy,
  detail,
  onOpen,
  menu,
}: {
  shares: GeneralShare[]
  busy: string | null
  detail: (share: GeneralShare) => string
  onOpen: (share: GeneralShare) => void
  menu: (share: GeneralShare) => ActionMenuItem[]
}) {
  return (
    <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-panel border border-line surface">
      {shares.map((s) => {
        const count = shownFiles(s.files).shown.length
        return (
          <li key={s.id} className="flex items-center gap-2 px-4 py-2.5">
            <button type="button" onClick={() => onOpen(s)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <Icon name={s.type === 'folder' ? 'folder' : 'file'} size={15} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px] text-ink">{fileName(s.path)}</span>
                <span className="block truncate text-[12px] text-faint">{detail(s)}</span>
              </span>
              {s.type === 'folder' ? (
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  {count} {count === 1 ? 'file' : 'files'}
                </span>
              ) : (
                <span className="shrink-0 rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
                  {FILE_KIND_LABEL[s.files[0]?.kind ?? 'text']}
                </span>
              )}
            </button>
            {busy === s.id ? (
              <Spinner size={14} />
            ) : (
              <ActionMenu label={`Actions for ${fileName(s.path)}`} disabled={busy !== null} items={menu(s)} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
