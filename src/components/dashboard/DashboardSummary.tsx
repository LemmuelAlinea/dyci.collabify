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
  kicker,
  line,
  urgent = false,
  tiles,
}: {
  greeting: string
  name: string
  /** The mono label above the greeting. Names the surface, not the person. */
  kicker: string
  /** One sentence of what is true right now, built by the page from its own data. */
  line: string
  urgent?: boolean
  tiles: Tile[]
}) {
  return (
    /**
     * The masthead, in the landing page's language.
     *
     * A bounded band rather than a whole dark dashboard. `.app-ui` records why
     * the working surface stays white — a person is in here for an hour
     * reading dense pages, and every tint is something their eye has to sort
     * before it reaches the sentence it came for. That reasoning holds for the
     * panels below and does not hold for this: the greeting and four figures
     * are glanced at, not read, and giving them the near-black ground is what
     * makes opening the app feel like the page that sold it.
     *
     * It also gives the inverted tiles somewhere to belong. They were already
     * reversed against the theme; against a dark band they read as part of it
     * rather than as four dark rectangles on white.
     *
     * The hairline is what makes it a band in dark mode. Measured there, the
     * band is rgb(8,11,33) against a page of rgb(10,14,36) — two units apart,
     * so fill alone cannot separate them and the edge has to. In light mode it
     * is a faint highlight along a dark shape, which costs nothing.
     */
    <section className="relative overflow-hidden rounded-panel border border-amber-50/10 bg-navy-950 px-5 py-7 text-amber-50 sm:px-7 sm:py-8 lg:px-9 lg:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 -right-40 h-[460px] w-[460px] rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, rgb(240 180 41 / 0.18) 0%, rgb(240 180 41 / 0.05) 45%, transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '54px 54px',
          maskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 30% 30%, #000, transparent 75%)',
        }}
      />

      <div className="relative">
        <p className="flex items-center gap-3">
          <span className="h-px w-7 bg-amber-400" />
          <span className="font-mono text-[12px] tracking-[0.22em] text-amber-200/75 uppercase">
            {kicker}
          </span>
        </p>

        <h1 className="mt-5 font-display leading-tight text-amber-50">
          {greeting}, {name}.
        </h1>

        <p
          className={`mt-3 flex items-start gap-2 text-[14px] leading-relaxed ${
            urgent ? 'text-amber-300' : 'text-amber-50/60'
          }`}
        >
          {urgent && <Icon name="alert" size={17} className="mt-0.5 shrink-0" />}
          {line}
        </p>
      </div>

      <div className="relative mt-5 grid w-full grid-cols-4 gap-1.5 sm:mt-7 sm:gap-3">
        {tiles.map((t) => {
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <Icon
                  name={t.icon}
                  size={17}
                  className={`h-3 w-3 sm:h-[17px] sm:w-[17px] ${
                    t.tone === 'warn' ? 'text-amber-300' : 'text-amber-50/45'
                  }`}
                />
                {t.to && (
                  <Icon
                    name="arrowRight"
                    size={15}
                    className="hidden text-amber-50/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 sm:block sm:h-[15px] sm:w-[15px]"
                  />
                )}
              </span>
              <span
                className={`mt-1 block font-mono text-[18px] leading-none font-bold tabular-nums sm:mt-3 sm:text-[30px] ${
                  t.tone === 'warn' ? 'text-amber-300' : 'text-amber-50'
                }`}
              >
                <CountUp value={t.value} />
              </span>
              <span className="mt-1 line-clamp-2 block min-h-[18px] text-[8.5px] leading-[1.1] text-amber-50/55 sm:mt-1.5 sm:min-h-0 sm:text-[12px] sm:leading-snug">
                {t.label}
              </span>
            </>
          )

          // A step above the band rather than inverted against the page. The
          // tiles used to reverse with the theme, which earned them their own
          // weight on a white dashboard; inside a dark masthead that would read
          // as four holes punched in it.
          const shell =
            'group flex min-w-0 flex-col rounded-lg border px-2 py-2 transition-colors duration-200 sm:rounded-card sm:px-4 sm:py-3.5 ' +
            'bg-amber-50/5 backdrop-blur-sm ' +
            (t.tone === 'warn'
              ? 'border-amber-400/45'
              : 'border-amber-50/12 hover:border-amber-50/25')

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
