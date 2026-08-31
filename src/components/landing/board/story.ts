/**
 * The board's timeline, as data.
 *
 * This used to be scrubbed by scroll. It now runs on its own clock and repeats,
 * but the poses are still expressed as fractions of the story rather than as
 * seconds, and that is what makes looping safe: the scene derives every
 * transform from the fraction alone and accumulates nothing, so restarting is
 * just setting the number back to where it started.
 */

/**
 * Where the story begins in fraction space.
 *
 * The name is a holdover worth keeping: below this the board is built and
 * still. The clock never actually dwells here any more — see `storyProgress`,
 * which starts the fraction at this value so the lead-in is the build phase
 * rather than a stretch of timeline where nothing happens.
 */
export const HERO_UNTIL = 0.18

/**
 * One turn of the loop, in seconds.
 *
 * `build` is the entrance: the plate, then the columns, then the cards, then
 * the bars, then the flying card — about 1.65s of staggered reveal, plus a beat
 * to let it settle before anything moves. `story` is the fraction running 0→1.
 * `hold` lets the finished board be looked at. `outro` dissolves it so the next
 * `build` has something to build from.
 */
export const LOOP = {
  build: 1.8,
  story: 6.4,
  hold: 1.7,
  outro: 1,
}

export const LOOP_SECONDS = LOOP.build + LOOP.story + LOOP.hold + LOOP.outro

/**
 * Seconds into a turn → the story fraction.
 *
 * Deliberately LINEAR. Every stage in the scene already eases itself with its
 * own `ramp`, and easing the fraction as well would ease twice — the card would
 * leave and arrive at a speed nothing in the scene asked for.
 */
export function storyProgress(cycleSeconds: number) {
  const u = Math.min(1, Math.max(0, (cycleSeconds - LOOP.build) / LOOP.story))
  return HERO_UNTIL + (1 - HERO_UNTIL) * u
}

/** 0 before `a`, 1 after `b`, smoothly eased between. */
export function ramp(p: number, a: number, b: number) {
  if (b <= a) return p >= b ? 1 : 0
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
