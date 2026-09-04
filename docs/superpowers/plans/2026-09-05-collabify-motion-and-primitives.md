# Collabify motion and primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the four app overlays real enter and exit motion, put a press state on every pressable control, gate hover motion for touch, and move the two misfiled primitives into their own files — without changing a single existing token value.

**Architecture:** Motion values live as four `--dur-*` custom properties in the `@theme` block beside the existing easings, and are consumed through three utility classes in `@layer utilities` rather than through scattered Tailwind arbitrary values. Overlays that currently unmount instantly gain a lagging `render` state so an exit transition has something to play on. Everything else is call-site edits.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4 (`@theme` / `@layer` in `src/styles/index.css`), Motion (`motion/react`), Vitest (node environment, pure logic only).

**Covers:** sections 3, 4 and 5 of `docs/superpowers/specs/2026-09-05-collabify-craft-pass-design.md`. Sections 1, 2 and 6 are wide mechanical sweeps and get a separate plan after this one lands.

## Global Constraints

Every task's requirements implicitly include all of these.

- **No token value changes.** Not one existing `--*` value in `src/styles/index.css` is edited. This plan only *adds* `--dur-press`, `--dur-fast`, `--dur-base`, `--dur-overlay`.
- **No colour changes.** No ramp stop, surface, ink, line or shadow value.
- **The landing page is frozen.** Nothing under `src/components/landing/` or `src/pages/Landing.tsx`, and nothing in the `:root` or `.dark` token blocks.
- **`scripts/contrast.mjs` string-matches block openers** `@theme`, `@layer base`, `:root {`, `.dark {`, `.app-ui {`, `.dark .app-ui {`, `.app-ui .btn {`. These openers and their order must survive every edit or the script throws.
- **`npm run check` must pass** after every task: `typecheck && lint && test && contrast.mjs && a11y-names.mjs && schema-drift.mjs`.
- **Lint baseline is 23 warnings / 0 errors.** Any increase is a regression to fix, not to accept.
- **Copy style:** sentence case, active voice, no exclamation marks, no "please", no "successfully".
- **Do not touch `.eyebrow` in either scope.** The `.app-ui` override at 12px sans is deliberate and used 56 times.
- **Reduced motion:** spec section 3 rule 9 is explicitly NOT in this plan. The existing `@media (prefers-reduced-motion: reduce)` block is left exactly as it is.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `scripts/motion-lint.mjs` | Static gate. Asserts the four overlays carry a transition, no ungated hover motion exists, no Motion transform shorthands remain, no 300ms hover durations remain, and the JS duration constants match the CSS tokens. This is the failing test for tasks 3-9. |
| `src/lib/motion.ts` | The duration values as TypeScript constants, for the two components that must unmount after their own transition. Kept in sync with the CSS tokens by check 5 of the gate. |
| `src/components/ui/EmptyState.tsx` | `EmptyState` and `EmptyArt`, moved out of `Tabs.tsx` |
| `src/components/ui/Alert.tsx` | `Alert`, moved out of `Field.tsx` |
| `src/components/ui/Badge.tsx` | Count and status pill, replacing 93 hand-styled sites |

**Modified:**

| File | Change |
| --- | --- |
| `src/styles/index.css` | Four `--dur-*` tokens in `@theme`; three motion utility classes in `@layer utilities` |
| `src/components/ui/Toast.tsx` | Lagging removal + enter/exit transition |
| `src/components/ui/Modal.tsx` | Lagging unmount + enter/exit transition, scrim fade |
| `src/components/ui/FilterPopover.tsx` | Origin-aware enter/exit |
| `src/components/app/NotificationBell.tsx` | Origin-aware enter/exit, press state on trigger and rows |
| `src/components/app/AppShell.tsx` | Motion shorthand to full transform string |
| `src/components/motion/Reveal.tsx` | Stagger 20ms to 40ms |
| `src/components/ui/Tabs.tsx` | `EmptyState` removed, re-exported for compatibility during migration |
| `src/components/ui/Field.tsx` | `Alert` removed, re-exported for compatibility during migration |
| `package.json` | `motion-lint.mjs` added to the `check` script |

---

## Task 1: The motion gate

**Files:**
- Create: `scripts/motion-lint.mjs`
- Modify: `package.json` (the `check` script)

**Interfaces:**
- Consumes: nothing
- Produces: `node scripts/motion-lint.mjs` exits 0 when all four checks pass, 1 with a listing when any fail. Tasks 3-9 each drive one check to green.

