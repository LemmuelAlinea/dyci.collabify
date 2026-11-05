import { useLayoutEffect, useRef, useState } from 'react'
import { Linkify } from './Linkify'

const CLAMP = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
  5: 'line-clamp-5',
} as const

/**
 * Text shown to a few lines, with "See more" when there is more.
 *
 * Announcements stay on screen now instead of leaving after a day, so a long
 * one must not push everything else off the page. The text is clamped by the
 * browser and "See more" appears only when something is actually cut — a short
 * announcement shows no button. A caller can open a dialog, or leave
 * onSeeMore out to expand the text in place.
 */
export function ClampedText({
  text,
  lines = 3,
  className = '',
  onSeeMore,
  buttonClassName = '',
}: {
  text: string
  lines?: keyof typeof CLAMP
  className?: string
  onSeeMore?: () => void
  buttonClassName?: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [cut, setCut] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Measured, not guessed from the length: the same text is cut on a phone and
  // whole on a wide screen, and a web font arriving can change the answer.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [text, lines, expanded])

  return (
    <>
      <p ref={ref} className={`${expanded ? '' : CLAMP[lines]} whitespace-pre-wrap ${className}`}>
        <Linkify text={text} />
      </p>
      {(cut || expanded) && (
        <button
          type="button"
          onClick={onSeeMore ?? (() => setExpanded((value) => !value))}
          aria-expanded={onSeeMore ? undefined : expanded}
          className={`mt-1.5 self-start text-[13px] font-medium hover:underline ${buttonClassName || 'text-navy-600 dark:text-navy-200'}`}
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </>
  )
}
