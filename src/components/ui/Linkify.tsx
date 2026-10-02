import { linkify } from '../../lib/linkify'

const TONES = {
  /** On a page or card: the app's link colour. */
  default:
    'text-navy-600 underline decoration-navy-600/35 underline-offset-2 hover:decoration-current dark:text-navy-200 dark:decoration-navy-200/35',
  /** In a chat bubble, whose colour changes with who sent it. */
  inherit: 'underline underline-offset-2 hover:opacity-80',
}

/** Text someone wrote, with its web links clickable. Opens them in a new tab. */
export function Linkify({ text, tone = 'default' }: { text: string; tone?: keyof typeof TONES }) {
  return (
    <>
      {linkify(text).map((part, i) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`break-all ${TONES[tone]}`}
          >
            {part.text}
          </a>
        ),
      )}
    </>
  )
}
