// Applied before paint so the first frame is never the wrong theme.
//
// A file rather than an inline script, so the Content-Security-Policy can say
// `script-src 'self'` without `'unsafe-inline'`. The alternative was a
// SHA-256 hash in the header, which has to be recomputed whenever this text
// changes — and its failure mode is a flash of the wrong theme, quiet enough
// to survive a release unnoticed.
//
// Still render-blocking in `<head>`, which is the point: this must run before
// the first paint, and one small same-origin request is the cost of that.
try {
  var saved = localStorage.getItem('collabify.theme') || 'system'
  var dark =
    saved === 'dark' ||
    (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)

  // The person's own colours from Settings → Appearance, cached by
  // src/lib/palette.ts as ready-made variables for each mode. Only names that
  // look like a custom property are set.
  var palette = JSON.parse(localStorage.getItem('collabify.palette') || 'null')
  var vars = palette && palette[dark ? 'dark' : 'light']
  if (vars) {
    for (var name in vars) {
      if (/^--[a-z0-9-]+$/.test(name) && typeof vars[name] === 'string') {
        document.documentElement.style.setProperty(name, vars[name])
      }
    }
  }
} catch {}
