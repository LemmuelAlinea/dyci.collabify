# 01 — Foundations: the design system to invent

Read `00-BRIEF.md` first.

This is the only file where you get to decide things freely. Everything after
it is assembly. Spend real effort here: a weak system produces twenty-three
inconsistent screens, and no amount of care later fixes that.

Deliverable: `src/redesign/redesign.css` (tokens, scoped under `.rd`) and
`src/redesign/ui/` (the primitives), plus a page at `/redesign/foundations`
that displays every token and every component state on one screen. Build that
page **first** and keep it current — it is how consistency is checked.

---

## What you inherit, and what you must not

The signed-in product has to feel like it belongs to the same company as the
landing page. That means inheriting the **brand**, not the **layout**.

### Inherit these exactly

**The palette.** Two ramps and nothing else. Do not introduce a third brand
hue; you may add semantic colours for success, warning and danger, but keep
them quiet next to the amber.

```
navy   50 #eef0f9   100 #d6dbf0   200 #aeb8e1   300 #8493cf   400 #5a6bbd
      500 #3d4da3   600 #26327a   700 #1e2864   800 #161d4a   900 #101637
      950 #080b21
amber  50 #fef7e6   100 #fdebbf   200 #fbd982   300 #f7c74a   400 #f0b429
      500 #d9990f   600 #ad770a   700 #7d5507   800 #513604
```

`navy-600` is the brand. `amber-400` is the accent and is **rare** — it marks
the one thing on a screen that matters most, and a screen with six amber
elements has none.

**The three faces.**

| Role | Family | Used for |
|---|---|---|
| Display | **Outfit** | headings only, bold, tight negative tracking |
| Body | **Instrument Sans** | everything a person reads as prose |
| Mono | **JetBrains Mono** | numbers, dates, codes, counts, micro-labels |

Numerals live in mono throughout. A count, a percentage, a due date and a class
code are all data, and data reads as data. This is load-bearing: it is how a
dense screen stays scannable without more colour.

**The micro-label.** The landing page marks a section with a short amber rule
followed by uppercase mono at roughly 10.5px with wide letterspacing. Keep that
device — it is the strongest single piece of brand identity the product has,
and it works just as well over a data panel as over a hero.

**Dark mode is first-class.** Both themes ship together, both are checked for
contrast. Define a light palette on `.rd` and override only what changes.

### Do not carry over

- The landing page's **scale**. Headlines clamping to 88px belong on a page
  somebody reads once. A professor opens the dashboard forty times a term.
- Alternating full-bleed dark and light **bands**. That is a narrative device
  for a scrolling pitch. An application needs one stable ground.
- The blueprint grid, the orbit, the marquee, the scroll rail, the glow. They
  are for the front door.
- The current app's **navy hero block** at the top of every page, its
  four-stat tile row, and its "title + accent phrase" headline pattern. These
  are the most recognisable things about the current design and they must not
  survive.

---

## The system to define

### Type scale

Define one scale and use only it. Suggested shape, but the numbers are yours:

- Display / page title
- Section heading
- Subsection heading
- Body
- Body small
- Annotation
- Micro-label (mono, uppercase)

For each, specify size, line-height, weight, tracking, face, and the **mobile
value** where it differs. Rule: a page title on a phone is not a page title on
a monitor — but the *ratio* between levels stays fixed, so hierarchy survives
the resize.

State the rule for **maximum measure**: prose caps at roughly 62–68 characters
wherever it appears, however wide the screen.

### Spacing and rhythm

One base unit, a scale derived from it, and a stated rule for which step means
what — space *within* a component, *between* components, *between* sections.
Most inconsistency in an interface is spacing chosen ad hoc.

Define page gutters at each of the four widths.

### Surfaces and depth

Decide and write down how separation is achieved. Pick one primary mechanism —
hairline borders, or a tinted ground, or elevation — and use the others
sparingly. The current app uses all three at once and that is one of the
reasons it reads as busy.

Define: page ground, raised surface, sunken surface, hairline, strong hairline,
focus ring. In both themes.

### Radii, borders, shadows

A small set. Say which radius belongs to which kind of object (control, card,
panel, dialog) and never mix.

### The accent rule

Write the rule down, then enforce it: **where may amber appear?** Suggested:
the primary action, the single most urgent status, and the micro-label rule.
Nowhere else.

### Status colour

Define the vocabulary once, for both themes, with a non-colour carrier for
each:

| Meaning | Where it appears |
|---|---|
| Neutral / to do | task status, project status |
| In progress | task status, board progress |
| Done / accepted | task status, verdict, handed in |
| Overdue / late | deadlines, late tasks, overdue requests |
| Needs attention | unclaimed work, stalled group, unset class |
| Archived / closed | archived class, closed project, archived group |

### Motion

The existing product uses a token scale worth keeping the *shape* of: press
~140ms, popovers ~180ms, dropdowns ~220ms, dialogs ~260ms, and one soft
ease-out curve. Anything a person triggers stays under 300ms. Everything
honours `prefers-reduced-motion`.

---

## Primitives to build

Build each with **every state**: default, hover, active, focus-visible,
disabled, loading, and where relevant error and read-only. Show them all on the
foundations page.

**Controls** — Button (primary, secondary, quiet, destructive; three sizes;
icon-only), Link, Icon button, Toggle, Checkbox, Radio, Select, Segmented
control.

**Inputs** — Text field, Textarea, Date field, Search, File drop. Each with
label, hint, error, and character counter where a limit exists.

**Containers** — Card, Panel, Section header, Toolbar, Divider, Empty state,
Skeleton.

**Data display** — Table (must scroll horizontally inside itself), Definition
list, Stat, Progress bar, Avatar, Avatar stack, Badge, Status pill, Tag.

**Overlays** — Dialog, Drawer/sheet, Popover, Dropdown menu, Tooltip, Toast,
Confirm dialog.

**Navigation** — Tabs, Breadcrumb, Pagination or "show more".

**Feedback** — Alert (info, warning, error, success), Inline error.

Two overlay rules learned the hard way in the live product, worth keeping:

1. A dialog must not cover the app's top bar. Leave the bar visible so a person
   can see where they are; the scrim may still cover it so the dialog stays
   modal.
2. A popover anchored to a control near a screen edge must stay on screen.
   Anchor it so it opens *into* the available space, and cap its width against
   the viewport.

---

## Density

Pick a stance and hold it. This product shows a professor twenty groups, an
eighteen-week term, and sixty tasks at once. A spacious consumer-app density
will make those screens unusable, and a cramped one will make the dashboards
unreadable.

The recommended answer: **one comfortable density, with a denser variant for
tabular and list-heavy regions** — defined in the system, not improvised per
screen.

---

## Deliverable checklist

- [ ] `redesign.css` — every token, scoped under `.rd`, both themes
- [ ] `src/redesign/ui/` — every primitive above, every state
- [ ] `/redesign/foundations` — the living specimen page
- [ ] A short `src/redesign/README.md` stating the accent rule, the spacing
      rule, the density rule and the measure rule, so later screens can be
      checked against something written down
