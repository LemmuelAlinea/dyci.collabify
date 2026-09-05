import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import { Avatar } from '../app/Avatar'
import { Icon } from '../ui/Icon'
import type { Announcement, ClassSummary } from '../../lib/types'

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * One announcement at a time. The browser does the swiping — scroll snap gives
 * touch momentum and keyboard scrolling for free — and nothing ever advances on
 * its own, so a card cannot slide away mid-sentence.
 */
export function AnnouncementSwiper({
  announcements,
  classes,
  linkBase,
}: {
  announcements: Announcement[]
  classes: ClassSummary[]
  linkBase: string
}) {
  const track = useRef<HTMLUListElement>(null)
  const [index, setIndex] = useState(0)
  const reduce = useReducedMotion()

  const go = useCallback(
    (next: number) => {
      const el = track.current
      if (!el) return
      const clamped = Math.max(0, Math.min(announcements.length - 1, next))
      // Measured off the card itself. Multiplying the index by the track width
      // ignores the gap between cards and drifts one gap further out each time.
      const card = el.children[clamped] as HTMLElement | undefined
      if (!card) return
      el.scrollTo({
        left: card.offsetLeft - el.offsetLeft,
        behavior: reduce ? 'auto' : 'smooth',
      })
      setIndex(clamped)
    },
    [announcements.length, reduce],
  )

  // The dots follow the scroll position rather than the other way round, so a
  // swipe and a button press stay in agreement.
  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Nearest card by its real offset, for the same reason as go().
        const cards = [...el.children] as HTMLElement[]
        let nearest = 0
        let best = Infinity
        cards.forEach((card, i) => {
          const distance = Math.abs(card.offsetLeft - el.offsetLeft - el.scrollLeft)
          if (distance < best) {
            best = distance
            nearest = i
          }
        })
        setIndex(nearest)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  if (announcements.length === 0) return null

  const nameOf = (classId: string) => classes.find((c) => c.id === classId)

  return (
    <div className="relative">
      <ul
        ref={track}
        tabIndex={0}
        aria-label="Announcements"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            go(index + 1)
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            go(index - 1)
          }
        }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto rounded-card focus-visible:ring-4 focus-visible:ring-navy-500/12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {announcements.map((a) => {
          const cls = nameOf(a.class_id)
          return (
            <li key={a.id} className="w-full shrink-0 snap-start">
              <Link
                to={`${linkBase}/${a.class_id}`}
                className="surface flex h-full flex-col rounded-card border border-line p-4 sm:p-5 shadow-card transition-colors hover:border-line-strong sm:p-6"
              >
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="eyebrow text-amber-500 dark:text-amber-300">
                    {cls ? `${cls.initial} · ${cls.name}` : 'Class'}
                  </span>
                  {a.pinned && (
                    <span className="flex items-center gap-1 rounded-full bg-amber-400/18 px-2 py-0.5 font-mono text-[12px] text-amber-700 dark:text-amber-300">
                      <Icon name="pin" size={11} />
                      Pinned
                    </span>
                  )}
                </div>

                <h3 className="mt-2.5 leading-snug">{a.title}</h3>
                <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-muted">
                  {a.body}
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-[12px] text-faint">
                  {a.author && (
                    <span className="flex items-center gap-2">
                      <Avatar profile={a.author} size={22} />
                      {a.author.first_name} {a.author.last_name}
                    </span>
                  )}
                  <span className="font-mono">{ago(a.created_at)}</span>
                  {a.attachments.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Icon name="file" size={12} />
                      {a.attachments.length}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>

      {announcements.length > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {announcements.map((a, i) => (
              <button
                key={a.id}
                type="button"
                aria-label={`Announcement ${i + 1} of ${announcements.length}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-250 ${
                  i === index
                    ? 'w-5 bg-navy-600 dark:bg-amber-400'
                    : 'w-1.5 bg-[var(--line-strong)] hover:bg-[var(--ink-faint)]'
                }`}
              />
            ))}
          </div>

          {/* Touch has the swipe; a mouse needs something to press. */}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous announcement"
              className="grid h-8 w-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-40"
            >
              <Icon name="chevronLeft" size={16} />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === announcements.length - 1}
              aria-label="Next announcement"
              className="grid h-8 w-8 place-items-center rounded-full border border-line text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-40"
            >
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
