import { useCallback, useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { fileVersions, restoreFile, restoreToDraft, revertCommit } from '../../lib/api/fileHistory'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { laterEdits, putBack, putBackTarget, stateBefore } from '../../lib/general/fileHistory'
import { FILE_ACTION_LABEL } from '../../lib/general/types'
import type { GeneralBlob, GeneralCommit, GeneralDraftFile, GeneralRepoSummary } from '../../lib/general/types'
import { PutBackDialog } from './PutBackDialog'
import { VersionDiff } from './VersionDiff'
import type { GeneralProjectState } from './useGeneralProject'

type Version = GeneralBlob & { commit: GeneralCommit }

type Asking =
  | { kind: 'restore'; version: Version }
  | { kind: 'undo'; version: Version; changedSince: string[] }

/**
 * One file's own history: every version Main has had of it, newest first, each
 * opening to what it changed. Whoever holds `commit_main` restores a version or
 * undoes a change straight into Main; everyone else with a draft does it in their
 * draft. A stakeholder, a class's teacher and a read-only viewer only look.
 */
export function FileHistoryPanel({
  repo,
  path,
  state,
  draftFiles,
  onDone,
  onClose,
}: {
  repo: GeneralRepoSummary
  path: string
  state: GeneralProjectState
  draftFiles: GeneralDraftFile[]
  /** After a restore or an undo lands. */
  onDone: () => void | Promise<void>
  onClose: () => void
}) {
  const { show } = useToast()
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [checking, setChecking] = useState<number | null>(null)
  const to = putBackTarget(state)
  const toMain = to === 'main'

  const load = useCallback(async () => {
    try {
      setVersions(await fileVersions(repo.id, path))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [repo.id, path])

  useEffect(() => {
    void load()
  }, [load])

  // Later edits are checked against a fresh list so the dialog can name them; the database refuses the same case.
  async function askUndo(version: Version) {
    setChecking(version.seq)
    try {
      const fresh = await fileVersions(repo.id, path)
      setVersions(fresh)
      setAsking({ kind: 'undo', version, changedSince: laterEdits(fresh, version.seq) })
    } catch (err) {
      show(authErrorMessage(err, 'The file history did not load. Try again in a moment.'), 'error')
    } finally {
      setChecking(null)
    }
  }

  async function confirm(message: string) {
    if (!asking || !versions) return
    const { version } = asking
    const current = versions[0] ?? null
    try {
      if (asking.kind === 'restore') {
        if (putBack(version, current) === null) {
          throw new Error(`${path} is already as it was at #${version.seq}. Pick another version.`)
        }
        if (toMain) {
          await restoreFile(repo.id, path, version.seq, repo.commit_count, message)
          show(`Restored ${path} to #${version.seq}`)
        } else {
          await restoreToDraft({
            repoId: repo.id,
            projectId: version.project_id,
            path,
            target: version,
            mainHas: current !== null && current.action !== 'removed',
          })
          show(`Put ${path} from #${version.seq} in your draft`)
        }
      } else if (toMain) {
        await revertCommit(version.commit.id, repo.commit_count, path, message)
        show(`Reverted #${version.seq}`)
      } else {
        const target = stateBefore(versions, version.seq)
        if (putBack(target, current) === null) {
          throw new Error(`Nothing to revert. ${path} is already as it was before #${version.seq}.`)
        }
        await restoreToDraft({
          repoId: repo.id,
          projectId: version.project_id,
          path,
          target,
          mainHas: current !== null && current.action !== 'removed',
        })
        show(`Put #${version.seq} back in your draft`)
      }
    } catch (err) {
      // A later commit means this list is behind: reload it under the error.
      void load()
      throw err
    }
    await onDone()
  }

  const restoreLabel = toMain ? 'Restore this version' : 'Restore to my draft'
  const undoLabel = toMain ? 'Undo this change' : 'Undo in my draft'

  return (
    <aside
      aria-label={`History of ${path}`}
      className="min-w-0 rounded-panel border border-line surface md:sticky md:top-0 md:max-h-[calc(80vh/var(--zoom,1))] md:overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <p className="eyebrow">History</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the history"
          title="Close the history"
          className="-mr-1 grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {failed ? (
        <div className="p-3">
          <Alert tone="error" onRetry={load}>
            The file history did not load. Try again in a moment.
          </Alert>
        </div>
      ) : !versions ? (
        <div className="flex items-center gap-2 px-3.5 py-4 text-[12px] text-muted">
          <Spinner size={13} />
          Loading the file's history…
        </div>
      ) : versions.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[12px] text-muted">Main has no versions of this file yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {versions.map((v, i) => {
            const expanded = open === v.seq
            const mayRestore = to !== null && i > 0 && v.action !== 'removed'
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : v.seq)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <span className="w-8 shrink-0 pt-px font-mono text-[12px] text-faint">#{v.seq}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{v.commit.message}</span>
                    <span className="block text-[12px] text-faint">
                      {v.commit.author_id ? state.nameOf(v.commit.author_id) : 'A former member'} ·{' '}
                      {formatDue(v.commit.created_at)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <span className="rounded-md surface-sunken px-1.5 py-0.5 text-[11px] text-muted">
                        {FILE_ACTION_LABEL[v.action]}
                      </span>
                      {i === 0 && (
                        <span className="rounded-md bg-navy-50 px-1.5 py-0.5 text-[11px] font-medium text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
                          Current
                        </span>
                      )}
                    </span>
                  </span>
                  <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={15} className="mt-0.5 shrink-0 text-faint" />
                </button>
                {expanded && (
                  <div className="space-y-3 px-3.5 pb-3.5">
                    {to && (
                      <div className="flex flex-wrap items-center gap-2">
                        {mayRestore && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${restoreLabel}: #${v.seq}`}
                            disabled={checking !== null}
                            onClick={() => setAsking({ kind: 'restore', version: v })}
                          >
                            {restoreLabel}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${undoLabel}: #${v.seq}`}
                          loading={checking === v.seq}
                          disabled={checking !== null}
                          onClick={() => void askUndo(v)}
                        >
                          {undoLabel}
                        </Button>
                      </div>
                    )}
                    <VersionDiff file={v} commitSeq={v.commit.seq} before={stateBefore(versions, v.seq)?.content ?? ''} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {asking && (
        <PutBackDialog
          title={
            asking.kind === 'restore'
              ? `Restore ${path} to #${asking.version.seq}${toMain ? '' : ' in your draft'}?`
              : `Undo #${asking.version.seq} on ${path}${toMain ? '' : ' in your draft'}?`
          }
          files={[path]}
          replacesDraft={!toMain && draftFiles.some((f) => f.path === path) ? [path] : []}
          changedSince={asking.kind === 'undo' ? asking.changedSince : []}
          toMain={toMain}
          lead={
            asking.kind === 'restore'
              ? toMain
                ? `This file goes back to how it was at #${asking.version.seq}, in a new commit for everyone on the project. History keeps every version.`
                : `This file goes back to how it was at #${asking.version.seq}, in your draft. Main does not change until your draft is reviewed.`
              : undefined
          }
          defaultMessage={
            asking.kind === 'restore'
              ? `Restore ${path} to #${asking.version.seq}`
              : `Undo #${asking.version.seq} on ${path}`
          }
          onConfirm={confirm}
          onClose={() => setAsking(null)}
        />
      )}
    </aside>
  )
}
