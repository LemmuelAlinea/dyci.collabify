import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { attachmentUrl } from '../../lib/api/announcements'
import { authErrorMessage } from '../../lib/authError'
import { formatBytes } from '../../lib/formatBytes'
import type { Announcement } from '../../lib/types'

/** One file on an announcement. Opens through a short-lived signed link. */
export function AttachmentRow({ attachment }: { attachment: Announcement['attachments'][number] }) {
  const { show } = useToast()
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          window.open(await attachmentUrl(attachment), '_blank', 'noopener')
        } catch (err) {
          show(authErrorMessage(err, 'Could not open that file.'), 'error')
        }
      }}
      className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-sunken)]"
    >
      <Icon name="file" size={17} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{attachment.file_name}</span>
      <span className="shrink-0 text-[12px] text-faint">{formatBytes(attachment.size_bytes)}</span>
    </button>
  )
}
