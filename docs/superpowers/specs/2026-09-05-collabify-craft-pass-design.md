# Collabify craft pass — foundations, primitives and patterns

Date: 2026-09-05
Status: approved design, ready for implementation planning

## Goal

Raise the craft of the Collabify app UI — hierarchy, density, consistency and motion —
without changing what the product does or how it is coloured.

The work is drawn from Emil Kowalski's design engineering skills (`emilkowalski/skills`),
chiefly `emil-design-eng`, `animate`, `review-animations`, and the typography and
materials sections of `apple-design`. Values cited below come from those documents
rather than being invented here.

## Constraints

Fixed, and not open for reinterpretation during implementation:

1. **Colours do not change.** Not the `navy-*` or `amber-*` ramps, not
   `surface` / `surface-raised` / `surface-sunken`, not `text-ink` / `text-muted` /
   `text-faint`, not `border-line` / `border-line-strong`. Shadows introduced by this
   spec are tinted with the existing navy (`rgb(16 22 55)`), which adds no new colour.
2. **The landing page is frozen.** Nothing under `src/components/landing/` or
   `src/pages/Landing.tsx` is touched, including the hero and the 3D board.
3. **No new dependencies.** base-ui, Sonner, cva and zustand were considered and
   rejected: the existing hand-rolled primitives already match the design system, and a
   dependency overhaul on a shipped Phase 2 is not warranted.
4. **Existing project rules hold** — no hardcoded colours, both themes defined in the
   same block, dark mode via the `.dark` class, reduced motion honoured, desktop layout
   first, copy in sentence case.

## Scope

**In scope:** the 40 app pages plus auth, all components outside `landing/`, and the
token layer in `src/styles/index.css`.

**Out of scope, deliberately:** per-page layout reorganisation. Of the four problems
identified with the user, this spec addresses three — weak hierarchy, excess density,
and page-to-page inconsistency. The fourth, "scattered: too much hunting and scrolling",
is per-page composition work across 40 pages and requires its own spec, written after
these foundations exist.

## Evidence

Measured across `src/` before any change:

| Finding | Measurement |
| --- | --- |
| Distinct hardcoded font sizes | 29 |
| Uses of the five sizes inside a 2px band (12 / 12.5 / 13 / 13.5 / 14px) | 621 |
| `font-medium` vs `font-semibold` vs `font-bold` | 137 / 46 / 15 |
| Shadow uses across 135 components | 11 `shadow-lift` plus 4 one-offs |
| Half-step spacing uses (`gap-1.5`, `gap-2.5`) | 168 |
| Half-step `space-y` uses | 46 |
| Distinct radius values | 10 |
| Files hand-assembling a card from utility strings | 24 |
| Shared pattern components that exist | `PageHeader` only |
| `EmptyState` location | exported from `ui/Tabs.tsx` |
| `Alert` location | exported from `ui/Field.tsx` |
| Overlays with an enter or exit transition | 0 of 4 |
| Button call sites with press feedback | 3 of 127 |
| Hover-motion sites gated for touch | 0 of 4 |

Two root causes explain most of it. Hierarchy is weak because the type ramp has 29 steps
with five crammed into a 2px band, where the eye cannot separate them, and weight is not
helping — `font-medium` outnumbers every other weight combined. Consistency is poor
because there is no shared pattern layer to be consistent with: `Card`, `Badge`, `Table`
and `Section` do not exist, and `EmptyState` and `Alert` are buried inside unrelated
files where nobody finds them.

## Section 1 — Type ramp

Twenty-nine sizes collapse to seven named steps. Each step fixes size, weight, leading
and tracking together; hierarchy comes from the set, not from size alone.

