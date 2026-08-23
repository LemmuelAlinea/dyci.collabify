#!/usr/bin/env node
// Render docs/iso-25010-report.html to a real PDF.
//
//   node scripts/report-pdf.mjs
//
// Headless Chrome or Edge, whichever is installed — both ship a PDF printer
// that honours @page, page-break rules and print-color-adjust, which is what
// the report's stylesheet is written against. No dependency is added for it.

import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error(
    'No Chrome or Edge found. Install either, or open docs/iso-25010-report.html\n' +
      'and print it to PDF by hand — the stylesheet is already set up for A4.',
  )
  process.exit(1)
}

const src = resolve('docs/iso-25010-report.html')
const out = resolve('docs/Collabify-ISO-25010-report.pdf')
if (!existsSync(src)) {
  console.error(`Missing ${src}`)
  process.exit(1)
}

// A throwaway profile: without it the run reuses a real one and can hang on a
// browser the user already has open.
const profile = mkdtempSync(join(tmpdir(), 'collabify-pdf-'))

try {
  execFileSync(
    browser,
    [
      '--headless',
      '--disable-gpu',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-pdf-header-footer',
      '--allow-file-access-from-files',
      '--virtual-time-budget=4000', // let the logo and layout settle
      `--print-to-pdf=${out}`,
      pathToFileURL(src).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: 90_000 },
  )
} catch (err) {
  console.error('Render failed:', err.stderr?.toString().trim() || err.message)
  process.exit(1)
} finally {
  rmSync(profile, { recursive: true, force: true })
}

if (!existsSync(out)) {
  console.error('Chrome exited without writing a file.')
  process.exit(1)
}
const { statSync } = await import('node:fs')
console.log(`${out}  ${statSync(out).size.toLocaleString()} bytes`)
