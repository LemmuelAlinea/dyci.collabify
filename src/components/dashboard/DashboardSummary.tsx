import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/**
 * A number that counts up to itself.
 *
 * The failsafe is not decoration. A count-up that never finishes is not a
 * missing animation, it is a **wrong number on the screen** — a student reading
 * "0 tasks to finish" when they hold four. `requestAnimationFrame` does not run
 * at all in a document the browser is not painting, so a timer guarantees the
 * real figure lands whatever happens, and reduced motion skips straight to it.
 */
function CountUp({ value, duration = 850 }: { value: number; duration?: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (reduce || value === 0) {
      setShown(value)
      return
    }
    setShown(0)
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / duration)
      // Ease out, so it slows into the answer instead of stopping dead.
      setShown(Math.round(value * (1 - (1 - p) ** 3)))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const failsafe = window.setTimeout(() => {
      cancelAnimationFrame(frame)
      setShown(value)
    }, duration + 150)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(failsafe)
    }
  }, [value, duration, reduce])

  return <>{shown}</>
}

export type Tile = {
  label: string
  value: number
  to?: string
  icon: IconName
  tone?: 'plain' | 'warn'
}

/**
 * The top of a dashboard: who you are, what is true this minute, and four
 * figures you can press.
 *
 * The greeting used to be the largest thing on the page and it said nothing —
 * somebody already knows their own name and the time of day. The line beneath
 * it is the page's actual answer, and it changes with the week rather than the
 * clock.
 *
 * The sentence is passed in rather than worked out here, because what counts as
 * urgent is not the same question on both dashboards: a student is behind when
 * a deadline has passed, and a professor is behind when a group has gone quiet
 * or something is sitting unreleased. Only the shape is shared.
 */
export function DashboardSummary({
  greeting,
  name,
  line,
  urgent = false,
  tiles,
}: {
  greeting: string
  name: string
  /** One sentence of what is true right now, built by the page from its own data. */
  line: string
  urgent?: boolean
  tiles: Tile[]
}) {
  return (
    <section>
      <h1 className="leading-tight">
        {greeting}, {name}.
      </h1>

      <p
        className={`mt-2 flex items-start gap-2 text-[15px] leading-relaxed ${
          urgent ? 'text-amber-700 dark:text-amber-300' : 'text-muted'
        }`}
      >
        {urgent && <Icon name="alert" size={17} className="mt-0.5 shrink-0" />}
        {line}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <Icon
                  name={t.icon}
                  size={17}
                  className={
                    t.tone === 'warn'
                      ? 'text-amber-300 dark:text-amber-600'
                      : 'text-navy-300 dark:text-navy-500'
                  }
                />
                {t.to && (
                  <Icon
                    name="arrowRight"
                    size={15}
                    className="text-navy-300 opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:text-navy-500"
                  />
                )}
              </span>
              <span
                className={`mt-2.5 block font-mono text-[24px] leading-none font-bold tabular-nums sm:mt-3 sm:text-[30px] ${
                  t.tone === 'warn' ? 'text-amber-300 dark:text-amber-600' : 'text-white dark:text-navy-900'
                }`}
              >
                <CountUp value={t.value} />
              </span>
              <span className="mt-1.5 block text-[12.5px] leading-snug text-navy-200 dark:text-navy-600">
                {t.label}
              </span>
            </>
          )

          // Inverted against the page on purpose: a dark tile on the light
          // theme and a light tile on the dark one. The strip is the one thing
          // here that is read at a glance rather than scanned, and reversing it
          // separates it from the panels below without another colour.
          const shell =
            'group flex flex-col rounded-card border px-3.5 py-3 transition-colors duration-200 sm:px-4 sm:py-3.5 ' +
            'bg-navy-900 dark:bg-navy-50 ' +
            (t.tone === 'warn'
              ? 'border-amber-400/50 dark:border-amber-500/50'
              : 'border-navy-700 hover:border-navy-500 dark:border-navy-200 dark:hover:border-navy-300')

          return t.to ? (
            <Link key={t.label} to={t.to} className={shell}>
              {body}
            </Link>
          ) : (
            <div key={t.label} className={shell}>
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}
