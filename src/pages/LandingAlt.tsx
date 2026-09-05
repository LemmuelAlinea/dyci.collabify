import { Suspense, lazy, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { BoardHandle } from '../components/landing/board/BoardScene'
import { EdgeLabel, Nav, ScrollRail } from '../components/landing-alt/Chrome'
import {
  Figure,
  Glow,
  Kicker,
  Marquee,
  Panel,
  Rise,
  Statement,
} from '../components/landing-alt/Sections'

/**
 * An alternative landing page, in the manner of oryzo.ai.
 *
 * A parallel mock-up, not a replacement: `/` and everything under
 * `components/landing/` are untouched, and this route exists so the two can be
 * looked at side by side before anything is decided.
 *
 * What was taken from the original is its restraint rather than its styling —
 * near-black ground, one warm bleed per screen, a statement that fills half a
 * viewport with a paragraph set far away from it, and chrome quiet enough to
 * disappear. What was not taken is the scroll-jacking: the original pins
 * sections and drives a WebGL timeline from scroll offset, which is
 * spectacular and also the reason it needs a loading screen. This reads as a
 * normal page and keeps the browser's own scrolling.
 *
 * The 3D board is the existing one, imported rather than copied, so both pages
 * show the same object and a change to the model reaches both.
 */

// The same lazy boundary the current hero uses: the board pulls three.js and
// R3F behind it, and neither belongs in the entry chunk.
const BoardExperience = lazy(() => import('../components/landing/board/BoardExperience'))

export default function LandingAlt() {
  // The board reads the pointer through this and nothing else crosses the
  // boundary. A memo rather than a ref, because reading `.current` during
  // render is what React's rules forbid and a stable object is all this needs.
  const handle = useMemo<BoardHandle>(
    () => ({ pointer: { current: { x: 0, y: 0, active: false } } }),
    [],
  )

  useEffect(() => {
    document.title = 'Collabify — a term, from the syllabus to the answer'
  }, [])

  return (
    <div className="min-h-screen bg-navy-950 text-amber-50 antialiased">
      <Nav />
      <ScrollRail />
      <EdgeLabel>Collabify board · v2</EdgeLabel>

      {/* ------------------------------------------------------------ intro */}
      <section id="intro" className="relative min-h-[100svh] overflow-hidden">
        <Glow corner="left" />

        {/* The wordmark bleeds off the left edge, as the original's does. It is
            set in a viewport unit so it keeps touching both edges at every
            width rather than being a fixed size that happens to fit one. */}
        <div className="relative px-5 pt-24 sm:px-8 lg:px-16">
          <Rise>
            <p className="font-mono text-[10.5px] tracking-[0.28em] text-amber-50/55 uppercase">
              Dr. Yanga's Colleges · BSIT program
            </p>
          </Rise>

          <Rise delay={0.05}>
            <h1 className="-ml-[0.06em] font-display text-[clamp(56px,15.5vw,220px)] leading-[0.84] font-bold tracking-[-0.05em] text-amber-50">
              Collabify
            </h1>
          </Rise>

          <div className="mt-6 grid gap-10 md:mt-2 md:grid-cols-12">
            <div className="md:col-span-5 md:col-start-8">
              <Rise delay={0.12}>
                <p className="text-[15px] leading-[1.75] text-amber-50/65 sm:text-[16px]">
                  Projects, boards and deadlines for classes at Dr. Yanga's Colleges. Six steps,
                  each blocked by the one before it — there is nothing else behind the sign-in.
                </p>
              </Rise>

              <Rise delay={0.18}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    to="/register"
                    className="rounded-full bg-amber-400 px-6 py-3 font-mono text-[11px] tracking-[0.16em] text-navy-950 uppercase transition-transform duration-200 hover:bg-amber-300 active:scale-[0.98]"
                  >
                    Create your account
                  </Link>
                  <a
                    href="#board"
                    className="rounded-full border border-amber-50/25 px-6 py-3 font-mono text-[11px] tracking-[0.16em] text-amber-50 uppercase transition-colors duration-200 hover:bg-amber-50/10"
                  >
                    See how it works
                  </a>
                </div>
              </Rise>
            </div>
          </div>
        </div>

        {/* The board, given the lower half of the screen the way the original
            gives its product the middle. */}
        <div className="relative mx-auto mt-4 w-full max-w-[1100px] px-5 sm:px-8 md:-mt-16">
          <Suspense fallback={<div className="aspect-[16/10] w-full" />}>
            <BoardExperience handle={handle} />
          </Suspense>
        </div>

        <div className="relative flex items-center justify-center gap-3 pb-10">
          <span className="h-px w-8 bg-amber-50/25" />
          <span className="font-mono text-[10px] tracking-[0.26em] text-amber-50/45 uppercase">
            Scroll to continue
          </span>
          <span className="h-px w-8 bg-amber-50/25" />
        </div>
      </section>

      {/* ------------------------------------------------------------ board */}
      <Panel id="board">
        <Statement
          kicker="The board"
          headline={
            <>
              Isn't just
              <br />a task list.
            </>
          }
          body={
            <>
              A project names the weeks it covers, carries the brief, and gives every group a
              board of its own. Students claim tasks off it, up to a fair share, so nobody ends up
              holding all of it.
            </>
          }
          aside={
            <div className="grid grid-cols-2 gap-x-6 gap-y-8">
              <Figure value="6" label="Steps in a term" />
              <Figure value="1" label="Board per group" />
            </div>
          }
        />
      </Panel>

      {/* ------------------------------------------------------------- flow */}
      <Panel id="flow" className="overflow-hidden">
        <Glow corner="right" />
        <Statement
          kicker="How it runs"
          headline={
            <>
              Built on
              <br />
              <span className="text-amber-300">the syllabus.</span>
            </>
          }
          body={
            <>
              The syllabus and the term dates go in, and its weeks become what everything after is
              measured against. Nothing is invented later — a deadline is a week, and a week is on
              the syllabus.
            </>
          }
        />

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-amber-50/12 bg-amber-50/12 sm:mt-28 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['01', 'A class, with its syllabus in it', 'Its weeks become the measure for everything after.'],
            ['02', 'Groups the class actually has', 'Built by hand, or opened for students to form their own.'],
            ['03', 'A project bound to weeks', 'Carries the brief, and gives every group a board.'],
            ['04', 'Work that has an owner', 'Claimed off the board, up to a fair share of it.'],
            ['05', 'Work that can change hands', 'Somebody goes quiet, a groupmate asks, the professor rules.'],
            ['06', 'Handing in, and an answer', 'Handing in freezes the board. The professor accepts it, or does not.'],
          ].map(([n, title, body], i) => (
            <Rise key={n} delay={0.04 * i}>
              <div className="h-full bg-navy-950 p-7 transition-colors duration-200 hover:bg-navy-900 sm:p-9">
                <p className="font-mono text-[11px] tracking-[0.2em] text-amber-300/80">{n}</p>
                <h3 className="mt-5 font-display text-[19px] leading-tight font-semibold tracking-[-0.02em] text-amber-50">
                  {title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-amber-50/55">{body}</p>
              </div>
            </Rise>
          ))}
        </div>
      </Panel>

      {/* ------------------------------------------------------------ roles */}
      <Panel>
        <Statement
          kicker="For roles"
          headline={
            <>
              Everyone sees
              <br />
              their own half.
            </>
          }
          body={
            <>
              A student sees what is on them and what is due. A professor sees what has stopped
              moving and what is waiting on a decision. A class is private to the people in it.
            </>
          }
        />

        <div className="mt-20 grid gap-10 sm:mt-28 sm:grid-cols-3">
          {[
            ['Students', 'Claim work, log time, hand in.'],
            ['Professors', 'Approve, unblock, rule on reassignments.'],
            ['Admins', 'Approve professors, hold the program registry.'],
          ].map(([role, line], i) => (
            <Rise key={role} delay={0.06 * i}>
              <div className="border-t border-amber-50/12 pt-5">
                <h3 className="font-display text-[17px] font-semibold tracking-[-0.015em] text-amber-50">
                  {role}
                </h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-amber-50/55">{line}</p>
              </div>
            </Rise>
          ))}
        </div>
      </Panel>

      {/* ------------------------------------------------------------ start */}
      <Panel id="start" className="overflow-hidden">
        <Glow corner="left" />
        <div className="text-center">
          <Rise>
            <Kicker>Start</Kicker>
          </Rise>
          <Rise delay={0.06}>
            <h2 className="mx-auto mt-6 max-w-[16ch] font-display text-[clamp(38px,8vw,96px)] leading-[0.95] font-bold tracking-[-0.04em] text-amber-50">
              Run the term.
            </h2>
          </Rise>
          <Rise delay={0.12}>
            <p className="mx-auto mt-7 max-w-[46ch] text-[15px] leading-[1.75] text-amber-50/65">
              Sign in with Google, or make an account. Professors are approved by the program
              before they can open a class.
            </p>
          </Rise>
          <Rise delay={0.18}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-full bg-amber-400 px-7 py-3.5 font-mono text-[11px] tracking-[0.16em] text-navy-950 uppercase transition-transform duration-200 hover:bg-amber-300 active:scale-[0.98]"
              >
                Create your account
              </Link>
              <Link
                to="/login"
                className="rounded-full border border-amber-50/25 px-7 py-3.5 font-mono text-[11px] tracking-[0.16em] text-amber-50 uppercase transition-colors duration-200 hover:bg-amber-50/10"
              >
                Sign in
              </Link>
            </div>
          </Rise>
        </div>
      </Panel>

      {/* ----------------------------------------------------------- footer */}
      <footer className="relative">
        <Marquee text="Collabify · " />

        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-16">
          <p className="font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase">
            Collabify · Dr. Yanga's Colleges
          </p>
          <div className="flex flex-wrap gap-6">
            <Link
              to="/"
              className="font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase transition-colors duration-200 hover:text-amber-50"
            >
              Current landing page
            </Link>
            <Link
              to="/login"
              className="font-mono text-[10.5px] tracking-[0.18em] text-amber-50/45 uppercase transition-colors duration-200 hover:text-amber-50"
            >
              Sign in
            </Link>
          </div>
        </div>

        <p className="px-5 pb-10 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-amber-50/25 uppercase sm:px-8 lg:px-16">
          A layout study, in the manner of oryzo.ai by Lusion. Not the live landing page.
        </p>
      </footer>
    </div>
  )
}
