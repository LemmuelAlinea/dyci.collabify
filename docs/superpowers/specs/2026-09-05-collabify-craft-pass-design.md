# Collabify craft pass — stop bypassing the token layer

Date: 2026-09-05
Status: rewritten against `src/styles/index.css`, superseding revisions 1-3

## What changed in this revision, and why

The first three revisions of this spec were wrong in the same way. Evidence was gathered
by grepping Tailwind utility classes in `.tsx` files and never by reading
`src/styles/index.css`, which is where this project's design decisions actually live and
are argued for in comments. That produced three proposals to overturn deliberate,
documented choices:

- "11 shadows across 135 components" was read as drift. It is the design. `.app-ui`
  carries `--shadow-card: none` with the comment *"A card does not float"*, and the block
  comment at lines 169-187 explains why the signed-in app uses a white ground with
  hairline separation while the landing page uses a tinted canvas with lifted cards.
- A four-level elevation scale was specified twice, once via surface lightness and once
  via border brightness. Both were solving a problem the token layer had already solved
  deliberately.
- A seven-step type ramp was specified that would have re-imposed the 11px mono uppercase
  eyebrow across the app, undoing an explicit decision (lines 292-309) to de-monospace it
  because it *"made every screen announce itself before saying anything."*
- `Card.tsx`, `--radius-card` and `--radius-modal` were proposed as new. `.app-ui .card`,
  `--radius-card` and `--radius-panel` already exist.

The token layer is not the problem. **Call sites bypass it.** That is what this spec now
addresses, and it is a smaller and more accurate piece of work.

## Constraints

1. **Colours do not change.** No ramp stop, no surface, ink, line or shadow token value.
2. **The token layer's decisions stand.** Cards do not float. The app ground is white with
   hairline separation. The app eyebrow is 12px sans, not mono. `.app-ui` overrides
   `:root` on purpose and the two scopes are allowed to disagree.
3. **The landing page is frozen** — nothing under `src/components/landing/` or
   `src/pages/Landing.tsx`, and nothing in the `:root` / `.dark` token blocks that serve it.
4. **No new dependencies.**
5. **`scripts/contrast.mjs` must keep passing.** It parses `index.css` by string-matching
   the block openers `@theme`, `@layer base`, `:root {`, `.dark {`, `.app-ui {`,
   `.dark .app-ui {`, `.app-ui .btn {`. Those openers and their order must survive intact
   or the script throws.
6. **`npm run check` must pass** — typecheck, lint, test, contrast, a11y-names,
   schema-drift.

## Scope

The 40 app pages plus auth, and components outside `landing/`.

