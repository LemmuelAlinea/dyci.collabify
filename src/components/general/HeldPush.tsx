import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { storagePathAt } from '../../lib/api/general'
import { formatDue } from '../../lib/general/dates'
import { isPreviewableWord } from '../../lib/general/files'
import type { PushVerdict } from '../../lib/general/pushCheck'
import { WordDiff } from './WordDiff'

/**
 * A Word upload made from a copy Main has moved past. Collabify cannot merge
 * two Word files, so it holds the push: the person gets the newer version,
 * combines the two in Word, and uploads again, or replaces it knowingly.
 */
export function HeldPush({
  state,
  path,
  repoId,
  names,
  onGetTheirs,
  onReplaceAnyway,
}: {
  state: PushVerdict & { kind: 'held' }
  path: string
  /** Given, a .docx shows the words that changed in Main since the pulled copy. */
  repoId?: string
  names: (id: string) => string
  onGetTheirs: () => void | Promise<void>
  onReplaceAnyway: () => void | Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const who = state.by ? names(state.by) : 'Someone'
  const whose = state.by ? `${who}'s` : 'their'
  const when = state.at ? `, ${formatDue(state.at)}` : ''
  const compare = Boolean(repoId) && !state.removed && isPreviewableWord(path)

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
                Download {whose} version and combine the two in Word (Review, Compare, Combine), then upload
                the result here.
              </p>
            </>
          )}
        </div>
      </div>

      {compare && repoId && (
        <div className="rounded-lg border border-line surface px-3 py-2.5 text-ink">
          <WordDiff
            key={`${repoId}:${path}:${state.baseSeq}:${state.mainSeq}`}
            before={() => storagePathAt(repoId, path, state.baseSeq)}
            after={() => storagePathAt(repoId, path, state.mainSeq)}
            caption={`What ${who} changed in ${path}, by its words`}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!state.removed && (
          <Button size="sm" onClick={() => void onGetTheirs()}>
            <Icon name="download" size={14} />
            Download {state.by ? `${who}'s` : 'the newer'} version
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
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
