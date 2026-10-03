import { useState } from 'react'
import type { ReactNode } from 'react'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import { Linkify } from '../ui/Linkify'
import { Modal } from '../ui/Modal'
import { DriveLinkCards } from '../ui/DriveLinkCards'
import { AttachmentRow } from './AttachmentRow'
import { LinkList } from './AnnouncementLinks'
import type { Announcement, AnnouncementLink } from '../../lib/types'

/** What the dialog needs, whether it came from a class or from the program office. */
export type AnnouncementView = {
  /** The small line above the title, e.g. the class. */
  eyebrow?: string
  title: string
  body: string
  pinned?: boolean
  authorName?: string
  authorAvatar?: string | null
  when: string
  edited?: boolean
  links?: AnnouncementLink[]
  attachments?: Announcement['attachments']
  /** A professor opens linked tasks in their own view. */
  teacher?: boolean
}

/**
 * The whole announcement, for when the card on the page only shows the start.
 *
 * Everything the card hides is here: the full message, the Drive previews, the
 * links to projects and tasks, and the files.
 */
export function AnnouncementDialog({
  view,
  onClose,
  footer,
}: {
  view: AnnouncementView | null
  onClose: () => void
  footer?: ReactNode
}) {
  // Keep what was on show while the dialog fades out, so the text does not
  // empty before the panel has gone.
  const [shown, setShown] = useState<AnnouncementView | null>(view)
  // Callers build `view` inline, so it is a new object every render; compare
  // what it says, or this would set state on every pass.
  if (view && (view.title !== shown?.title || view.body !== shown?.body || view.when !== shown?.when)) {
    setShown(view)
  }
  const v = view ?? shown

  return (
    <Modal open={view !== null} onClose={onClose} title={v?.title ?? 'Announcement'} size="lg" footer={footer}>
      {v && (
        <div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-faint">
            {v.eyebrow && <span className="eyebrow text-amber-500 dark:text-amber-300">{v.eyebrow}</span>}
            {v.pinned && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-400/18 px-2 py-0.5 font-mono text-[12px] text-warning-700 dark:text-warning-300">
                <Icon name="pin" size={11} />
                Pinned
              </span>
            )}
            {v.authorName && (
              <span className="flex items-center gap-2">
                <Avatar
                  profile={{
                    first_name: v.authorName.split(' ')[0] ?? '',
                    last_name: v.authorName.split(' ').slice(1).join(' '),
                    avatar_url: v.authorAvatar ?? null,
                  }}
                  size={20}
                />
                {v.authorName}
              </span>
            )}
            <span>{v.when}</span>
            {v.edited && <span className="italic">· edited</span>}
          </div>

          <p className="mt-4 text-[14.5px] leading-relaxed whitespace-pre-wrap text-ink">
            <Linkify text={v.body} />
          </p>
          <DriveLinkCards text={v.body} className="mt-4" />

          <LinkList links={v.links ?? []} teacher={Boolean(v.teacher)} />

          {(v.attachments?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              {v.attachments?.map((att) => <AttachmentRow key={att.id} attachment={att} />)}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