| Token | Size | Weight | Leading | Tracking | Font | Absorbs |
| --- | --- | --- | --- | --- | --- | --- |
| `display` | 30px | 600 | 1.08 | -0.028em | Outfit | 26, 30 |
| `title` | 20px | 600 | 1.2 | -0.02em | Outfit | 19, 22 |
| `heading` | 16px | 600 | 1.3 | -0.01em | Outfit | 16, 17, 18 |
| `body` | 14px | 400 | 1.55 | -0.005em | Instrument Sans | 14, 14.5, 15, 15.5 |
| `secondary` | 13px | 400 | 1.5 | 0 | Instrument Sans | 12, 12.5, 13, 13.5 |
| `caption` | 11.5px | 500 | 1.4 | +0.01em | Instrument Sans | 9.5, 10, 10.5, 11, 11.5 |
| `eyebrow` | 11px | 500 | 1 | 0.18em, uppercase | JetBrains Mono | unchanged |

Notes:

- `body` and `secondary` sit 1px apart, which is invisible on its own. They are
  separated by colour as well: `body` uses `text-ink`, `secondary` uses `text-muted`.
  This is intentional, and is why seven steps can replace twenty-nine.
- Body text gets **larger**. The dominant body size rises from 13.5px to 14px and the
  dominant secondary size from 12.5px to 13px, with leading up to 1.55. This is part of
  the density fix, not only a hierarchy fix.
- The existing tracking ramp is already correct and carries over unchanged. `caption`
  gains slightly positive tracking, the only addition.
- Steps ship as CSS classes in `src/styles/index.css`. Arbitrary values such as
  `text-[13.5px]` are removed from the codebase so the drift cannot return.

## Section 2 — Elevation

Four levels. The assignment matters more than the values.

| Level | Name | Components |
| --- | --- | --- |
| 0 | `flat` | Inset regions: table headers, input wells, empty states, existing `surface-sunken` areas |
| 1 | `card` | Default resting card: the 24 hand-assembled cards, `DashSection`, list row containers |
| 2 | `overlay` | Anchored floating surfaces: `FilterPopover`, `NotificationBell` panel, `Select` menu, tooltips |
| 3 | `modal` | `Modal` and `ConfirmDialog` only, paired with the scrim |

Light mode values, as two-layer composites — a tight contact shadow plus a diffused drop:

| Level | Shadow |
| --- | --- |
| 1 | `0 1px 2px rgb(16 22 55 / .04), 0 1px 3px rgb(16 22 55 / .03)` |
| 2 | `0 4px 12px rgb(16 22 55 / .08), 0 1px 3px rgb(16 22 55 / .05)` |
| 3 | `0 16px 40px rgb(16 22 55 / .16), 0 4px 10px rgb(16 22 55 / .08)` |

Shadows are navy-tinted rather than black. A black shadow over navy-tinted surfaces
reads dirty; a navy one reads as the same light source. This introduces no new colour.

**Dark mode expresses the same four levels differently.** A drop shadow on a near-black
surface is invisible, so in dark mode elevation is carried by surface lightness stepping
up (`surface-sunken` to `surface` to `surface-raised`) plus a 1px inset top highlight,
`inset 0 1px 0 rgb(255 255 255 / .04)`, reading as light catching the top edge. Shadows
are retained in dark mode only on levels 2 and 3, deeper than their light-mode
counterparts, purely to separate floating surfaces from the page.

**Borders change at level 1.** In light mode a level-1 card drops its `border-line` and
is defined by shadow alone; keeping both reads heavy. In dark mode a level-1 card keeps
the hairline border and has no shadow. This is the most visible single change in the
spec, and is reversible by one token if it proves wrong.

## Section 3 — Spacing rhythm and radius

Half-steps are removed. The 6px, 10px and 14px values (`gap-1.5`, `gap-2.5`, `p-3.5`,
`space-y-1.5`, `space-y-2.5`) do not read as a distinct amount of space; they read as an
accident, and they are the same failure mode as the 2px type band.

Two scales, each with one job:

| Scale | Values | Used for |
| --- | --- | --- |
| Inside a component | 4 · 8 · 12 · 16 | Gaps between elements within a card or row |
| Between blocks | 16 · 24 · 32 | Section rhythm down a page |