Out of scope: per-page layout reorganisation ("scattered — too much hunting and
scrolling"). That needs its own spec once these are done.

## Evidence

Measured across `src/`, excluding `landing/`, with the token layer read first.

| Finding | Count | Is there a token for it? |
| --- | --- | --- |
| Headings overriding `.app-ui main h1/h2/h3` with inline `text-[Npx]` | 86 | **Yes — being bypassed** |
| Files hand-rolling a card instead of `.card` | 20 | **Yes — being bypassed** (`.card` is used correctly 71 times) |
| Body-text uses across 12 / 12.5 / 13 / 13.5 / 14px | 621 | **No — real gap** |
| Badge and pill sites with duplicated styling | 93 | **No — real gap** |
| Half-step spacing uses (`gap-1.5`, `gap-2.5`, `space-y-1.5`, `space-y-2.5`) | 214 | No |
| Overlays with an enter or exit transition | 0 of 4 | No |
| Button sites with a press state | 3 of 127 | No |
| Hover-motion sites gated for touch | 0 of 4 | No |
| `.app-ui .eyebrow` uses — **do not touch** | 56 | Yes, working |

Two categories, and they want different treatment. Where a token exists and is bypassed,
the fix is deletion at the call site. Where no token exists, the fix is a small addition
that matches the conventions already in the file.

## Section 1 — Complete the type scale, and stop overriding it

The token layer defines headings (`main h1` at `clamp(23px, 2.3vw, 27px)`, `h2` at 17px,
`h3` at 15.5px, all weight 600) and the app eyebrow (12px sans, weight 500,
`--ink-faint`). It defines nothing for body text, which is why 621 call sites invented
five mutually indistinguishable sizes between 12 and 14px.

**Add the missing base, in the smallest way that closes the gap:**

```css
.app-ui {
  font-size: 14px;
  line-height: 1.55;
}
```

```css
.app-ui .type-secondary {
  font-size: 13px;
  line-height: 1.5;
}
```

Body becomes the inherited default and needs no class at all. Secondary is one class.
Colour continues to come from the existing `.text-ink` / `.text-muted` / `.text-faint`
utilities, which already work, rather than being baked into the size steps.

The resulting app scale, top to bottom: 23-27 / 17 / 15.5 / **14** / **13** / 12. Three
of those already existed, one is the eyebrow, two are new.

**Then remove the 86 inline heading overrides** so `main h1/h2/h3` actually applies. That
ramp was written to be one decision in one place and is currently overridden at 86 call
sites, which is precisely the drift it was created to stop.

**Not in scope:** `.eyebrow`, in either scope. The app override at 12px sans is
deliberate and is used 56 times.

## Section 2 — Adopt the card class that already exists

`.app-ui .card` sets `background: var(--surface)`, `border: 1px solid var(--line)`,
`border-radius: var(--radius-card)`. It is used correctly in 71 places. Twenty files
spell the same three properties out by hand instead, which is how the padding and radius
drift in the original comment happened.

Those 20 move onto `.card`. No new component, no token changes, no visual change where
the hand-rolled version already matched — and a visual correction where it did not.

## Section 3 — Motion

The largest genuinely-unaddressed area. The token layer carries `--ease-out-soft` and
`--ease-snap` in `@theme` and nothing else about motion.

**Add durations beside the existing easings in `@theme`:**

```css
--dur-press: 140ms;
--dur-fast: 180ms;
--dur-base: 220ms;
--dur-overlay: 260ms;
```

`--ease-out-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`) is already a strong ease-out and is
used for entrances. No new easing token is needed; the earlier proposal to add
`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` is dropped as a near-duplicate.

Rules:

1. **Overlays gain enter and exit transitions.** `Modal` scales .96 to 1 over
   `--dur-base`. `Toast` translates `translateY(100%)` to 0 over `--dur-overlay`, exiting
   through the same edge. `FilterPopover` and the `NotificationBell` panel scale .97 with
   a fade over `--dur-fast`. All four currently appear and vanish instantly.
2. **Transitions, not keyframes,** for all four — they can be triggered rapidly, and
   transitions retarget from the current value where keyframes restart from zero.
3. **Popovers scale from their trigger.** `transform-origin` at the anchor for
   `FilterPopover`, `NotificationBell` and `Select`. `Modal` stays centred.
4. **Press feedback on every pressable element.** Discrete controls take
   `active:scale(0.97)` over `--dur-press`. Full-width list rows and card-sized targets
   take a background-tint press state instead, because scaling a full-width row reads as
   the page flexing. Currently 3 of 127 sites have any press state.
5. **Hover motion gated** behind `@media (hover: hover) and (pointer: fine)` at the four
   `hover:-translate-y-*` sites. Touch fires hover on tap; this matters for the tablet.
6. **Hover durations 300ms to 200ms** across the 23 affected sites.
7. **Full transform strings instead of Motion shorthands.** `animate={{ x: 0 }}` at
   `AppShell.tsx:199` becomes `animate={{ transform: "translateX(0)" }}`. The nav drawer
   opens while the main thread is busy, which is when the rAF-driven shorthand drops
   frames.
8. **Stagger widens** from 20ms to 40ms in `Reveal`, inside the 30-80ms range.
9. **Reduced motion gains press and colour feedback back.** The existing block is
   deliberate and its rationale (lines 409-418) stands: movement is what causes vestibular
   trouble, and `[data-reveal="fade"]` is already exempted so content still arrives. But
   `transition-duration: 0.01ms !important` on `*` also removes hover colour fades and
   button press timing, which are not movement. Extend the existing opt-out pattern with a
   second exemption for colour and opacity feedback rather than replacing the approach.
   **This changes a documented decision, so it ships last and separately, and is the one
   item here that should be reverted rather than debated if it looks wrong.**

## Section 4 — Extract the two misfiled primitives

`EmptyState` is exported from `ui/Tabs.tsx` and `Alert` from `ui/Field.tsx`. Both move to
`ui/EmptyState.tsx` and `ui/Alert.tsx`. Imports update; no behaviour changes.

This is not tidying. Components nobody can find are components nobody uses, which is how
20 files came to hand-roll a card while `.card` sat in the stylesheet.

