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

**Levels 0 and 1 do not get a shadow, in either theme.** This preserves an existing,
deliberate decision already recorded in `.app-ui`:

```css
/* A card does not float. Only things that genuinely sit above the page —
   a menu, a dialog, a popover — get a shadow, and `--shadow-lift` is it. */
--shadow-card: none;
```

Measurement supports keeping it. Inside `.app-ui` the page and a card are both
`rgb(255,255,255)` in light mode — **zero fill separation** — so the 1px hairline is the
only thing distinguishing a card from the page. A shadow cannot replace it, and a shadow
under a white card on a white page reads as a smudge rather than as depth. Level 1 keeps
its `--line` hairline and no shadow, in both themes.

**The real work at this section is splitting the one floating elevation into two.**
Today `--shadow-lift` serves menus, popovers and dialogs alike, so a dialog carries the
same weight as a dropdown. Bigger surfaces should read as heavier:

| Level | Light | Dark |
| --- | --- | --- |
| 2 `overlay` | `0 2px 4px rgb(16 22 55 / .06), 0 8px 24px rgb(16 22 55 / .12)` — today's `--shadow-lift`, retained | border `rgba(255,255,255,0.16)` plus `0 8px 24px rgb(0 0 0 / .5)` |
| 3 `modal` | `0 8px 16px rgb(16 22 55 / .10), 0 24px 56px rgb(16 22 55 / .20)` | border `rgba(255,255,255,0.20)` plus `0 24px 56px rgb(0 0 0 / .65)` |

Shadows stay navy-tinted in light mode, matching the existing `--shadow-lift`. Dark mode
also steps border brightness, for the reason set out below.

**Measured baseline, taken from the running app inside `.app-ui`.** An earlier revision
of this spec measured `document.body` instead — the landing-page scope sitting behind the
app shell — and drew the opposite conclusion. These are the correct figures, professor
dashboard at 1280px:

| | Light | Dark |
| --- | --- | --- |
| App page | `rgb(255,255,255)`, L* 100 | `rgb(10,14,36)`, L* 4.6 |
| Card | `rgb(255,255,255)`, L* 100 | `rgb(16,21,47)`, L* 7.7 |
| Fill separation | **0.0 L\*** | **3.1 L\*** |
| Border, composited | `rgb(226,227,231)` | `rgb(42,47,70)` |
| Border vs page | **-9.7 L\*** | **+15.3 L\*** |

The hairline is the primary edge signal in both themes, and the only one in light mode.
That is why level 1 keeps it and gains no shadow.

In dark mode the fill step between page and card is 3.1 L*, at the dark end where
perception is most compressed, while the border sits 15.3 L* above the page. There is not
enough headroom to fit distinguishable lightness levels inside 3.1 L*, so the floating
levels step **border brightness** rather than fill: 0.11 at level 1 (today's value,
unchanged), 0.16 at level 2, 0.20 at level 3.

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

| Token | Value | Status | Applies to | Replaces |
| --- | --- | --- | --- | --- |
| `--radius-control` | 8px | **new** | Inputs, selects, small buttons | `rounded-lg`, `rounded-md` |
| `--radius-card` | 12px | **already exists in `.app-ui`** | Cards, popovers | `rounded-xl` |
| `--radius-panel` | 14px | **already exists in `.app-ui`** | Dialogs, large panels | `rounded-2xl` |
| `--radius-pill` | 9999px | **new** | Pills, avatars, badges | `rounded-full` |

`--radius-card` and `--radius-panel` are already defined and correct; the work there is
routing call sites onto them, not creating them. The spec originally proposed a
`--radius-modal` at 16px — that is dropped in favour of the existing `--radius-panel` at
14px, because inventing a parallel token beside a working one is the drift this section
exists to remove.

One-off values (`rounded-[5px]`, `rounded-[26px]`, `rounded-3xl`) are absorbed into the
nearest role token.

**Before writing any token, read the whole `.app-ui` block.** Two revisions of this spec
proposed tokens that already existed, because the evidence was gathered by grepping
utility classes rather than by reading the token definitions. The token block is the
source of truth.

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
| `Modal.tsx` | Enter/exit motion, level 3, `--radius-panel`, scrim fade |
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
  reduced-motion change, and hover gating at tablet width. None can be judged from code.
- Dark-mode elevation has a measured baseline already captured (§2), taken from the
  running app on the professor dashboard. After Layer 0 lands, the same measurement is
  repeated and compared: level 2 and level 3 must each show a border-brightness delta
  above the level below it that exceeds the 4.1 L* fill step, or the level is not
  carrying its weight and the alpha values need raising.
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

1. **Card padding rising to 20px reduces content above the fold** on the densest pages
   (`Analytics`, `MyTasks`). If that proves costly, those pages can opt into 16px padding
   through a `Card` prop rather than abandoning the rhythm.
2. **Reduced motion cannot be verified with the available tooling.** The browser tools
   emulate colour scheme but not `prefers-reduced-motion`, so §4 rule 8 can only be
   checked by forcing the CSS by hand. That tests the rule but not whether the media
   query is wired correctly. It needs a real browser with the OS setting on.
3. **Shadow subtlety may not survive the target device.** Verification here is on a
   desktop panel. Light-mode level-1 elevation is deliberately faint, and faint shadows
   are exactly what a different panel renders differently. The Xiaomi Pad 7 the project
   is moving to should be checked before light-mode elevation is considered settled.
4. **Scope creep into Layer 3.** Migration will surface page-layout problems. Those are
   recorded for the follow-up spec, not fixed in passing.

## Risks resolved during design

Recorded so the reasoning is not lost.

- **Cards losing their light-mode border** is no longer proposed at all. Measurement in
  the correct scope showed light-mode fill separation is 0.0 L* — page and card are the
  same white — so the hairline is the only edge signal and removing it would erase the
  card. Level 1 keeps its border in both themes. See §2.
- **Dark-mode elevation could not be verified from code.** It has now been measured in a
  running browser in both themes. Doing so corrected this spec twice: first replacing an
  unbuildable surface-lightness model, then — after the measurement was retaken in
  `.app-ui` rather than `document.body` — removing the level-1 shadow entirely. See §2.
- **Disk space** blocked browser verification at 8 MB free. The machine now has 17 GB
  free and the dev server runs.