**Card padding rises** from 16px to 20px on desktop, staying 16px on mobile. With the
larger body text and looser leading from section 1, this completes the density fix.

Radius drops from ten values to four, named by role so a wrong choice is obvious at the
call site:

| Token | Value | Applies to | Replaces |
| --- | --- | --- | --- |
| `--radius-control` | 8px | Inputs, selects, small buttons | `rounded-lg`, `rounded-md` |
| `--radius-card` | 12px | Cards, panels, popovers | `rounded-xl` |
| `--radius-modal` | 16px | Dialogs only | `rounded-2xl` |
| `--radius-pill` | 9999px | Pills, avatars, badges | `rounded-full` |

One-off values (`rounded-[5px]`, `rounded-[26px]`, `rounded-3xl`) are absorbed into the
nearest role token.

## Section 4 — Motion

New tokens, alongside the existing `--ease-out-soft` and `--ease-snap`, which are kept:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--dur-press: 140ms;
--dur-fast: 180ms;
--dur-base: 220ms;
--dur-overlay: 260ms;
```

Nine rules:

1. **Overlays gain enter and exit transitions**, each using a defined token rather than a
   loose number. `Modal` scales .96 to 1 over `--dur-base` from centre. `Toast`
   translates `translateY(100%)` to 0 over `--dur-overlay` and exits through the same
   edge it entered. Popovers scale .97 with a fade over `--dur-fast`.
2. **Overlay motion uses CSS transitions, never keyframes.** Toasts and toggles can be
   fired twice in a second; transitions retarget from the current value, keyframes
   restart from zero.
3. **Popovers scale from their trigger.** `transform-origin` is set to the anchor for
   `FilterPopover`, `NotificationBell` and `Select`. Modals are exempt and stay centred.
4. **Press feedback on every pressable element**, in one of two forms. Discrete controls
   — icon buttons, chips, close buttons, the bell and popover triggers — take
   `active:scale(0.97)` over `--dur-press`. Full-width list rows and card-sized targets
   take a background-tint press state instead, because scaling a full-width row reads as
   the page flexing rather than as a button responding. Every raw `<button>` that
   bypasses `Button.tsx` gets one form or the other; none are left with no press state.
5. **Hover motion is gated** behind `@media (hover: hover) and (pointer: fine)` at all
   four `hover:-translate-y-*` sites and on card hover states. Touch devices fire hover
   on tap; this matters for the tablet the project is moving to.
6. **Hover durations drop from 300ms to 200ms** across the 23 affected sites. Hover is a
   tens-of-times-per-day interaction, where 300ms reads sluggish.
7. **Motion shorthands become full transform strings.** `animate={{ x: 0 }}` in
   `AppShell.tsx:199` becomes `animate={{ transform: "translateX(0)" }}`. The mobile nav
   drawer opens while the main thread is busy navigating, which is exactly when the
   rAF-driven shorthand drops frames.
8. **Reduced motion is narrowed.** The current block sets
   `transition-duration: 0.01ms !important` on every element, which removes colour and
   opacity feedback along with movement. It becomes transform-only, so those users keep
   comprehension-aiding transitions. The existing rationale for the blanket rule — that
   Windows reports reduced motion on many machines — is preserved by this narrowing
   rather than contradicted by it.
9. **Stagger widens** from the current 20ms `Reveal` delays to 40ms, inside the 30–80ms
   range. Nav and tab switching receive no animation at all, per the frequency gate.

## Section 5 — Primitives

The 13 files in `src/components/ui/`. Two changes are structural.

| File | Change |
| --- | --- |
| `Tabs.tsx` | `EmptyState` is extracted to `ui/EmptyState.tsx` |
| `Field.tsx` | `Alert` is extracted to `ui/Alert.tsx` |
| `Modal.tsx` | Enter/exit motion, level 3, `--radius-modal`, scrim fade |
| `Toast.tsx` | Enter/exit via transitions, level 2 |
| `Select.tsx` | Origin-aware, level 2, `--dur-base` |
| `FilterPopover.tsx` | Origin-aware, level 2, `--dur-base` |
| `Button.tsx` | Token adoption, hover gating; `active:scale` already present |
| `ConfirmDialog.tsx` | Rebuilt on `Modal` |
| `Icon.tsx`, `PageLoading.tsx`, `RoleChoice.tsx`, `GoogleButton.tsx`, `FileDrop.tsx` | Token adoption only |

Extracting `EmptyState` and `Alert` is not tidying. They are undiscoverable where they
are, which is why 24 files hand-rolled a card rather than looking for one.

## Section 6 — Shared patterns

Six new files under `src/components/ui/`:

| Component | Purpose |
| --- | --- |
| `Card.tsx` | Absorbs the 24 hand-assembled cards. Props for elevation level and padding |
| `EmptyState.tsx` | Relocated from `Tabs.tsx`, now discoverable |
| `Alert.tsx` | Relocated from `Field.tsx`, now discoverable |
| `Badge.tsx` | Counts and status pills, currently ad-hoc across the app |
| `SectionHeader.tsx` | Generalises `DashSection`'s icon plus title plus count header |
| `ListRow.tsx` | The repeated row pattern in `AttentionList`, `DeadlineList`, `TaskDigest`, `StalledGroups` and others |

## Implementation order

Strictly in this order, because each layer cascades into the next:

1. **Layer 0 — tokens.** Type ramp, elevation, spacing, radius and motion tokens in
   `src/styles/index.css`. No component changes.
2. **Layer 1 — primitives.** The 13 `ui/` files, including the two extractions.
3. **Layer 2 — patterns.** The six new components.
4. **Layer 3 — call-site migration.** Directory by directory, in descending size:
   `tasks/` (27), `dashboard/` (13), `analytics/` (12), `projects/` (10), `reports/` (9),
   `groups/` (8), `messages/` (7), `app/` (7), `classes/` (6), `calendar/` (3),
   `syllabus/` (3), then `pages/`.

## Verification

- `npm run build` after every layer and every migrated directory. `tsc -b` runs first and
  catches most breakage.
- Lint held at the standing baseline of 23 warnings and 0 errors. Any increase is a
  regression to fix, not to accept.
- Browser verification is required for the four overlay enter/exit transitions, the
  reduced-motion change, dark-mode elevation, and hover gating at tablet width. None of
  these can be judged from code alone.
- Dark mode is checked on every migrated directory, because the elevation model differs
  by theme and a light-only check will miss it.

## Success criteria

Measurable against the evidence table above:

| Metric | Before | After |
| --- | --- | --- |
| Distinct font sizes | 29 | 7 |
| Half-step spacing uses | 214 | 0 |
| Distinct radius values | 10 | 4 |
| Hand-assembled cards | 24 | 0 |
| Overlays with enter/exit motion | 0 of 4 | 4 of 4 |
| Ungated hover-motion sites | 4 | 0 |
| Button sites with a press state (scale or tint) | 3 of 127 | 127 of 127 |
| Lint | 23 warnings / 0 errors | unchanged |

## Risks

1. **Cards losing their light-mode border is the most visible change.** If it reads
   wrong it reverts by restoring one token, not by unpicking the migration.
2. **Dark-mode elevation cannot be verified from code.** Surface-lightness stepping is
   subtle and needs a real browser in both themes.
3. **Card padding rising to 20px reduces content above the fold** on the densest pages
   (`Analytics`, `MyTasks`). If that proves costly, those pages can opt into 16px padding
   through a `Card` prop rather than abandoning the rhythm.
4. **Disk space.** The machine had 8 MB free on C: at the time of writing. A Vite dev
   server needs room for its cache, so browser verification may be blocked until that is
   cleared.
5. **Scope creep into Layer 3.** Migration will surface page-layout problems. Those are
   recorded for the follow-up spec, not fixed in passing.
