/**
 * Who a privacy request reaches.
 *
 * Under the Data Privacy Act the controller here is Dr. Yanga's Colleges, not
 * the person named below and not whoever built this. The supervising professor
 * receives requests **on the school's behalf**; the school's Data Protection
 * Officer is the escalation, and the National Privacy Commission is the
 * complaint route beyond that. Getting that order wrong in the documents would
 * imply a professor has the final say on a statutory right, which they do not.
 *
 * ─── FILL BOTH BEFORE PUBLISHING ────────────────────────────────────────────
 *
 * Two guards exist because quietly shipping with the placeholder still in it is
 * the obvious failure: a banner on every legal page while it stands, and
 * `npm run check` failing when `LEGAL_READY=1` is set. Neither blocks ordinary
 * development, and together they make publishing a decision rather than an
 * oversight.
 *
 * `privacy_handler` in the database has to name the same professor — the
 * document says who receives requests, and that table decides who actually
 * sees them.
 */

/**
 * Exported so a page can ask whether a given document still carries one,
 * rather than assuming all three do. Only two of them name a person, and
 * warning on the cookies notice that "the person who receives privacy requests
 * has not been named" describes nothing on that page.
 */
export const UNSET = 'TO BE FILLED IN'

export const PRIVACY_CONTACT = {
  role: `Supervising professor`,
  name: `${UNSET} — supervising professor`,
  email: `${UNSET} — supervising professor's college address`,
} as const

/**
 * The school's Data Protection Officer.
 *
 * NPC Circular 16-01 requires a Personal Information Controller to designate
 * one, so the college should already have this. If nobody can name them, that
 * gap matters more than any wording in these documents — it means the system
 * holding students' education records is not known to the office accountable
 * for it.
 */
export const SCHOOL_DPO = {
  role: `Data Protection Officer, Dr. Yanga's Colleges`,
  name: `${UNSET} — the college's Data Protection Officer`,
  email: `${UNSET} — the college's Data Protection Officer`,
} as const

/** The regulator. Fixed, and the same for everyone. */
export const REGULATOR = {
  name: `National Privacy Commission`,
  site: `privacy.gov.ph`,
  email: `info@privacy.gov.ph`,
  address: `5th Floor, Delegation Building, PICC Complex, Pasay City 1307`,
} as const

/** True while either contact is still a placeholder. Drives both guards. */
export const CONTACT_IS_PLACEHOLDER =
  PRIVACY_CONTACT.email.startsWith(UNSET) || SCHOOL_DPO.email.startsWith(UNSET)