- [ ] **Step 1: Write the gate script**

Create `scripts/motion-lint.mjs`:

```js
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

// 1. The four overlays must carry an enter/exit transition class.
const OVERLAYS = {
  'src/components/ui/Toast.tsx': 'motion-toast',
  'src/components/ui/Modal.tsx': 'motion-dialog',
  'src/components/ui/FilterPopover.tsx': 'motion-overlay',
  'src/components/app/NotificationBell.tsx': 'motion-overlay',
}
for (const [file, cls] of Object.entries(OVERLAYS)) {
  if (!read(file).includes(cls)) {
    failures.push(`${file}: no \`${cls}\` — overlay appears and vanishes instantly`)
  }
}

// 2. Hover motion must be gated. Touch devices fire hover on tap.
for (const f of files) {
  const src = read(f)
  for (const m of src.matchAll(/hover:-?translate-[xy]-[^\s"'`]+/g)) {
    if (!src.includes('@media (hover: hover)') && !src.includes('hover-safe')) {
      failures.push(`${f}: ungated \`${m[0]}\` — wrap in \`hover-safe\``)
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

// 4. Hover is a tens-of-times-a-day interaction; 300ms reads sluggish.
for (const f of files) {
  const src = read(f)
  if (/hover:/.test(src) && /duration-300/.test(src)) {
    failures.push(`${f}: \`duration-300\` alongside a hover state — use duration-200`)
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node scripts/motion-lint.mjs`

Expected: exit 1, listing four missing overlay classes, four ungated `hover:-translate-y-*` sites, one or more Motion shorthands, and the `duration-300` hover sites. Record the exact count — it is the baseline the later tasks reduce to zero.

- [ ] **Step 3: Wire it into the check script**

In `package.json`, change the `check` script to append the new gate:

```json
"check": "npm run typecheck && npm run lint && npm run test && node scripts/contrast.mjs && node scripts/a11y-names.mjs && node scripts/schema-drift.mjs && node scripts/motion-lint.mjs"
```

- [ ] **Step 4: Confirm the gate is wired**

Run: `npm run check`

Expected: FAIL, and the failure is `motion-lint`, not one of the earlier gates. If an earlier gate fails, stop — that is a pre-existing problem this plan did not cause and must be reported before continuing.

- [ ] **Step 5: Commit**

```bash
git add scripts/motion-lint.mjs package.json
git commit -m "Add a static gate for the motion rules"
```

---

## Task 2: Duration tokens and motion utilities

**Files:**
- Modify: `src/styles/index.css` (`@theme` block, ends line 37; `@layer utilities` block, opens line 312)

**Interfaces:**
- Produces: `--dur-press`, `--dur-fast`, `--dur-base`, `--dur-overlay` as CSS custom properties, and `.motion-overlay`, `.motion-dialog`, `.motion-toast`, `.hover-safe` as utility classes. Tasks 3-7 consume these.

- [ ] **Step 1: Add the duration tokens**

In `src/styles/index.css`, inside `@theme`, directly after the two existing easing lines (currently lines 35-36):

```css
  --ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-snap: cubic-bezier(0.16, 1, 0.3, 1);

  /* Durations, so a dropdown and a dialog cannot drift apart the way the
     hardcoded ones did. Emil Kowalski's scale: press 100-160, popovers
     125-200, dropdowns 150-250, dialogs and drawers 200-500. Everything a
     person triggers stays under 300 — a 180ms popover feels more responsive
     than a 400ms one. */
  --dur-press: 140ms;
  --dur-fast: 180ms;
  --dur-base: 220ms;
  --dur-overlay: 260ms;
```

Do not move or rename the `@theme` opener — `scripts/contrast.mjs` finds it by string match.

- [ ] **Step 2: Add the motion utilities**

In `src/styles/index.css`, inside the existing `@layer utilities` block (opens line 312), after the `.shadow-lift` rule (currently ends line 342):

```css
  /**
   * Overlay motion, said once.
   *
   * Transitions rather than keyframes: all four of these can be fired twice in
   * a second, and a transition retargets from wherever the element currently
   * is while a keyframe restarts from zero. `[data-state='closed']` is the
   * exit; the resting rule is the enter, so both directions share one curve.
   *
   * Never `scale(0)` — nothing in the real world appears from nothing.
   */
  .motion-overlay,
  .motion-dialog,
  .motion-toast {
    transition-timing-function: var(--ease-out-soft);
    transition-property: opacity, transform;
  }
  .motion-overlay {
    transition-duration: var(--dur-fast);
  }
  .motion-dialog {
    transition-duration: var(--dur-base);
  }
  .motion-toast {
    transition-duration: var(--dur-overlay);
  }

  .motion-overlay[data-state='closed'] {
    opacity: 0;
    transform: scale(0.97);
  }
  .motion-dialog[data-state='closed'] {
    opacity: 0;
    transform: scale(0.96);
  }
  /* A toast leaves through the edge it arrived from. `100%` is the element's
     own height, so it clears itself whatever the message length. */
  .motion-toast[data-state='closed'] {
    opacity: 0;
    transform: translateY(100%);
  }

  .motion-scrim {
    transition: opacity var(--dur-base) var(--ease-out-soft);
  }
  .motion-scrim[data-state='closed'] {
    opacity: 0;
  }

  /**
   * Hover motion only where there is a real pointer. A touch device fires
   * hover on tap, which leaves a card stuck in its lifted state after the
   * finger has gone.
   */
  @media (hover: hover) and (pointer: fine) {
    .hover-safe:hover {
      transform: translateY(-2px);
    }
  }
```

- [ ] **Step 3: Create the matching TypeScript constants**

Two components must unmount themselves after their own transition finishes, so they need
these durations in JS as well as CSS. Create `src/lib/motion.ts`:

```ts
/**
 * The duration tokens, in JavaScript.
 *
 * `Toast` and `Modal` stay mounted for one transition after they are told to
 * close, so they need to know how long that transition lasts. CSS cannot tell
 * them, so the values live in two places — and check 5 of
 * `scripts/motion-lint.mjs` fails the build if the two ever disagree.
 *
 * Milliseconds, matching `--dur-*` in src/styles/index.css.
 */
export const DUR = {
  press: 140,
  fast: 180,
  base: 220,
  overlay: 260,
} as const
```

- [ ] **Step 4: Verify the contrast gate still parses the file**

Run: `node scripts/contrast.mjs`

Expected: PASS, printing its usual four-scope table. If it throws `cannot find the block opener`, a block opener was moved — revert and redo step 1 without touching the openers.

- [ ] **Step 5: Verify the build and the sync check**

Run: `npm run build && node scripts/motion-lint.mjs`

Expected: `tsc -b` clean, Vite build succeeds, and check 5 of the gate passes — the four
constants match the four tokens. Checks 1-4 still fail; that is the point.

- [ ] **Step 6: Commit**

```bash
git add src/styles/index.css src/lib/motion.ts
git commit -m "Add duration tokens, their TypeScript mirror, and the overlay motion utilities"
```

---

## Task 3: Toast enter and exit

**Files:**
- Modify: `src/components/ui/Toast.tsx`

**Interfaces:**
- Consumes: `.motion-toast` from Task 2.
- Produces: no API change. `useToast().show(message, tone)` keeps its signature.

The toast currently unmounts the instant its 4200ms timer fires, so there is nothing for an exit to play on. The fix is a two-phase removal: mark it closing, then unmount one `--dur-overlay` later.

- [ ] **Step 1: Add the closing phase**

In `src/components/ui/Toast.tsx`, add the duration import beside the existing ones:

```tsx
import { DUR } from '../../lib/motion'
```

Then change the `Toast` type (line 7) and the `show` callback (lines 29-33) to:

```tsx
type Toast = { id: number; tone: Tone; message: string; closing?: boolean }
```

```tsx
  const show = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, message }])
    // Two phases. The first marks the toast closed so the transition has
    // something to play; the second removes it once that transition is over.
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, closing: true } : x)))
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), DUR.overlay)
    }, 4200)
  }, [])
