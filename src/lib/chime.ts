/**
 * A short chime when a notification arrives while Collabify is open.
 *
 * Device push (lib/push.ts) already sounds when Collabify is closed or in the
 * background, with the phone's own notification sound; a web app cannot choose
 * that sound. This covers the open app, where the bell only lit up silently.
 *
 * The note is drawn with Web Audio rather than a file, so there is nothing to
 * download. Browsers start audio only after the person has touched the page, so
 * the first tap or key press unlocks it; before that the chime is skipped, and
 * lib/push.ts lets the phone's own notification through instead. The switch is
 * per device (`collabify.chime`, on unless turned off), like the page size.
 */

export const CHIME_KEY = 'collabify.chime'
/** Several arrivals at once, or two bells counting the same one, make one chime. */
export const CHIME_GAP_MS = 1500

/**
 * Whether a change in the unread count should chime. Only a rise while the page
 * is in view, and never on the first count: that is the backlog, not an arrival.
 */
export function shouldChime(previous: number | null, next: number, visible: boolean): boolean {
  return previous !== null && visible && next > previous
}

/* ---------- the device's switch ---------- */

export function chimeEnabled(): boolean {
  try {
    return window.localStorage.getItem(CHIME_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setChimeEnabled(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(CHIME_KEY)
    else window.localStorage.setItem(CHIME_KEY, 'off')
  } catch {
    // Private windows can refuse storage; the switch then lasts for this visit only.
  }
}

/* ---------- the sound ---------- */

let audio: AudioContext | null = null
let lastAt = 0

function context(): AudioContext | null {
  if (audio) return audio
  const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  audio = new Ctx()
  return audio
}

/** Unlocks audio on the person's first tap or key press. Called once at start-up. */
export function prepareChime() {
  if (typeof window === 'undefined') return
  const unlock = () => {
    const ctx = context()
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined)
    if (ctx?.state === 'running') {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** True when a chime would actually be heard: switched on and audio unlocked. */
export function chimeReady(): boolean {
  return chimeEnabled() && audio?.state === 'running'
}

/**
 * Plays the chime: two soft bell notes, a fourth apart, about half a second in
 * all. `force` plays it with the switch off, for the preview in Settings.
 */
export function playChime({ force = false }: { force?: boolean } = {}) {
  if (!force && !chimeEnabled()) return
  const ctx = context()
  if (!ctx) return
  if (ctx.state !== 'running') {
    if (!force) return
    void ctx.resume().catch(() => undefined)
  }
  const now = performance.now()
  if (!force && now - lastAt < CHIME_GAP_MS) return
  lastAt = now

  const start = ctx.currentTime + 0.01
  for (const [frequency, offset] of [
    [659.25, 0], // E5
    [880, 0.12], // A5
  ] as const) {
    const tone = ctx.createOscillator()
    const level = ctx.createGain()
    tone.type = 'sine'
    tone.frequency.value = frequency
    const at = start + offset
    level.gain.setValueAtTime(0.0001, at)
    level.gain.exponentialRampToValueAtTime(0.14, at + 0.012)
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)
    tone.connect(level).connect(ctx.destination)
    tone.start(at)
    tone.stop(at + 0.45)
  }
}
