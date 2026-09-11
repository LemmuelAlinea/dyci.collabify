# Collabify redesign — read this before anything else

You are redesigning the signed-in surface of **Collabify**, a coursework
platform used by BSIT classes at Dr. Yanga's Colleges. Three roles exist —
student, professor, admin — and this brief covers **student and professor
only**. The landing page and the admin console are out of scope.

Every other file in this folder describes one screen. This file describes the
rules that apply to all of them. **Re-read this file at the start of every
screen you build**, because the constraints below are the ones most easily
forgotten halfway through.

---

## 1. What you are making

A **parallel mock** of the product, living at `/redesign/*`, that nobody uses
yet. The existing app stays exactly as it is and stays reachable at its own
routes. You are proposing a new design, not migrating to one.

So there are two hard boundaries:

**You may create files only inside these paths:**

```
src/redesign/**            all new components, pages, styles, helpers
docs/redesign/**           notes back to the reader, if you need any
```

**You may edit exactly one file outside them** — `src/App.tsx` — and only to
add the lazy import and the route block in §3. Nothing else in `src/App.tsx`
may change.

**You may not touch, at all:**

```
src/styles/index.css       the live theme — a token edit changes the real app
src/components/**          every existing component
src/pages/**               every existing page
src/lib/**                 types, API, helpers
supabase/**                the schema
tailwind config, vite config, package.json
```

If you find yourself wanting to "just tweak" a shared component, that is the
signal you are about to break the live product. Copy what you need into
`src/redesign/` instead and change the copy.

---

## 2. Do not look at the current app for design ideas

This is the instruction most likely to be quietly disobeyed, so it is stated
plainly.

You may read the existing code **to learn what a screen does** — what data it
shows, what a control means, what happens when it is pressed. That is the point
of the per-screen files in this folder, and they already contain it.

You may **not** carry over the existing *visual* design: not its layout, not
its card shapes, not its spacing rhythm, not its component anatomy, not its
section order, not its hero blocks, not its stat-tile row, not its tab bar. If
your result could be mistaken for a restyle of the current app, you have made
the wrong thing.

Every screen file lists, under **Keep** and **Do not carry over**, which parts
are behaviour you must preserve and which are current-design habits you must
leave behind.

---

## 3. Where it lives and how it is reached

```
src/redesign/
  redesign.css            all new tokens and base styles, scoped (see §4)
  shell/                  the new navigation shell
  ui/                     the new primitives: button, field, card, dialog…
  pages/
    student/…
    professor/…
  fixtures/               static sample data (see §5)
  index.tsx               the catalogue page listing every mock screen
```

Routing, added to `src/App.tsx` alongside the other lazy imports:

```tsx
const Redesign = lazy(() => import('./redesign/index'))
...
{/* Design mock. Nothing here is wired to the live product. */}
<Route path="/redesign/*" element={<Redesign />} />
```

`src/redesign/index.tsx` owns its own nested `<Routes>` and its own shell. It
sits **outside** `ProtectedRoute` and **outside** `AppShell`, so the mock is
openable without signing in and cannot inherit the live shell's chrome.

`/redesign` itself is a plain index: a list of every screen you have built,
grouped by role, each a link. Make it genuinely useful — this is how the work
gets reviewed.

---

## 4. CSS isolation

`src/redesign/redesign.css` is imported **only** by `src/redesign/index.tsx`,
never by `src/main.tsx`.

Every custom property and every base rule in it must be scoped under a single
root class, `.rd`, which `index.tsx` puts on its outermost element:

```css
.rd {
  --rd-bg: …;
  --rd-ink: …;
}
.rd :where(h1) { … }
```

Never write a bare `:root`, `html`, `body`, `*` or element selector. The live
app and the mock share one document; an unscoped rule leaks into the real
product, which is the exact thing this whole arrangement exists to prevent.

Dark mode follows the app's existing mechanism — a `dark` class on `<html>` —
so write your dark variants as `.dark .rd { … }` or Tailwind's `dark:` prefix.
Do not add a second theme switch.

---

## 5. Data: use fixtures, not the database

These are mocks. Do **not** call Supabase, do not import from `src/lib/api/**`,
do not require a session.

Put realistic sample data in `src/redesign/fixtures/`. Realistic means:

- **Filipino names of real length.** "Ricardo Batumbakaldimagibababy" and
  "Miguel Alejandro Reyes Santos" are actual users. If your layout only works
  with "Jane Doe", your layout does not work.
