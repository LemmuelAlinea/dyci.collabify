import { PRIVACY } from './privacy'
import { TERMS } from './terms'

/**
 * What a person is asked to agree to, and in what words.
 *
 * **Two boxes, not one.** Accepting the terms is agreeing to a contract;
 * consenting to the privacy policy is authorising the processing of sensitive
 * personal information, which RA 10173 §3(b) requires to be "freely given,
 * specific, informed". A single tick covering both is not specific — the
 * person cannot accept one and refuse the other, and afterwards nobody can say
 * which they meant. Two rows land in `consent_records` for exactly this
 * reason.
 *
 * The versions are read from the documents rather than written here, so a
 * document cannot be edited without the recorded version moving with it.
 */

export type ConsentItem = {
  /** Matches `consent_records.document` and `legal_versions.document`. */
  document: 'terms' | 'privacy'
  /** The version being agreed to, taken from the document itself. */
  version: string
  /** The checkbox label. `[label](/route)` links are parsed by `parseLinks`. */
  label: string
  /** Shown under the label when the box is empty and the form was submitted. */
  requiredMessage: string
}

/**
 * Terms first, then privacy. The order is the order a person reasonably reads
 * them in: what the account is, then what happens to their information.
 */
export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    document: 'terms',
    version: TERMS.version,
    label: `I accept the [terms of use](/terms).`,
    requiredMessage: `You have to accept the terms of use to register.`,
  },
  {
    document: 'privacy',
    version: PRIVACY.version,
    label: `I have read the [privacy policy](/privacy) and consent to Collabify holding my coursework information, which the Data Privacy Act treats as sensitive.`,
    requiredMessage: `You have to consent to the privacy policy to register. Education information is sensitive, so the law needs this specifically.`,
  },
] as const

/**
 * The versions, shaped for `options.data` on signup and for the onboarding
 * write.
 *
 * Sent as one object because both paths hand it to the database whole:
 * `handle_new_user()` reads it out of the new user's metadata on the email
 * path, and `record_consent()` takes it directly on the Google path. Keeping
 * the shape identical means the two paths cannot drift into recording
 * different things.
 */
export function consentVersions(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of CONSENT_ITEMS) out[`consent_${item.document}`] = item.version
  return out
}

/**
 * Which boxes are ticked, keyed by document.
 *
 * Here rather than beside the checkbox component for two reasons: neither
 * function renders anything, and `src/lib/**` is what vitest runs over — so
 * "every box starts unticked" is a claim a test can hold rather than a habit
 * a future edit can quietly break.
 */
export type ConsentState = Record<string, boolean>

/** Every box unticked. Never default to true — that is not consent. */
export function emptyConsent(): ConsentState {
  return Object.fromEntries(CONSENT_ITEMS.map((item) => [item.document, false]))
}

export function allConsented(state: ConsentState): boolean {
  return CONSENT_ITEMS.every((item) => state[item.document])
}
