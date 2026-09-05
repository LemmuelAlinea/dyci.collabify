import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hero } from '../components/landing/Hero'
import { Features, Roles } from '../components/landing/Roles'
import { Workflow } from '../components/landing/Workflow'
import { Kicker, Marquee, Rise, Shell } from '../components/landing/parts'

/**
 * The combined landing page.
 *
 * Two sources. The supplied static design brought the sticky workflow with its
 * stepping board, the role switcher, the orbit vectors and floating labels
 * around the render, and an amber block to close on. The earlier study at
 * `/preview/study` brought the near-black ground, a wordmark large enough to
 * touch both gutters, mono micro-labels, the scroll rail, and the habit of
 * setting a statement far away from its own paragraph.
 *
 * What holds them together is alternating ground. Dark hero, paper features,
 * navy workflow, paper roles, amber close. Five dark sections in a row would
 * read as one long section however different their content was.
 *
 * Colours are the product's existing ramp. The supplied design's `--ink`
 * (#172553) and `--orange` (#f6a536) land within a shade of `navy-800` and
 * `amber-400`, so nothing new had to be introduced to match it.
 *
 * The page this replaced has been deleted along with the sections only it
 * used. Three files from it survive because the 3D board still needs them:
 * `board/` itself, `BoardPreview` — which `BoardFallback` renders when WebGL
 * is unavailable — and the `useLoop` that drives it.
 */

/** Nav that inverts as the page passes from the dark hero onto white. */
function Nav() {
  const [past, setPast] = useState(false)

  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > window.innerHeight - 120)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-colors duration-500 ${
        past
          ? 'border-navy-900/10 bg-white/85 text-navy-900 backdrop-blur-md'
          : 'border-transparent text-amber-50'
      }`}
    >
      <Shell className="flex h-16 items-center justify-between sm:h-[72px]">
        <Link to="/" className="font-display text-[19px] font-bold tracking-[-0.03em]">
          Collabify<span className="text-amber-400">.</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {[
            ['Inside a class', '#workspace'],
            ['How it runs', '#how'],
            ['For roles', '#roles'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className={`text-[13.5px] font-medium transition-colors duration-200 ${
                past ? 'text-navy-600 hover:text-navy-900' : 'text-amber-50/70 hover:text-amber-50'
              }`}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link
            to="/login"
            className={`hidden text-[13.5px] font-semibold transition-colors duration-200 sm:block ${
              past ? 'text-navy-700 hover:text-navy-900' : 'text-amber-50/80 hover:text-amber-50'
            }`}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="rounded-lg bg-amber-400 px-4 py-2.5 text-[13.5px] font-semibold text-navy-950 transition-[background-color,transform] duration-200 hover:bg-amber-300 active:scale-[0.97]"
          >
            Get started
          </Link>
        </div>
      </Shell>
    </header>
  )
}

/** The hairline that fills as the page moves. */
function ScrollRail() {
  const [p, setP] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setP(max > 0 ? Math.min(1, window.scrollY / max) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-1/2 right-4 z-40 hidden h-40 w-px -translate-y-1/2 bg-navy-900/15 lg:block"
    >
      <div
        className="w-px bg-amber-400 transition-[height] duration-150 ease-out"
        style={{ height: `${p * 100}%` }}
      />
    </div>
  )
}

export default function Landing() {
  useEffect(() => {
    document.title = 'Collabify — where BSIT programs run the term'
  }, [])

  return (
    <div className="min-h-screen bg-white antialiased">
      <Nav />
      <ScrollRail />

      <main>
        <Hero />
        <Features />
        <Workflow />
        <Roles />

        {/* ------------------------------------------------------- closing */}
        <section className="relative overflow-hidden bg-amber-400 py-24 text-navy-950 sm:py-32">
          <Shell>
            <div className="flex flex-wrap items-end justify-between gap-10">
              <div>
                <Rise>
                  <Kicker tone="light">Start</Kicker>
                </Rise>
                <Rise delay={0.06}>
                  <h2 className="mt-6 font-display text-[clamp(42px,7.4vw,88px)] leading-[1.02] font-bold tracking-[-0.045em]">
                    Big things start
                    <br />
                    <span className="font-serif italic">on the same page.</span>
                  </h2>
                </Rise>
                <Rise delay={0.12}>
                  <Link
                    to="/register"
                    className="mt-9 inline-flex items-center gap-4 rounded-xl bg-navy-950 px-7 py-4 text-[15px] font-semibold text-amber-50 transition-[background-color,transform] duration-200 hover:bg-navy-800 active:scale-[0.98]"
                  >
                    Create your account
                    <span aria-hidden>→</span>
                  </Link>
                </Rise>
              </div>

              <Rise delay={0.18}>
                <p className="max-w-[34ch] text-[14.5px] leading-[1.8] text-navy-900/70">
                  Sign in with Google, or make an account. Professors are approved by the program
                  before they can open a class.
                </p>
              </Rise>
            </div>
          </Shell>
        </section>

        {/* -------------------------------------------------------- footer */}
        <footer className="bg-navy-950 text-amber-50">
          <Marquee text="Collabify · " />
          <Shell className="flex flex-col gap-6 py-12 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase">
              Collabify · Dr. Yanga's Colleges
            </p>
            <div className="flex flex-wrap gap-7">
              {[
                ['Sign in', '/login'],
                ['Create an account', '/register'],
              ].map(([label, to]) => (
                <Link
                  key={to}
                  to={to}
                  className="font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase transition-colors duration-200 hover:text-amber-50"
                >
                  {label}
                </Link>
              ))}
            </div>
          </Shell>
          <Shell className="pb-10">
            <p className="font-mono text-[10px] leading-relaxed tracking-[0.14em] text-amber-50/25 uppercase">
              Collabify · a project workspace for BSIT coursework
            </p>
          </Shell>
        </footer>
      </main>
    </div>
  )
}
