import { GENERAL_FILE_LIMIT, extensionOf, fileName, sameExtension } from './files'

/** Why a picked file cannot replace the open one; null when it can. */
export function newVersionProblem(currentPath: string, picked: File): string | null {
  if (!sameExtension(currentPath, picked.name)) {
    const ext = extensionOf(currentPath)
    return `${ext ? `Pick a .${ext} file.` : 'Pick a file with no extension.'} This one replaces ${fileName(currentPath)}, so it has to be the same type.`
  }
  if (picked.size > GENERAL_FILE_LIMIT) return 'Files can be up to 50 MB. Make this one smaller, then pick it again.'
  return null
}

/** "2 hours ago": how long ago somebody pulled a file. */
export function pulledAgo(iso: string, now = Date.now()) {
  const secs = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (secs < 60) return 'just now'
  if (secs < 3600) return unit(Math.floor(secs / 60), 'minute')
  if (secs < 86400) return unit(Math.floor(secs / 3600), 'hour')
  return unit(Math.floor(secs / 86400), 'day')
}

/** The chip on a file row for the people who pulled it; null for nobody. */
export function editingLabel(names: string[]) {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} is editing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are editing`
  return `${names[0]} and ${names.length - 1} others are editing`
}

const STALE = /^Main has a newer version of (.+) than the copy this was made from\./

/**
 * The database's refusal of a push from an old copy, said to whoever sees it:
 * `who` is the person whose copy it was (a change's author, for a reviewer),
 * null for the viewer. Null for every other error.
 */
export function stalePushMessage(err: unknown, who: string | null): string | null {
  const message = (err as { message?: unknown } | null)?.message
  const hit = typeof message === 'string' ? STALE.exec(message) : null
  if (!hit) return null
  const subject = who ? `${who.charAt(0).toUpperCase()}${who.slice(1)} has` : 'You have'
  return `Main has a newer version of ${hit[1]} than the copy ${who ?? 'you'} started from. ${subject} to get the newer version, combine the two in Word and upload again.`
}
