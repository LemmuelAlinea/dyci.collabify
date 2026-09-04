#!/usr/bin/env node
// Static checks for the motion rules in
// docs/superpowers/specs/2026-09-05-collabify-craft-pass-design.md section 3.
//
//   node scripts/motion-lint.mjs
//
// These are greps, not a renderer. They cannot tell you an animation feels
// right — only that the thing the spec asks for is present. Feel is checked in
// a browser, in both themes.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'src'
// The landing page is frozen by the spec, and its motion follows different
// rules — a marketing page may animate things an app page may not.
const SKIP = ['src/components/landing']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name).replaceAll('\\', '/')
    if (SKIP.some((s) => p.startsWith(s))) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const files = walk(SRC)
const read = (p) => readFileSync(p, 'utf8')
const failures = []

// Checks 2 and 4 need to reason about one element at a time, not the file as
// a whole — otherwise an unrelated `hover:` on one element and `duration-300`
// on another (a progress-bar fill, say) look like a single violation. Pull
// out each className string literal as its own scope. Both `className="..."`
// and `` className={`...`} `` forms appear in this codebase; a template
// literal is split on each `${...}` interpolation, since a conditional
// className is often built by concatenating pieces for different states —
// each literal chunk between interpolations is its own element scope. This
// is a heuristic, not a parser: it does not follow className built up in a
// variable, and an interpolation containing a literal `}` (a nested object)
// would truncate early. Good enough for a lint script.
function classNameScopes(src) {
  const scopes = []
  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    scopes.push(m[1])
  }
  for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) {
    scopes.push(...m[1].split(/\$\{[^}]*\}/))
  }
  return scopes
}

// 1. The four overlays must carry an enter/exit transition class.
const OVERLAYS = {
  'src/components/ui/Toast.tsx': 'motion-toast',
  'src/components/ui/Modal.tsx': 'motion-dialog',
  'src/components/ui/FilterPopover.tsx': 'motion-overlay',
  'src/components/app/NotificationBell.tsx': 'motion-overlay',
}
for (const [file, cls] of Object.entries(OVERLAYS)) {
  let overlaySrc = null
  try {
    overlaySrc = readFileSync(file, 'utf8')
  } catch {
    failures.push(`${file}: missing — expected to carry \`${cls}\``)
  }
  if (overlaySrc !== null && !overlaySrc.includes(cls)) {
    failures.push(`${file}: no \`${cls}\` — overlay appears and vanishes instantly`)
  }
}

// 2. Hover motion must be gated. Touch devices fire hover on tap. Gating is
// per element: a `hover-safe` on one hover site does not excuse another.
for (const f of files) {
  const src = read(f)
  for (const scope of classNameScopes(src)) {
    for (const m of scope.matchAll(/hover:-?translate-[xy]-[^\s"'`]+/g)) {
      if (!scope.includes('hover-safe')) {
        failures.push(`${f}: ungated \`${m[0]}\` — wrap in \`hover-safe\``)
      }
    }
  }
}

// 3. Motion shorthands are not hardware accelerated; they drop frames while
//    the main thread is busy. Use the full transform string.
for (const f of files) {
  for (const m of read(f).matchAll(/animate=\{\{[^}]*\b(x|y|scale):/g)) {
    failures.push(`${f}: Motion shorthand \`${m[1]}:\` — use transform: "translateX(0)"`)
  }
}

// 4. Hover is a tens-of-times-a-day interaction; 300ms reads sluggish. Scoped
// per element: a progress-bar fill can legitimately carry `duration-300`
// while an unrelated hover site elsewhere in the same file carries
// `duration-200` — only flag when both land on the same className string.
for (const f of files) {
  const src = read(f)
  for (const scope of classNameScopes(src)) {
    if (/hover:/.test(scope) && /duration-300/.test(scope)) {
      failures.push(`${f}: \`duration-300\` alongside a hover state — use duration-200`)
    }
  }
}

// 5. Two components must unmount themselves after their own CSS transition
//    finishes, so they need the duration in JS as well as in CSS. That is a
//    duplicated source of truth, so it is enforced here rather than trusted to
//    a comment: if a token moves and the constant does not, this fails.
const CSS_DUR = Object.fromEntries(
  [...readFileSync('src/styles/index.css', 'utf8').matchAll(/--dur-(\w+):\s*(\d+)ms/g)].map(
    (m) => [m[1], Number(m[2])],
  ),
)
let tsDur = null
try {
  tsDur = readFileSync('src/lib/motion.ts', 'utf8')
} catch {
  failures.push('src/lib/motion.ts: missing — the duration constants live here')
}
if (tsDur) {
  const TS_DUR = Object.fromEntries(
    [...tsDur.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  )
  for (const [name, ms] of Object.entries(CSS_DUR)) {
    if (TS_DUR[name] !== undefined && TS_DUR[name] !== ms) {
      failures.push(
        `src/lib/motion.ts: ${name} is ${TS_DUR[name]}ms but --dur-${name} is ${ms}ms`,
      )
    }
  }
  for (const name of Object.keys(CSS_DUR)) {
    if (TS_DUR[name] === undefined) {
      failures.push(`src/lib/motion.ts: no constant for --dur-${name}`)
    }
  }
}

if (failures.length) {
  console.error(`motion-lint: ${failures.length} problem(s)\n`)
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log(`motion-lint: ok (${files.length} files)`)
