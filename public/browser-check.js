// A browser too old for the stylesheet gets told so, rather than a page with
// no colours in it.
//
// Tailwind v4 compiles to `@property`, `color-mix()` and `oklch()`, which is a
// hard floor at Chrome/Edge 111, Safari 16.4 and Firefox 128. Note this is
// lower than `browserslist` in package.json, which was raised to 117/17.5/129
// for `@starting-style`: a browser between the two floors loses the entrance
// animations and nothing else, so it must not be sent here. This check tests
// the colour functions themselves, which is the line where the page stops
// being readable at all. Below it those functions do not degrade,
// they fail to parse, so every colour resolves to nothing and the page renders
// as unreadable black-on-black. A computer lab on a pinned browser would have
// had no way of knowing why.
//
// `CSS.supports` rather than a user-agent string: it asks the question that
// actually matters, and it keeps working for browsers that do not exist yet.
// The markup is written inline and unstyled by the stylesheet on purpose — the
// stylesheet is the thing that cannot be relied on here.
//
// Loaded from a file rather than inline so the CSP needs no `'unsafe-inline'`.
// It stays in `<body>` after `#root` and before the module script, because it
// writes into `#root` and must win that race against React.
;(function () {
  var ok =
    window.CSS &&
    CSS.supports &&
    CSS.supports('color', 'oklch(0.5 0.1 200)') &&
    CSS.supports('color', 'color-mix(in oklab, red, blue)')
  if (ok) return
  document.documentElement.classList.remove('dark')
  document.getElementById('root').innerHTML =
    '<div style="max-width:34rem;margin:14vh auto;padding:0 1.5rem;' +
    'font:16px/1.6 system-ui,sans-serif;color:#0d1330">' +
    '<h1 style="font-size:22px;margin:0 0 .75rem">This browser is too old for Collabify</h1>' +
    '<p style="margin:0 0 1rem">Collabify needs Chrome or Edge 111, Safari 16.4, or ' +
    'Firefox 128 — or anything newer. On an older browser the page loads but the ' +
    'colours do not, so nothing on it can be read.</p>' +
    '<p style="margin:0">Update this browser, or open Collabify on another one. If ' +
    'this is a college computer, the lab staff will need to do it.</p></div>'
})()
