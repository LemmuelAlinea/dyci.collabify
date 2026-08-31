/**
 * The scroll story, as data.
 *
 * Kept out of the components because two of them need it and they need it for
 * different reasons: the DOM side renders the chapter copy, the scene side maps
 * the same progress onto the board. One list means a stage cannot exist on the
 * page without a matching board pose, or the other way round.
 *
 * `from`/`to` are fractions of the pinned section's scroll, and they are the
 * ranges the brief specifies. Stage 1 is the hero as it already is — no chapter
 * copy, no board changes — so it has no entry here beyond its share of the
 * range, which is what `HERO_UNTIL` holds.
 */

/** Below this the hero copy is still the thing on screen. */
export const HERO_UNTIL = 0.18

export type Chapter = {
  id: string
  title: string
  body: string
  /** Fraction of the pinned scroll this chapter owns. */
  from: number
  to: number
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'create',
    title: 'Create the project',
    body: 'Professors turn class requirements into clear boards, tasks, and deadlines.',
    from: 0.18,
    to: 0.4,
  },
  {
    id: 'move',
    title: 'Move work forward',
    body: 'Students coordinate tasks, share progress, and keep every contribution visible.',
    from: 0.4,
    to: 0.68,
  },
  {
    id: 'finish',
    title: 'Finish with confidence',
    body: 'Collabify exposes delays early and keeps the whole group moving toward submission.',
    from: 0.68,
    // Runs to the very end of the pin, and does not fade out — see the `isLast`
    // branch in the story's paint. Ending at 0.9 left the last tenth of the
    // pinned scroll with the board beside an empty column.
    to: 1,
  },
]

/** 0 before `a`, 1 after `b`, smoothly eased between. */
export function ramp(p: number, a: number, b: number) {
  if (b <= a) return p >= b ? 1 : 0
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