- **Real class names**: "Quantitative Methods (Modelling and Simulation)",
  section "BSIT-4A", code "DBM-1589".
- **Awkward quantities.** One class and sixteen students. Eighteen syllabus
  weeks. A group of five. A project with eleven tasks, seven done. A
  professor with twenty groups across four classes.
- **The empty case and the overloaded case**, because both are in §8.

---

## 6. Responsiveness is a requirement, not a pass at the end

Every screen must be designed at **four** widths and verified at all four:

| | | |
|---|---|---|
| **360px** | small phone | the real floor — test here, not at 390 |
| **768px** | tablet / split window | the width most designs break at |
| **1280px** | laptop | the common case |
| **1920px+** | desktop monitor | must not become a narrow column in a sea of grey |

Rules that hold everywhere:

- **Design the desktop layout first, then fold it down.** A widened mobile
  column is not a desktop design. This product is used on laptops in labs.
- The page body never scrolls horizontally. Wide content — tables, boards,
  timelines — scrolls inside its own container with `overflow-x: auto`.
- Touch targets are at least 44×44px below 768px.
- Text never drops below 12px, and body copy is at least 14px on mobile.
- No fixed pixel heights on anything holding text. Philippine names, class
  names and syllabus topics are long.
- A layout that needs `truncate` to survive is usually a layout that needed to
  wrap. Truncate identifiers, not sentences, and never a person's name in a
  list they have to choose from.

---

## 7. What "professional, clean, not AI-looking" means here

Concretely, these are the tells to avoid:

- **Gradient text, glowing borders, glassmorphism on everything, floating
  blurred orbs behind cards.** One atmospheric flourish per page at most, and
  only where it carries meaning.
- **Every value in a rounded pill.** Pills mean status. If everything is a
  pill nothing is a status.
- **Emoji as iconography.** Use a real icon set, one weight, one size scale.
- **A card around every single element.** Cards separate things that are
  genuinely separate. Three nested cards means the hierarchy is doing no work.
- **Uniform grey text everywhere.** Three text weights maximum per screen, and
  they should mean primary / secondary / annotation.
- **Decorative numbers.** A big figure earns its size only if somebody acts on
  it.
- **Filler copy.** No "Manage your items here." Every sentence must say
  something only this product could say.

What good looks like instead: a clear reading order, generous but consistent
spacing, one accent colour used sparingly and always meaningfully, restrained
borders, and a typographic hierarchy you could read from across a room.

---

## 8. Every screen ships four states

Not just the happy one. For each screen the file tells you what each says:

1. **Loading** — a skeleton in the real layout's shape, not a centred spinner
   on a blank page. The page should not jump when data lands.
2. **Empty** — a first-run student has no classes; a new professor has no
   projects. Empty states explain the next action and why, in the product's
   own words.
3. **Error** — one sentence of what happened and what to do, with a retry.
4. **Full / overloaded** — twenty groups, sixty tasks, a hundred messages.
   This is where layouts actually fail.

---

## 9. Voice

Copy is part of the design, and this product has a voice already. Match it:

- Sentence case. Never Title Case On Buttons.
- No exclamation marks. No "please". No "successfully".
- Active voice, second person: "You have not joined a class yet."
- Errors say what happened **and what to do next**.
- Numbers are stated, not dramatised: "3 deadlines have already passed."
- Never invent a term the product does not use. The vocabulary is fixed:
  *class, group, group set, project, board, task, work log, syllabus week,
  hand in, return, accept, claim, release*.

---

## 10. Accessibility floor

- Every interactive element reaches by keyboard, in a sensible order, with a
  visible focus ring that is not the browser default.
- Dialogs trap focus, close on Escape, and return focus to their trigger.
- Contrast: 4.5:1 for body text, 3:1 for control boundaries and large text.
  This is checked — the existing project has a script that enforces it.
- Colour is never the only carrier of meaning. Late, overdue and done need a
  word or a shape as well as a hue.
- Respect `prefers-reduced-motion`: no transforms, no parallax, opacity only.

---

## 11. Order of work

Build in this order. Each step depends on the one before it.

1. `01-FOUNDATIONS.md` — invent the design system. **Do not skip this.** Every
   later screen is assembled from what you define here.
2. `02-app-shell.md` — navigation, page frame, the responsive skeleton.
3. The two dashboards — they exercise the most components at once.
4. The directories (classes, groups, projects) — they share a shape; design it
   once, in the system, and reuse it.
5. The detail screens, then the workspace, then the rest.

After each screen, open it at all four widths in both themes before moving on.
