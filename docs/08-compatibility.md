# Compatibility

What Collabify runs on, what it exchanges with other software, and what has
actually been tested rather than assumed. Measured on 23 August 2026.

ISO/IEC 25010:2023 splits this across two characteristics, and they are kept
apart here because they answer different questions:

- **Compatibility** — co-existence and interoperability. Does it get along with
  other software, and can other software read what it produces?
- **Flexibility → adaptability** — does it work on the browsers and screens the
  people using it actually have?

## The browser floor

Tailwind v4 compiles the whole stylesheet down to modern colour functions.
Counted in the built CSS:

| feature | uses in `dist` | first supported in |
|---|---|---|
| `@property` | 63 | Chrome 85, Safari 16.4, **Firefox 128** |
| `color-mix()` | 162 | **Chrome 111**, Safari 16.2, Firefox 113 |
| `oklch()` | 22 | Chrome 111, Safari 15.4, Firefox 113 |

So the floor is **Chrome/Edge 111, Safari 16.4, Firefox 128**, now recorded in
`browserslist` in `package.json`.

**Below the floor the page does not degrade — it breaks.** `oklch()` and
`color-mix()` do not fall back to an older colour; they fail to parse, and
every colour in the design resolves to nothing. The page loads and cannot be
read.

A college lab on a pinned browser would have had no way of knowing why, so
`index.html` now asks `CSS.supports` before the app boots and replaces the page
with a plain sentence saying the browser is too old and what to do. It is
inline and unstyled deliberately: the stylesheet is the thing that cannot be
relied on at that point.

## What was tested, and on what

Everything below ran in a Chromium browser at the listed viewport.

| viewport | page | sideways scroll | content past the edge |
|---|---|---|---|
| 360 x 740 | landing | no | none |
| 360 x 740 | register (light) | no | none |
| 768 x 1024 | landing | no | none |
| 1024 x 800 | landing | no | none |
| 1440 x 900 | landing | no | none |

One real fault was found at 360 px and fixed: the landing navbar's "Get
started" button ran to x=424 in a 360 px viewport, pushing the menu icon off
screen where it could not be tapped. The cause is worth knowing, because it
will happen again — `Button` sets `inline-flex` in its base class, and adding
`hidden` alongside it does nothing, because two display utilities are resolved
by their order in Tailwind's output, not by the order they are written in the
`className`. The fix is to hide a wrapper, never the button.

### Not tested here, and why

**Safari, Firefox and a real Android device cannot be run from this machine.**
One Chromium engine proves nothing about the other two, and anybody presenting
a cross-browser matrix from a single engine is guessing. These are yours to
run:

1. Open the deployed site in Safari (iOS 16.4+ or macOS), Firefox 128+, and
   Chrome on an Android phone.
2. On each: the landing page, sign in, a class page, a project board, and one
   report.
3. Look for three things specifically — the sidebar drawer opening and closing,
   `100dvh` behaviour when the mobile browser's address bar hides, and whether
   `backdrop-filter` blurs behind dialogs (Safari needs the `-webkit-` prefix,
   which Tailwind emits, but it is worth confirming).
4. Write what you find in the table above.

## Interoperability

### CSV export

Reports export to CSV for Excel and Google Sheets. Verified in the browser
against the real function:

| property | result |
|---|---|
| UTF-8 BOM | present — Excel shows `Peña`, not `PeÃ±a` |
| Line endings | CRLF, per RFC 4180 |
| Quotes inside a field | doubled (`"Group ""A"""`) |
| Commas and newlines in a field | field quoted |
| Empty value | empty cell, not the text `null` |
| Timestamps | `2026-08-23 12:12`, local time |

The timestamp format was a defect. `submitted_at` went into the file as the raw
Postgres value, `2026-08-23T04:12:33.123456+00:00`, which Excel and Sheets both
store as text — so the column could not be sorted or filtered as a date, and
the time shown was UTC rather than the Manila time the work was handed in.
`csvMoment` in `src/lib/report.ts` now writes `YYYY-MM-DD HH:mm` local, which
both parse without asking and which no regional setting can read backwards.

### Print

Reports are meant to be handed to the program office on paper. `@media print`
in `src/styles/index.css` sets an A4 page, forces the light palette, drops the
rail, the header and every control, flattens the scroll containers that
otherwise fight pagination, repeats table headers across pages, and keeps rows
from breaking mid-way.

Checked: no report sheet uses a coloured fill, so nothing depends on Chrome's
"background graphics" print option being on — a common way for a status pill to
print as white text on white paper.

**Not measured here:** an actual print preview, which needs a signed-in
professor. Print one report to PDF and confirm the header repeats on page two.

### Other systems

Supabase (PostgREST, Storage, Auth), Google OAuth for sign-in, and the
Anthropic API for task drafting. Email through Brevo is configured but off —
see the residual risks in the final report.

## Co-existence

Nothing is written to `window`. Every stored key is namespaced, so Collabify
cannot collide with another app on the same origin:

- `collabify.theme`
- `collabify.nav.shut`
- `collabify.sidebar.collapsed`
- `collabify.notices.about`
