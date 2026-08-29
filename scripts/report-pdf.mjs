#!/usr/bin/env node
// Render one of the docs/*.html documents to a real PDF.
//
//   node scripts/report-pdf.mjs                            the quality report
//   node scripts/report-pdf.mjs docs/evaluation-questionnaire.html
//
// Headless Chrome, Chromium or Edge, whichever is installed — all ship a PDF
// printer that honours @page, page-break rules and print-color-adjust, which
// is what the report's stylesheet is written against. No dependency is added.

import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Finding a Chromium, in order: an explicit CHROME_PATH, then anything on PATH
// (Termux/proot, Linux, a macOS shim), then the usual install locations.
const ON_PATH = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome',
  'msedge',
]

const INSTALLED = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/data/data/com.termux/files/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

const exts = process.platform === 'win32' ? ['.exe', ''] : ['']
const searched = (process.env.PATH ?? '')
  .split(delimiter)
  .filter(Boolean)
  .flatMap((dir) => ON_PATH.flatMap((name) => exts.map((ext) => join(dir, name + ext))))

const browser = process.env.CHROME_PATH ?? [...searched, ...INSTALLED].find((p) => existsSync(p))
if (!browser || !existsSync(browser)) {
  console.error(
    process.env.CHROME_PATH
      ? `CHROME_PATH points at ${process.env.CHROME_PATH}, which does not exist.`
      : 'No Chrome, Chromium or Edge found. Install one, set CHROME_PATH to its\n' +
        'binary, or open docs/iso-25010-report.html and print it to PDF by hand —\n' +
        'the stylesheet is already set up for A4.',
  )
  process.exit(1)
}

const NAMES = {
  'iso-25010-report': 'Collabify-ISO-25010-report',
  'evaluation-questionnaire': 'Collabify-Evaluation-Questionnaire',
}

const arg = process.argv[2] ?? 'docs/iso-25010-report.html'
const src = resolve(arg)
const stem = basename(arg, '.html')
const out = resolve('docs', `${NAMES[stem] ?? stem}.pdf`)
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
      '--no-sandbox', // proot and containers have no user namespaces to sandbox with
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
