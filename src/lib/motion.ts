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
