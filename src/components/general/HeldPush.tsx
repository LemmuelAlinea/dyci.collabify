import { useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { storagePathAt } from '../../lib/api/general'
import { formatDue } from '../../lib/general/dates'
import { isComparableExcel, isExcelPath, isPreviewableWord } from '../../lib/general/files'
import type { PushVerdict } from '../../lib/general/pushCheck'
import { ExcelDiff } from './ExcelDiff'
import { WordDiff } from './WordDiff'

/**
 * A Word or Excel upload made from a copy Main has moved past. Collabify cannot
 * merge two Office files, so it holds the push: the person gets the newer version,
 * combines the two in Word or Excel, and uploads again, or replaces it knowingly.
 */
export function HeldPush({
  state,
  path,
  repoId,
  names,
  blockedUrl = null,
  onGetTheirs,
  onReplaceAnyway,
}: {
  state: PushVerdict & { kind: 'held' }
  path: string
  /** Given, a .docx shows the words that changed in Main since the pulled copy. */
  repoId?: string
  names: (id: string) => string
  /** The newer version's link, when the browser blocked the tab it was opening in. */
  blockedUrl?: string | null
  /** Called inside the click, so it can open its download tab before anything is awaited. */
  onGetTheirs: () => void | Promise<void>
  onReplaceAnyway: () => void | Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  // One download at a time: a double click must not record two pulls.
  const getting = useRef(false)
  const [busy, setBusy] = useState(false)
  const who = state.by ? names(state.by) : 'Someone'
  const whose = state.by ? `${who}'s` : 'their'
  const when = state.at ? `, ${formatDue(state.at)}` : ''
  const compare = Boolean(repoId) && !state.removed && (isPreviewableWord(path) || isComparableExcel(path))
  const Diff = isComparableExcel(path) ? ExcelDiff : WordDiff
  const how = isComparableExcel(path) ? 'by its cells' : 'by its words'
  const downloadLabel = `Download ${state.by ? `${who}'s` : 'the newer'} version`

  function getTheirs() {
    if (getting.current) return
    getting.current = true
    setBusy(true)
    // Called right here, inside the click, so its tab opens before anything is awaited.
    void new Promise<void>((resolve) => resolve(onGetTheirs()))
      .catch(() => {})
      .finally(() => {
        getting.current = false
        setBusy(false)
      })
  }

  return (
    <section className="space-y-3 rounded-xl border border-warning-300 bg-warning-50 px-3.5 py-3 text-[13px] text-warning-800 dark:border-warning-400/40 dark:bg-warning-400/15 dark:text-warning-300">
      <div className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          {state.removed ? (
            <>
              <p className="font-medium">
                {who} removed this file since you pulled{when}.
              </p>
              <p>Uploading yours puts it back in Main as a new file.</p>
            </>
          ) : (
            <>
              <p className="font-medium">
                {who} updated this since you pulled{when}.
              </p>
              <p>
                Download {whose} version and combine the two in{' '}
                {isExcelPath(path) ? 'Excel' : 'Word (Review, Compare, Combine)'}, then upload the result here.
              </p>
            </>
          )}
        </div>
      </div>

      {blockedUrl && (
        <p>
          Your browser blocked the download.{' '}
          <a href={blockedUrl} target="_blank" rel="noopener" className="font-medium underline">
            {downloadLabel}
          </a>
        </p>
      )}

      {compare && repoId && (
        <div className="rounded-lg border border-line surface px-3 py-2.5 text-ink">
          <Diff
            key={`${repoId}:${path}:${state.baseSeq}:${state.mainSeq}`}
            before={() => storagePathAt(repoId, path, state.baseSeq)}
            after={() => storagePathAt(repoId, path, state.mainSeq)}
            caption={`What ${who} changed in ${path}, ${how}`}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!state.removed && (
          <Button type="button" size="sm" loading={busy} onClick={getTheirs}>
            {!busy && <Icon name="download" size={14} />}
            {downloadLabel}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Replace it anyway
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await onReplaceAnyway()
        }}
        title={state.removed ? 'Put the file back?' : `Replace ${whose} version?`}
        body={
          state.removed
            ? `${who} removed ${path} from Main. Your upload brings it back as it is in your copy.`
            : `${whose.charAt(0).toUpperCase()}${whose.slice(1)} changes to ${path} since your copy will not be in the new version. History keeps ${whose} version.`
        }
        confirmLabel={state.removed ? 'Put it back' : 'Replace it'}
        tone="danger"
      />
    </section>
  )
}
