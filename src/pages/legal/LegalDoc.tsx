import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LEGAL_DOCS, docBySlug, hasPlaceholder, parseLinks } from '../../lib/legal'
import type { LegalBlock, LegalDoc, LegalPart, LegalSlug } from '../../lib/legal'

/**
 * The one page that renders all three legal documents.
 *
 * Reached from two places with different surroundings: signed out from the
 * landing footer and the auth pages, and signed in from Settings, where it
 * sits inside `.app-ui`. So it may only use the semantic utilities both scopes
 * define — `.surface`, `.text-ink`, `.text-muted`, `.text-faint`,
 * `.border-line` — and never a raw ramp stop, which would be right in one
 * scope and wrong in the other.
 *
 * The measure is capped at 68 characters. These are long documents somebody
 * has to read to the end, and the full 1280px gutter would put roughly 140
 * characters on a line, which is the width at which a reader loses the start
 * of the next one.
 */

/** Long-form measure. Wider than a paragraph wants, narrower than the shell. */
const MEASURE = 'mx-auto w-full max-w-[68ch]'

function Runs({ parts }: { parts: LegalPart[] }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.to) {
          return (
            <Link
              key={i}
              to={part.to}
              className="text-ink underline decoration-amber-400/70 underline-offset-[3px] transition-colors duration-200 hover:decoration-amber-400"
            >
              {part.text}
            </Link>
          )
        }
        if (part.bold) {
          return (
            <strong key={i} className="text-ink font-semibold">
              {part.text}
            </strong>
          )
        }
        return <span key={i}>{part.text}</span>
      })}
    </>
  )
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'p') {
    return (
      <p className="text-muted mt-4 text-[15px] leading-[1.75]">
        <Runs parts={parseLinks(block.text)} />
      </p>
    )
  }

  if (block.kind === 'list') {
    return (
      <ul className="mt-4 space-y-2.5">
        {block.items.map((item, i) => (
          <li key={i} className="text-muted flex gap-3 text-[15px] leading-[1.7]">
            <span aria-hidden className="mt-[10px] size-1 shrink-0 rounded-full bg-amber-400" />
            <span>
              <Runs parts={parseLinks(item)} />
            </span>
          </li>
        ))}
      </ul>
    )
  }

  /**
   * A note is the thing somebody would rather not have read: a public avatar
   * bucket, an email address a classmate can reach, a log nobody can delete.
   * It gets an amber edge because burying it in the run of the text would be
   * technically disclosing it and practically hiding it.
   */
  if (block.kind === 'note') {
    return (
      <div className="mt-5 border-l-2 border-amber-400 py-1 pl-4">
        <p className="text-ink text-[14.5px] leading-[1.7]">
          <Runs parts={parseLinks(block.text)} />
        </p>
      </div>
    )
  }

  // Tables scroll inside their own box rather than widening the page — the
  // recipients table has two long columns and 375px is a real target here.
  return (
    <div className="border-line mt-5 -mx-1 overflow-x-auto rounded-xl border px-1">
      <table className="w-full min-w-[420px] border-collapse text-left">
        <thead>
          <tr>
            {block.head.map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="border-line text-faint border-b px-3 py-2.5 font-mono text-[10.5px] tracking-[0.14em] uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`border-line px-3 py-3 align-top text-[14px] leading-[1.6] ${
                    r === block.rows.length - 1 ? '' : 'border-b'
                  } ${c === 0 ? 'text-ink font-medium' : 'text-muted'}`}
                >
                  <Runs parts={parseLinks(cell)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Scroll to the `#section` in the URL once the document has rendered.
 *
 * The browser's own anchor handling runs before React has put the sections in
 * the DOM, so a link from one document into another lands at the top of the
 * page with the reader assuming the section is gone. Honours reduced motion by
 * jumping rather than gliding.
 */
function useAnchor(slug: LegalSlug) {
  const { hash } = useLocation()

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const target = document.getElementById(hash.slice(1))
    if (!target) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [hash, slug])
}

export function LegalDocPage({ slug }: { slug: LegalSlug }) {
  const doc = docBySlug(slug) as LegalDoc
  useAnchor(slug)

  useEffect(() => {
    document.title = `${doc.title} · Collabify`
  }, [doc.title])

  const others = LEGAL_DOCS.filter((other) => other.slug !== slug)

  return (
    <div className="surface text-ink min-h-screen">
      <div className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8 lg:px-12">
        <header className={`${MEASURE} pt-16 sm:pt-24`}>
          <Link
            to="/"
            className="text-faint hover:text-ink font-mono text-[10.5px] tracking-[0.18em] uppercase transition-colors duration-200"
          >
            ← Collabify
          </Link>

          <p className="mt-10 flex items-center gap-3">
            <span aria-hidden className="h-px w-7 bg-amber-400" />
            <span className="text-faint font-mono text-[10.5px] tracking-[0.22em] uppercase">
              {doc.kicker}
            </span>
          </p>

          <h1 className="font-display mt-6 text-[clamp(34px,6vw,58px)] leading-[1.02] font-bold tracking-[-0.035em]">
            {doc.title}
          </h1>

          <p className="text-muted mt-6 text-[16.5px] leading-[1.7]">{doc.summary}</p>

          <p className="text-faint mt-8 font-mono text-[10.5px] tracking-[0.14em] uppercase">
            Version {doc.version} · in effect {doc.effective}
          </p>
        </header>

        {hasPlaceholder(doc) && (
          <div
            className={`${MEASURE} mt-10 rounded-xl border border-amber-400 bg-amber-400/10 px-4 py-3.5`}
          >
            <p className="text-ink text-[14px] leading-[1.65]">
              <strong className="font-semibold">This document is not finished.</strong> The person
              who receives privacy requests has not been named yet, so anywhere below that should
              carry a name and an address says so instead. Nothing here should be relied on until it
              does.
            </p>
          </div>
        )}

        {/* Skipping to a section beats scrolling a document this long, and it
            doubles as a summary of what is in it. */}
        <nav aria-label="Sections" className={`${MEASURE} border-line mt-14 border-t pt-8`}>
          <p className="text-faint font-mono text-[10.5px] tracking-[0.18em] uppercase">
            On this page
          </p>
          <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-muted hover:text-ink text-[14.5px] transition-colors duration-200"
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className={`${MEASURE} mt-4`}>
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-8 pt-12">
              <h2 className="font-display text-ink text-[22px] leading-[1.25] font-semibold tracking-[-0.02em]">
                {section.heading}
              </h2>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}
        </main>

        <footer className={`${MEASURE} border-line mt-20 border-t pt-8`}>
          <p className="text-faint font-mono text-[10.5px] tracking-[0.18em] uppercase">Also read</p>
          <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
            {others.map((other) => (
              <Link
                key={other.slug}
                to={`/${other.slug}`}
                className="text-muted hover:text-ink text-[14.5px] transition-colors duration-200"
              >
                {other.title}
              </Link>
            ))}
            <Link
              to="/privacy/request"
              className="text-muted hover:text-ink text-[14.5px] transition-colors duration-200"
            >
              Make a privacy request
            </Link>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default LegalDocPage