## Section 5 — Badge

Ninety-three sites style a count or status pill by hand from `rounded-full` plus a size
plus a background. This is the one place a genuinely new component is justified, because
unlike `.card` there is nothing existing to adopt.

`ui/Badge.tsx`, with tone variants drawn from existing colour tokens only.

## Section 6 — Half-step spacing sweep

214 uses of `gap-1.5`, `gap-2.5`, `space-y-1.5` and `space-y-2.5` — 6px and 10px values
sitting between the whole steps. They do not read as a distinct amount of space. Each
collapses to its nearest neighbour on a 4 / 8 / 12 / 16 scale inside components and
16 / 24 / 32 between blocks.

Lowest value in this spec and the largest diff. It runs last, and can be dropped without
affecting anything above it.

## Implementation order

1. **Section 3, motion** — the highest-value and most self-contained. Rules 1-8 only.
2. **Section 4, extractions** — small, unblocks nothing but is cheap.
3. **Section 5, `Badge`.**
4. **Section 1, type** — token addition first, then the 86 heading overrides.
5. **Section 2, card adoption** — the 20 files.
6. **Section 6, spacing sweep.**
7. **Section 3 rule 9, reduced motion** — last and alone, being the only change to a
   documented decision.

Sections 1 and 2 deliberately run after motion: they are wide, mechanical diffs, and
putting them first would bury the changes worth looking at.

## Verification

- `npm run check` after every section — typecheck, lint, test, contrast, a11y-names,
  schema-drift. Lint holds at 23 warnings / 0 errors.
- `scripts/contrast.mjs` specifically after any `index.css` edit, since it string-matches
  block openers and will throw if their order changes.
- Browser verification in **both themes** for section 3 rules 1-3, and at tablet width for
  rule 5. Neither can be judged from code.
- After section 1's token addition, confirm in the browser that `main h1/h2/h3` still
  render at their ramp sizes and that the new 14px base has not changed heading sizes.

## Success criteria

| Metric | Before | After |
| --- | --- | --- |
| Inline heading overrides of the `main` ramp | 86 | 0 |
| Files hand-rolling a card | 20 | 0 |
| Distinct body-text sizes in call sites | 5 | 2 (inherited 14, `.type-secondary` 13) |
| Hand-styled badge sites | 93 | 0 |
| Overlays with enter/exit motion | 0 of 4 | 4 of 4 |
| Button sites with a press state | 3 of 127 | 127 of 127 |
| Ungated hover-motion sites | 4 | 0 |
| Half-step spacing uses | 214 | 0 |
| `.app-ui .eyebrow` uses | 56 | 56, untouched |
| Token values changed | — | 0 |
| Lint | 23 warnings / 0 errors | unchanged |

## Risks

1. **Section 1's 14px base changes inherited sizes app-wide.** Anything currently relying
   on the browser default of 16px, or on Tailwind's `text-base`, shifts. The 86 heading
   overrides are removed in the same section, so heading sizes must be re-checked in the
   browser rather than assumed.
2. **Section 3 rule 9 alters a documented decision.** Isolated to its own step at the end
   for exactly that reason.
3. **Reduced motion cannot be verified with the available tooling** — colour scheme can be
   emulated, `prefers-reduced-motion` cannot. Rule 9 needs a real browser with the OS
   setting on.
4. **Sections 1, 2 and 6 are wide mechanical diffs** across dozens of files. Each runs as
   its own commit so a bad sweep reverts cleanly.

## Removed from earlier revisions

Recorded so the reasoning is not relitigated.

- **The four-level elevation scale**, in both its surface-lightness and border-brightness
  forms. `.app-ui` deliberately gives cards no shadow, and the block comment explains why
  dense reading surfaces do not want depth.
- **Light-mode card border removal.** Page and card are both `rgb(255,255,255)` inside
  `.app-ui`; the hairline is the only edge signal and removing it would erase the card.
- **`Card.tsx`.** `.app-ui .card` already exists and is used 71 times.
- **`--radius-control`, `--radius-modal`, `--radius-pill`.** `--radius-card` and
  `--radius-panel` exist in two scopes with different values by design, and the radius
  drift that remains is not worth a sweep.
- **`--ease-out`.** `--ease-out-soft` already covers it.
- **The seven-step type ramp.** Four of its steps already existed; one would have undone
  the app's deliberate 12px sans eyebrow.
