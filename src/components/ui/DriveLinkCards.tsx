import { driveLinksIn } from '../../lib/driveLinks'
import { Icon } from './Icon'

const TONES = {
  /** On a page or card. */
  default: 'border-line surface-sunken hover:border-line-strong',
  /** In a chat bubble, whose colour changes with who sent it. */
  inherit: 'border-current/20 hover:bg-current/8',
}

/**
 * A card under some written text for each Google Drive or Docs link in it,
 * saying what kind of thing it opens. Nothing when there are none.
 */
export function DriveLinkCards({
  text,
  tone = 'default',
  className = '',
}: {
  text: string
  tone?: keyof typeof TONES
  className?: string
}) {
  const links = driveLinksIn(text)
  if (links.length === 0) return null

  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {links.map((d) => (
        <li key={d.href}>
          <a
            href={d.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex w-full max-w-[420px] items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${TONES[tone]}`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                tone === 'default' ? 'bg-icon-tile text-icon-glyph' : 'bg-current/12'
              }`}
            >
              <Icon name={d.icon} size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-medium ${tone === 'default' ? 'text-ink' : ''}`}>
                {d.label}
              </span>
              <span className={`block truncate text-[12px] ${tone === 'default' ? 'text-faint' : 'opacity-70'}`}>
                {new URL(d.href).hostname.replace(/^www\./, '')}
              </span>
            </span>
            <span
              className={`flex shrink-0 items-center gap-1 text-[12px] font-medium ${
                tone === 'default' ? 'text-navy-600 dark:text-navy-200' : ''
              }`}
            >
              Open
              <Icon name="arrowRight" size={13} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