```

- [ ] **Step 2: Add the transition to the markup**

Replace the toast `<div>` (lines 45-51) with:

```tsx
          <div
            key={t.id}
            data-state={t.closing ? 'closed' : 'open'}
            className={`motion-toast pointer-events-auto flex w-full max-w-[380px] items-start gap-2.5 rounded-xl border px-4 py-3 text-[14px] shadow-lift ${STYLES[t.tone].cls}`}
            style={{ transitionBehavior: 'allow-discrete' }}
          >
            <Icon name={STYLES[t.tone].icon} size={17} className="mt-px shrink-0" />
            <span className="min-w-0">{t.message}</span>
          </div>
```

- [ ] **Step 3: Add the entrance**

A toast is mounted already in its resting state, so there is nothing to transition *from*. Add a `@starting-style` rule to `src/styles/index.css`, immediately after the `.motion-toast[data-state='closed']` rule from Task 2:

```css
  /* The entrance. Without this the toast is already at rest on its first
     frame and only the exit would animate. */
  @starting-style {
    .motion-toast[data-state='open'] {
      opacity: 0;
      transform: translateY(100%);
    }
  }
```

- [ ] **Step 4: Verify**

Run: `npm run build && node scripts/motion-lint.mjs`

Expected: build clean; `motion-lint` no longer reports `Toast.tsx`. It still reports the other three overlays.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toast.tsx src/styles/index.css
git commit -m "Give the toast an entrance and an exit through the same edge"
```

