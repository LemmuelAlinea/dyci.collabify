import { useEffect, useRef } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

type Command = {
  label: string
  icon?: IconName
  text?: string
  command: string
  arg?: string
}

const COMMANDS: Command[] = [
  { label: 'Heading', text: 'H1', command: 'formatBlock', arg: '<h1>' },
  { label: 'Subheading', text: 'H2', command: 'formatBlock', arg: '<h2>' },
  { label: 'Body text', text: '¶', command: 'formatBlock', arg: '<p>' },
  { label: 'Bold', text: 'B', command: 'bold' },
  { label: 'Italic', text: 'I', command: 'italic' },
  { label: 'Underline', text: 'U', command: 'underline' },
  { label: 'Bulleted list', icon: 'dots', command: 'insertUnorderedList' },
  { label: 'Numbered list', text: '1.', command: 'insertOrderedList' },
]

/**
 * A plain editor for a Word document.
 *
 * `contenteditable` rather than an editor library, because what a school paper
 * needs is headings, emphasis, lists and tables — and every library that does
 * that well is larger than this entire application. The formatting it produces
 * is the formatting `htmlToDocx` knows how to carry back out, so what somebody
 * sees is what their .docx will hold.
 */
export function RichEditor({
  value,
  onChange,
  readOnly = false,
  id,
}: {
  value: string
  onChange: (html: string) => void
  readOnly?: boolean
  id?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Written in only when it differs, so typing is never interrupted by a
  // re-render putting the caret back at the start.
  useEffect(() => {
    const el = ref.current
    if (el && el.innerHTML !== value) el.innerHTML = value || '<p><br></p>'
  }, [value])

  function exec(command: string, arg?: string) {
    ref.current?.focus()
    document.execCommand(command, false, arg)
    if (ref.current) onChange(ref.current.innerHTML)
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line surface-sunken px-1.5 py-1">
          {COMMANDS.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-label={c.label}
              title={c.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(c.command, c.arg)}
              className="grid h-7 min-w-7 place-items-center rounded-md px-1.5 text-[12px] font-semibold text-muted hover:bg-[var(--surface)] hover:text-ink"
            >
              {c.icon ? <Icon name={c.icon} size={14} /> : c.text}
            </button>
          ))}
        </div>
      )}
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="The document"
        aria-readonly={readOnly || undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="rich-body min-h-[22rem] max-h-[60vh] overflow-y-auto bg-[var(--surface)] px-4 py-3 text-[14px] leading-relaxed text-ink focus:outline-none"
      />
    </div>
  )
}
