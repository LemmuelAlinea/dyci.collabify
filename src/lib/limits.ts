/**
 * How long a field may be, mirrored from the database.
 *
 * `supabase/hardening.sql` is the enforcement — a check constraint on every
 * user-writable text column, which holds however the row arrives: through the
 * app, through the REST interface, or through a script somebody wrote. These
 * numbers exist so the form can stop somebody *before* they lose work to a
 * database error at the end of a long paste.
 *
 * **Keep the two in step.** A cap here that is larger than the database's
 * turns a polite limit into a rejected submit; smaller, and it silently
 * shortens what the product would have accepted. `limits.test.ts` cannot reach
 * the database, so the pairing is a convention this comment carries — change
 * one, change the other, in the same commit.
 */
export const LIMIT = {
  /* names and short labels */
  firstName: 80,
  middleName: 80,
  lastName: 80,
  email: 254,
  className: 120,
  classInitial: 12,
  classCode: 40,
  classSection: 40,
  schoolYear: 20,
  groupName: 80,
  sectionName: 80,

  /* bodies */
  classDescription: 2000,
  announcementTitle: 200,
  announcementBody: 10000,
  messageBody: 5000,
  commentBody: 5000,
  resultFeedback: 10000,
  worklogNote: 2000,

  projectTitle: 200,
  projectGuidelines: 20000,
  projectTypeLabel: 60,
  criterionLabel: 200,
  criterionDescription: 2000,
  taskTitle: 200,
  taskDetails: 10000,

  reassignReason: 1000,
  decisionNote: 1000,
  shiftReason: 300,

  pollQuestion: 300,
  pollOption: 120,

  weekTitle: 200,
  weekText: 4000,
  resourceTitle: 200,

  privacyDetail: 5000,
  privacyAnswer: 5000,
} as const

/**
 * The image formats a profile photo may be.
 *
 * The same two the `avatars` bucket accepts. The bucket is the control — it is
 * checked server-side and cannot be talked out of it — and this is what the
 * file picker offers and what the form checks before a pointless upload.
 *
 * WebP was in the `accept` attribute before and is not here: the bucket is
 * public and served without `X-Content-Type-Options`, so the list of formats
 * that can be stored there is worth keeping as short as the product needs.
 */
export const AVATAR_TYPES = ['image/png', 'image/jpeg'] as const
export const AVATAR_ACCEPT = AVATAR_TYPES.join(',')
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/**
 * Whether this file may be a profile photo, and why not if it may not.
 *
 * Checks the browser's sniffed type rather than the file extension. Renaming
 * `payload.svg` to `photo.png` changes the extension and not the type, and the
 * extension was what the old code used to build the storage path.
 *
 * The bucket's allowlist is the enforcement and this is the courtesy — but the
 * two check different things, which is worth knowing. The bucket reads the
 * `Content-Type` the uploader declares; this reads what the browser worked out
 * from the bytes. Neither reads the bytes server-side, so a deliberate caller
 * can still store something mislabelled. It is served back under the label it
 * claimed, so it is inert; see the note in supabase/hardening.sql.
 */
export function avatarProblem(file: File): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) {
    return 'Profile photos have to be a PNG or a JPG.'
  }
  if (file.size > AVATAR_MAX_BYTES) return 'Pick an image under 2 MB.'
  return null
}

/** The extension to store it under, from the type rather than from the name. */
export function avatarExtension(file: File): string {
  return file.type === 'image/png' ? 'png' : 'jpg'
}