---

## Task 4: Modal enter and exit

**Files:**
- Modify: `src/components/ui/Modal.tsx:79` (the `if (!open) return null` guard) and `:82-97` (the wrapper, scrim and panel)

**Interfaces:**
- Consumes: `.motion-dialog` and `.motion-scrim` from Task 2.
- Produces: no API change. `Modal` keeps every prop in its existing `Props` type.

`Modal` returns `null` the moment `open` goes false, so the panel is gone before an exit could play. It needs a `render` state that lags `open`.

- [ ] **Step 1: Add the lagging render state**

In `src/components/ui/Modal.tsx`, change the import on line 1 to include `useState`, and
add the duration import:

```tsx
import { useEffect, useRef, useState } from 'react'
```

```tsx
import { DUR } from '../../lib/motion'
```

Then add this directly above the `if (!open) return null` guard on line 79:

```tsx
  // `open` is the caller's intent; `render` is what is on screen. They differ
  // for one transition on the way out, which is the whole reason a dialog can
  // animate closed at all — without this the element is unmounted on the frame
  // the user clicks, and there is nothing left to fade.
  const [render, setRender] = useState(open)
  useEffect(() => {
    if (open) {
      setRender(true)
      return
    }
    const t = setTimeout(() => setRender(false), DUR.base)
    return () => clearTimeout(t)
  }, [open])

  if (!render) return null
```

Delete the old `if (!open) return null` line.

- [ ] **Step 2: Apply the transition classes**

Replace the scrim `<div>` (lines 86-90) with:

```tsx
      <div
        aria-hidden="true"
        onClick={onClose}
        data-state={open ? 'open' : 'closed'}
        className="motion-scrim absolute inset-0 bg-navy-950/55 backdrop-blur-sm"
      />
```

And add `motion-dialog` plus the state attribute to the panel (lines 91-98):

```tsx
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-state={open ? 'open' : 'closed'}
        className={`motion-dialog surface relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-panel shadow-lift outline-none sm:rounded-panel ${WIDTHS[size]}`}
      >
```

- [ ] **Step 3: Add the dialog entrance**

In `src/styles/index.css`, extend the `@starting-style` block added in Task 3:

```css
  @starting-style {
    .motion-toast[data-state='open'] {
      opacity: 0;
      transform: translateY(100%);
    }
    /* A dialog is not anchored to a trigger, so it scales from its own centre
       rather than from an origin. */
    .motion-dialog[data-state='open'] {
      opacity: 0;
      transform: scale(0.96);
    }
    .motion-scrim[data-state='open'] {
      opacity: 0;
    }
  }
```

- [ ] **Step 4: Verify the focus trap still works**

Run: `npm run build`

Expected: clean. Then confirm by reading `src/lib/focus.ts` that `useFocusTrap` keys off the `open` argument and not off mount — it is called with `open` on line 68, so the extra render frame does not affect it. If it keys off mount, the trap must move behind `render` instead.

- [ ] **Step 5: Verify the gate**

Run: `node scripts/motion-lint.mjs`

