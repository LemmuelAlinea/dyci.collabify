import { Link } from 'react-router-dom'
import { CONSENT_ITEMS, parseLinks } from '../../lib/legal'
import type { ConsentState } from '../../lib/legal'
import { Icon } from '../ui/Icon'

/**
 * The two boxes somebody ticks before an account exists.
 *
 * **Two, not one.** Accepting the terms is agreeing to a contract; consenting
 * to the privacy policy authorises the processing of sensitive personal
 * information, which RA 10173 §3(b) requires to be "freely given, specific,
 * informed". One box covering both is not specific — a person cannot accept
 * one and refuse the other, and afterwards nobody can say which they meant.
 *
 * Used by two screens with different surroundings: `Register`, where the boxes
 * sit in the signup form, and `Onboarding`, which is the only screen a Google
 * account passes through and therefore the only place its consent can be
 * collected at all.
 *
 * A real `<input type="checkbox">`, not a toggle button with `aria-pressed`.
 * The rest of this product uses the button pattern for its multi-select rows
 * and that is fine there; here, what a screen reader announces is the record
 * of what somebody was asked, so it should say "checkbox, not checked".
 */

/**
 * The label, with its document link.
 *
 * Opens in a new tab on purpose: these are long documents, and sending
 * somebody away from a half-filled registration form to read one is how a form
 * gets abandoned. `rel="noreferrer"` alongside `noopener` because the target is
 * ours and the referrer tells it nothing it needs.
 */
function Label({ text }: { text: string }) {
  return (
    <>
      {parseLinks(text).map((part, i) =>
        part.to ? (
          <Link
            key={i}
            to={part.to}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-ink underline decoration-amber-400/70 underline-offset-[3px] transition-colors duration-200 hover:decoration-amber-400"
            onClick={(e) => e.stopPropagation()}
          >
            {part.text}
          </Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

export function ConsentChecks({
  value,
  onChange,
  /** Set once the form has been submitted, so nothing is red before it is due. */
  showErrors = false,
  disabled = false,
}: {
  value: ConsentState
  onChange: (next: ConsentState) => void
  showErrors?: boolean
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      {CONSENT_ITEMS.map((item) => {
        const checked = !!value[item.document]
        const missing = showErrors && !checked
        return (
          <div key={item.document}>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                missing
                  ? 'border-amber-400 bg-amber-400/8'
                  : checked
                    ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12'
                    : 'border-line'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange({ ...value, [item.document]: e.target.checked })}
              />
              <span
                aria-hidden
                className={`mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] peer-focus-visible:ring-offset-1 ${
                  checked
                    ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-500'
                    : 'border-[var(--control-line)]'
                }`}
              >
                {checked && <Icon name="check" size={12} />}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-[1.55] text-muted">
                <Label text={item.label} />
              </span>
            </label>
            {missing && (
              <p className="mt-1.5 pl-3.5 text-[12px] leading-relaxed text-ink">
                {item.requiredMessage}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