Expected: `Modal.tsx` no longer listed.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Modal.tsx src/styles/index.css
git commit -m "Let the dialog and its scrim animate open and closed"
```

---

## Task 5: Origin-aware popovers

**Files:**
- Modify: `src/components/ui/FilterPopover.tsx:99` (the panel)
- Modify: `src/components/app/NotificationBell.tsx:117` (the panel)

**Interfaces:**
- Consumes: `.motion-overlay` from Task 2.
- Produces: no API change to either component.

Both panels are conditionally rendered and anchored to a trigger. A popover should scale from the control that opened it, not from its own centre — the spatial relationship is the whole point.

- [ ] **Step 1: FilterPopover**

In `src/components/ui/FilterPopover.tsx`, the panel currently opens with `absolute top-12`. Add the motion class, the state attribute and an origin. The panel is below its trigger and aligned to the same side, so the origin is the top edge:

```tsx
        className={`motion-overlay surface absolute top-12 z-40 w-[min(92vw,340px)] origin-top space-y-3 rounded-2xl border border-line p-4 shadow-lift ${
```

Keep the rest of the template literal exactly as it is, and add `data-state="open"` to the same element. The panel unmounts on close, so only the entrance animates — that is acceptable for a popover and avoids threading a lagging state through a component this small.

- [ ] **Step 2: NotificationBell**

In `src/components/app/NotificationBell.tsx`, line 117, the panel is full-width on mobile and anchored top-right on desktop. Add the class and a right-side origin:

```tsx
        <div
          data-state="open"
          className="motion-overlay surface fixed inset-x-3 top-[78px] z-50 origin-top overflow-hidden rounded-2xl border border-line shadow-lift sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[380px] sm:origin-top-right"
        >
```

- [ ] **Step 3: Add the popover entrance**

In `src/styles/index.css`, add to the `@starting-style` block:

```css
    .motion-overlay[data-state='open'] {
      opacity: 0;
      transform: scale(0.97);
    }
```

- [ ] **Step 4: Verify**

Run: `npm run build && node scripts/motion-lint.mjs`

Expected: build clean; check 1 of `motion-lint` now passes entirely — no overlay failures remain.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/FilterPopover.tsx src/components/app/NotificationBell.tsx src/styles/index.css
git commit -m "Scale the popovers from their triggers instead of their centres"
```

---

## Task 6: Press states on the raw buttons

**Files:**
- Modify: `src/components/app/NotificationBell.tsx:103` (bell trigger), `:155` (notification rows)
- Modify: `src/components/ui/Modal.tsx:108` (close button)
- Modify: `src/components/ui/FilterPopover.tsx:67` (filter trigger)

**Interfaces:**
- Consumes: `--dur-press` from Task 2.
- Produces: nothing other tasks depend on.

`Button.tsx` already carries `active:scale-[0.98]`, so the 59 files importing it are covered. These four are raw `<button>` elements that bypass it. Discrete controls get a scale; full-width rows get a tint, because scaling a full-width row reads as the page flexing rather than a control responding.

- [ ] **Step 1: The bell trigger — discrete, so it scales**

`src/components/app/NotificationBell.tsx` line 103:

```tsx
        className="relative grid h-10 w-10 place-items-center rounded-full text-muted transition-[background-color,color,transform] duration-[--dur-press] hover:bg-[var(--surface-sunken)] hover:text-ink active:scale-[0.97]"
```

- [ ] **Step 2: The notification rows — full width, so they tint**

`src/components/app/NotificationBell.tsx` line 155:

```tsx
                      className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors duration-[--dur-press] hover:bg-[var(--surface-sunken)] active:bg-[var(--surface-sunken)]"
```

- [ ] **Step 3: The dialog close button — discrete**

`src/components/ui/Modal.tsx` line 108:

```tsx
            className="-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-[background-color,color,transform] duration-[--dur-press] hover:bg-[var(--surface-sunken)] hover:text-ink active:scale-[0.97]"
```

- [ ] **Step 4: The filter trigger — discrete**

`src/components/ui/FilterPopover.tsx` line 67, add to the existing template literal's static portion:

```tsx
        className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition-[background-color,border-color,transform] duration-[--dur-press] active:scale-[0.97] ${
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`

Expected: build clean, lint at 23 warnings / 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/app/NotificationBell.tsx src/components/ui/Modal.tsx src/components/ui/FilterPopover.tsx
git commit -m "Give the raw buttons a press state"
```

---

## Task 7: Gate hover motion and shorten hover durations

**Files:**
- Modify: `src/components/tasks/GroupProgressTable.tsx:156`
- Modify: every non-landing file `motion-lint` check 4 reports

**Interfaces:**
- Consumes: `.hover-safe` from Task 2.

Three of the four `hover:-translate-y-*` sites are in `landing/` and are out of scope. Only `GroupProgressTable.tsx` is in the app.

- [ ] **Step 1: Confirm which sites are in scope**

Run: `node scripts/motion-lint.mjs 2>&1 | grep translate`

Expected: exactly one file, `src/components/tasks/GroupProgressTable.tsx`. If more appear, handle each the same way.

- [ ] **Step 2: Replace the ungated hover lift**

In `src/components/tasks/GroupProgressTable.tsx` line 156, remove the `hover:-translate-y-*` utility from the className and add `hover-safe` in its place. The class from Task 2 applies the same -2px lift but only behind `@media (hover: hover) and (pointer: fine)`.

- [ ] **Step 3: Shorten the hover durations**

Run: `node scripts/motion-lint.mjs 2>&1 | grep duration-300`

**Expect this to return nothing, and treat that as the correct result.** After check 4 was
scoped to per-element className strings in Task 1, it found zero in-scope hits: every real
same-element `hover:` plus `duration-300` case in this codebase is in
`src/components/landing/`, which the gate excludes and the plan freezes. The spec's claim
of "23 affected sites" counted landing files and non-hover progress bars.

If the command does return something, change `duration-300` to `duration-200` on those
elements only. Do not go looking for `duration-300` by hand — a progress-bar fill at 300ms
is correct and must be left alone.

- [ ] **Step 4: Verify**

Run: `node scripts/motion-lint.mjs && npm run build`

Expected: checks 2 and 4 pass. Only check 3 remains failing.

- [ ] **Step 5: Commit**

```bash
git add -A src/components
git commit -m "Gate the hover lift for touch and bring hover timing under 300ms"
```

---

## Task 8: Hardware-accelerate the nav drawer

**Files:**
- Modify: `src/components/app/AppShell.tsx:199`

**Interfaces:**
- Consumes: nothing.

Motion's `x` / `y` / `scale` props are not hardware accelerated — they run on the main thread through `requestAnimationFrame`. The mobile nav drawer opens while the app is navigating, which is exactly when the main thread is busy and those props drop frames.

- [ ] **Step 1: Replace all three shorthands together**

The drawer sits at `inset-y-0 left-0`, so it enters from the left. In
`src/components/app/AppShell.tsx`, replace these three lines:

```tsx
              initial={reduce ? false : { x: '-100%' }}
              animate={{ x: 0 }}
              exit={reduce ? undefined : { x: '-100%' }}
```

with:

```tsx
              initial={reduce ? false : { transform: 'translateX(-100%)' }}
              animate={{ transform: 'translateX(0)' }}
              exit={reduce ? undefined : { transform: 'translateX(-100%)' }}
```

All three change together. A shorthand paired with a transform string will not
interpolate — Motion treats them as unrelated properties and the drawer jumps.

Leave the `transition` line alone. Its curve is already `[0.22, 1, 0.36, 1]`, which is
`--ease-out-soft`, and its 0.32s is a drawer duration rather than a UI one.

The `reduce` guard is `useReducedMotion()` and is already correct — this task does not
touch reduced motion.

- [ ] **Step 3: Verify**

Run: `node scripts/motion-lint.mjs && npm run build`

Expected: `motion-lint` prints `ok`. All four checks now pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/app/AppShell.tsx
git commit -m "Drive the nav drawer with a transform string so it survives a busy main thread"
```

---

## Task 9: Widen the reveal stagger

**Files:**
- Modify: `src/pages/app/StudentHome.tsx`, `src/pages/app/ProfessorHome.tsx`, and any other `Reveal` caller step 1 reports

**Interfaces:**
- Consumes: nothing. `Reveal`'s `delay?: number` prop signature is unchanged.

Dashboard reveals are 20ms apart (`0.04`, `0.05`, `0.06`, `0.07`, `0.08`). The useful range for a stagger is 30-80ms; below that the cascade reads as a single simultaneous appearance and the stagger is doing nothing.

- [ ] **Step 1: Find the callers**

Run: `grep -rn "Reveal once delay" src --include=*.tsx`

- [ ] **Step 2: Double the increments**

In each dashboard, respace the delays at 40ms. `StudentHome.tsx` and `ProfessorHome.tsx` interleave two columns, so the left column becomes `0.04`, `0.12`, `0.20` and the right becomes `0.08`, `0.16`. Keep the interleave — it is what makes the two columns read as one cascade rather than two.

- [ ] **Step 3: Verify**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/pages/app
git commit -m "Widen the dashboard stagger into a range the eye can read"
```

---

## GATE: browser verification

**This gate is a hard stop. Do not begin Task 10 until the user has approved.**

The user asked to see this before any further work. Motion cannot be judged from code — `motion-lint` proves the rules are present, not that they feel right.

- [ ] **Step 1: Start the preview**

Use the `collabify` configuration from `.claude/launch.json` (port 5173). The user signs in; credentials are never entered on their behalf.

- [ ] **Step 2: Check each overlay in both themes**

For `Toast`, `Modal`, `FilterPopover` and `NotificationBell`, in light and again in dark:
- it animates in rather than appearing;
- it animates out rather than vanishing;
- a toast leaves through the bottom edge it entered from;
- each popover scales from its trigger, not from its centre.

- [ ] **Step 3: Check the press states**

Click and hold the bell, a notification row, the dialog close button and the filter trigger. The three discrete controls scale; the row tints.

- [ ] **Step 4: Check hover gating at tablet width**

Set the viewport to 768x1024 and confirm the `GroupProgressTable` row does not stick in its lifted state after a tap.

- [ ] **Step 5: Report and wait**

Screenshot both themes. Report what was verified and what could not be — `prefers-reduced-motion` cannot be emulated by the available tooling, and light-mode shadow subtlety renders differently on the user's tablet than on this machine. **Wait for approval.**

---

## Task 10: Extract EmptyState

**Files:**
- Create: `src/components/ui/EmptyState.tsx`
- Modify: `src/components/ui/Tabs.tsx` (remove the component, keep a re-export)

**Interfaces:**
- Produces: `export type EmptyArt = 'announcements' | 'classes' | 'groups' | 'projects' | 'reassignments' | 'tasks'` and `export function EmptyState(props: { icon: IconName; art?: EmptyArt; title: string; body: string; action?: ReactNode })` from `src/components/ui/EmptyState.tsx`. 37 files import it.

- [ ] **Step 1: Move the component verbatim**

Create `src/components/ui/EmptyState.tsx` containing the `EmptyArt` type and the `EmptyState` function exactly as they appear in `Tabs.tsx` today (lines 71-117), with the imports they need:

```tsx
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
```

Copy the JSDoc comment above `EmptyArt` across with it. **Do not change any markup** — this task is a move, and mixing a move with an edit makes both unreviewable.

- [ ] **Step 2: Re-export from Tabs for one commit**

In `src/components/ui/Tabs.tsx`, delete the `EmptyArt` type and `EmptyState` function, and add at the top:

```tsx
// Moved to ./EmptyState. Re-exported here so this commit is a pure move; the
// next one updates the 37 importers and deletes this line.
export { EmptyState, type EmptyArt } from './EmptyState'
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm run build`

Expected: clean, with no import changes anywhere else yet.

- [ ] **Step 4: Commit the move**

```bash
git add src/components/ui/EmptyState.tsx src/components/ui/Tabs.tsx
git commit -m "Move EmptyState out of Tabs into its own file"
```

- [ ] **Step 5: Update the importers**

Run: `grep -rln "EmptyState" src --include=*.tsx`

In each, change the import source from `'.../ui/Tabs'` to `'.../ui/EmptyState'`, preserving the correct relative depth. Where a file imports both `Tabs` and `EmptyState` from the same line, split it into two imports.

- [ ] **Step 6: Remove the re-export and verify**

Delete the re-export line from `Tabs.tsx`, then run: `npm run check`

Expected: passes. A missed importer surfaces as a `tsc` error naming the file.

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Point the 37 EmptyState importers at the new file"
```

---

## Task 11: Extract Alert

**Files:**
- Create: `src/components/ui/Alert.tsx`
- Modify: `src/components/ui/Field.tsx` (remove the component, keep a re-export)

**Interfaces:**
- Produces: `export function Alert(props: { tone?: 'info' | 'success' | 'error'; children: ReactNode; onRetry?: () => void | Promise<void> })` from `src/components/ui/Alert.tsx`. 64 files reference it.

- [ ] **Step 1: Move the component verbatim**

Create `src/components/ui/Alert.tsx` with the `Alert` function exactly as it appears in `Field.tsx` today, plus its JSDoc comment explaining why `onRetry` exists, and these imports:

```tsx
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import type { IconName } from './Icon'
```

- [ ] **Step 2: Re-export from Field for one commit**

In `src/components/ui/Field.tsx`, delete the `Alert` function and add at the top:

```tsx
// Moved to ./Alert. Re-exported here so this commit is a pure move; the next
// one updates the importers and deletes this line.
export { Alert } from './Alert'
```

- [ ] **Step 3: Verify**

Run: `npm run build`

Expected: clean.

- [ ] **Step 4: Commit the move**

```bash
git add src/components/ui/Alert.tsx src/components/ui/Field.tsx
git commit -m "Move Alert out of Field into its own file"
```

- [ ] **Step 5: Update the importers**

Run: `grep -rln "\bAlert\b" src --include=*.tsx`

Change each import source from `'.../ui/Field'` to `'.../ui/Alert'`. Watch for files importing `Field` and `Alert` on one line — split them.

- [ ] **Step 6: Remove the re-export and verify**

Delete the re-export from `Field.tsx`, then run: `npm run check`

- [ ] **Step 7: Commit**

```bash
git add -A src
git commit -m "Point the Alert importers at the new file"
```

---

## Task 12: Badge

**Files:**
- Create: `src/components/ui/Badge.tsx`

**Interfaces:**
- Produces: `export function Badge(props: { tone?: BadgeTone; children: ReactNode; className?: string })` where `export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'`.

93 sites hand-style a count or status pill from `rounded-full` plus a size plus a background. Unlike the card, there is nothing existing to adopt, so this is the one new component in the plan.

- [ ] **Step 1: Write the component**

Create `src/components/ui/Badge.tsx`:

```tsx
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/**
 * A count or a status, said once.
 *
 * Ninety-odd places were each spelling out a pill from `rounded-full` plus a
 * size plus a background, which is how four different paddings and three
 * different text sizes ended up live at the same time. Tones map onto colours
 * that already exist — nothing new is introduced here.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'surface-sunken text-muted',
  accent: 'bg-amber-400 text-navy-900',
  success: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/12 dark:text-emerald-200',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-500/12 dark:text-amber-200',
  danger: 'bg-red-50 text-red-800 dark:bg-red-500/12 dark:text-red-200',
}

export function Badge({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full px-2 py-0.5 font-mono text-[11.5px] font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
```

The mono face is deliberate — the `.app-ui .eyebrow` comment records that mono's job in the app is "numerals and counts", which is exactly what a badge holds.

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`

Expected: `tsc -b` clean. Run `npm run build` only at this step, not `npm run check` — the
component is unused until step 3, and lint is the gate that would object. The full check
runs at step 4, once it has call sites.

- [ ] **Step 3: Adopt it at the count sites**

Run: `grep -rn "rounded-full" src --include=*.tsx | grep -E "font-mono|text-\[1[01]" | grep -v landing`

Replace each hand-styled count pill with `<Badge>`. Where a site passes a colour that is not one of the five tones, add it to `TONES` rather than passing `className` — a `className` escape hatch used more than once is a missing tone.

- [ ] **Step 4: Verify**

Run: `npm run check`

Expected: passes, lint at 23 warnings / 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "Add Badge and route the count pills onto it"
```

---

## Self-review

Checked against the spec:

- **Section 3 rules 1-8** — Tasks 2-9. Rule 9 (reduced motion) is deliberately excluded and recorded in Global Constraints.
- **Section 4** — Tasks 10 and 11.
- **Section 5** — Task 12.
- **Sections 1, 2, 6** — not in this plan by design; they are the wide mechanical sweeps and get their own plan.

Type consistency: `EmptyArt` and `EmptyState` keep the names and prop shapes they have in `Tabs.tsx` today. `Alert`'s `tone` union is `'info' | 'success' | 'error'`, matching `Field.tsx`. `BadgeTone` is a new and separate union with five members and is not interchangeable with `Alert`'s — that is intentional, since a badge has tones an alert does not.

Placeholder scan: every code step carries the actual code. The two steps that cannot (Task 7 step 3 and Task 12 step 3 depend on grep output that varies) state the rule to apply and the exception to watch for, rather than deferring the decision.

Task 8's drawer direction was confirmed against the source before the plan was finished:
the panel is `inset-y-0 left-0` with `initial={{ x: '-100%' }}`, so the step carries the
exact three lines to replace rather than a rule to apply.

Remaining soft spot: Task 12 step 3 replaces badge sites found by grep, and some of the
93 will be shapes a `Badge` should not absorb — an avatar, a dot indicator, a pill that is
really a button. The step says to add a tone rather than reach for `className`, but
judging which sites are genuinely badges needs eyes on each one. Expect that step to
convert fewer than 93.
