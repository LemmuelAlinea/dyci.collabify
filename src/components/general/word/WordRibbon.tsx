import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { ActionMenu } from '../../ui/ActionMenu'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'
import {
  DEFAULT_FONT,
  FONT_SIZES,
  HIGHLIGHTS,
  PAGE_SIZES,
  TEXT_COLORS,
  WORD_FONTS,
  fontName,
} from '../../../lib/general/wordPage'
import type { PageSizeId } from '../../../lib/general/wordPage'

const LINE_HEIGHTS = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
  { label: '2.5', value: '2.5' },
  { label: '3.0', value: '3' },
]

/**
 * Word's Home ribbon, for the Word editor: undo, paragraph style, font, size,
 * emphasis, colour and highlight; lists, indent, alignment and line spacing;
 * tables, pictures and page breaks; the page size. It wraps on a tablet and
 * scrolls sideways on a phone rather than hiding anything.
 */
export function WordRibbon({
  editor,
  page,
  onPage,
  onPicture,
}: {
  editor: Editor
  page: PageSizeId
  onPage: (page: PageSizeId) => void
  onPicture: () => void
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle')
      const block = e.isActive('heading') ? e.getAttributes('heading') : e.getAttributes('paragraph')
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        level: e.isActive('heading') ? (e.getAttributes('heading').level as number) : 0,
        font: fontName(style.fontFamily as string | undefined) || DEFAULT_FONT.name,
        size: typeof style.fontSize === 'string' ? parseFloat(style.fontSize) : null,
        color: (style.color as string | undefined) ?? null,
        highlight: (e.getAttributes('highlight').color as string | undefined) ?? null,
        align: (['center', 'right', 'justify'].find((a) => e.isActive({ textAlign: a })) ?? 'left') as string,
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        lineHeight: (block.lineHeight as string | null) ?? '',
        table: e.isActive('table'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      }
    },
  })

  const chain = () => editor.chain().focus()
  const size = s.size ?? (s.level ? null : 11)

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex items-stretch gap-1 overflow-x-auto border-b border-line surface px-2 py-1.5 [scrollbar-width:thin] lg:flex-wrap lg:overflow-visible"
    >
      <Group label="Undo">
        <Tool icon="undo" label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()} />
        <Tool icon="redo" label="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={() => chain().redo().run()} />
      </Group>

      <Group label="Font">
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <Picker
              label="Style"
              value={String(s.level)}
              className="w-[7.5rem]"
              onChange={(v) => {
                const level = Number(v)
                if (level) chain().setHeading({ level: level as 1 | 2 | 3 }).run()
                else chain().setParagraph().run()
              }}
            >
              <option value="0">Normal</option>
              <option value="1">Heading 1</option>
              <option value="2">Heading 2</option>
              <option value="3">Heading 3</option>
            </Picker>
            <Picker
              label="Font"
              value={s.font}
              className="w-[9.5rem]"
              onChange={(v) => {
                const font = WORD_FONTS.find((f) => f.name === v)
                if (font) chain().setFontFamily(font.stack).run()
              }}
            >
              {!WORD_FONTS.some((f) => f.name === s.font) && <option value={s.font}>{s.font}</option>}
              {WORD_FONTS.map((f) => (
                <option key={f.name} value={f.name} style={{ fontFamily: f.stack }}>
                  {f.name}
                </option>
              ))}
            </Picker>
            <Picker
              label="Font size"
              value={size === null ? '' : String(size)}
              className="w-[4.5rem]"
              onChange={(v) => chain().setFontSize(`${v}pt`).run()}
            >
              {size === null && <option value="">—</option>}
              {size !== null && !FONT_SIZES.includes(size) && <option value={String(size)}>{size}</option>}
              {FONT_SIZES.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </Picker>
          </div>
          <div className="flex gap-0.5">
            <Tool text="B" label="Bold (Ctrl+B)" active={s.bold} className="font-bold" onClick={() => chain().toggleBold().run()} />
            <Tool text="I" label="Italic (Ctrl+I)" active={s.italic} className="italic font-serif" onClick={() => chain().toggleItalic().run()} />
            <Tool text="U" label="Underline (Ctrl+U)" active={s.underline} className="underline" onClick={() => chain().toggleUnderline().run()} />
            <Tool text="S" label="Strikethrough" active={s.strike} className="line-through" onClick={() => chain().toggleStrike().run()} />
            <Swatches
              label="Text colour"
              colors={TEXT_COLORS}
              current={s.color}
              trigger={
                <span className="flex flex-col items-center leading-none">
                  <span className="font-serif text-[13px] font-bold">A</span>
                  <span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: s.color ?? 'var(--paper-ink)' }} />
                </span>
              }
              onPick={(c) => (c ? chain().setColor(c).run() : chain().unsetColor().run())}
              custom
              resetLabel="Automatic"
            />
            <Swatches
              label="Highlight"
              colors={HIGHLIGHTS.map((h) => h.hex)}
              current={s.highlight}
              trigger={
                <span className="flex flex-col items-center leading-none">
                  <Icon name="highlighter" size={13} />
                  <span className="mt-0.5 h-[3px] w-4 rounded-sm" style={{ background: s.highlight ?? 'transparent' }} />
                </span>
              }
              onPick={(c) => (c ? chain().setHighlight({ color: c }).run() : chain().unsetHighlight().run())}
              resetLabel="No highlight"
            />
            <Tool icon="clearFormat" label="Clear formatting" onClick={() => chain().unsetAllMarks().setParagraph().run()} />
          </div>
        </div>
      </Group>

      <Group label="Paragraph">
        <div className="flex flex-col gap-1">
          <div className="flex gap-0.5">
            <Tool icon="listBullet" label="Bullets" active={s.bullet} onClick={() => chain().toggleBulletList().run()} />
            <Tool icon="listNumber" label="Numbering" active={s.ordered} onClick={() => chain().toggleOrderedList().run()} />
            <Tool
              icon="outdent"
              label="Decrease indent"
              onClick={() => (editor.can().liftListItem('listItem') ? chain().liftListItem('listItem').run() : chain().outdent().run())}
            />
            <Tool
              icon="indent"
              label="Increase indent"
              onClick={() => (editor.can().sinkListItem('listItem') ? chain().sinkListItem('listItem').run() : chain().indent().run())}
            />
            <Picker
              label="Line spacing"
              value={s.lineHeight}
              className="w-[4.75rem]"
              icon="lineSpacing"
              onChange={(v) => chain().setLineHeight(v || null).run()}
            >
              <option value="">Auto</option>
              {LINE_HEIGHTS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Picker>
          </div>
          <div className="flex gap-0.5">
            <Tool icon="alignLeft" label="Align left (Ctrl+Shift+L)" active={s.align === 'left'} onClick={() => chain().setTextAlign('left').run()} />
            <Tool icon="alignCenter" label="Center (Ctrl+Shift+E)" active={s.align === 'center'} onClick={() => chain().setTextAlign('center').run()} />
            <Tool icon="alignRight" label="Align right (Ctrl+Shift+R)" active={s.align === 'right'} onClick={() => chain().setTextAlign('right').run()} />
            <Tool icon="alignJustify" label="Justify (Ctrl+Shift+J)" active={s.align === 'justify'} onClick={() => chain().setTextAlign('justify').run()} />
          </div>
        </div>
      </Group>

      <Group label="Insert">
        <ActionMenu
          label="Table"
          icon="table"
          size="sm"
          triggerClassName="!h-8 !w-8"
          items={[
            !s.table && { label: 'Insert a 3 × 3 table', icon: 'table', onSelect: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
            s.table && { label: 'Add a row below', onSelect: () => chain().addRowAfter().run() },
            s.table && { label: 'Add a column to the right', onSelect: () => chain().addColumnAfter().run() },
            s.table && { label: 'Header row on or off', onSelect: () => chain().toggleHeaderRow().run() },
            s.table && { label: 'Delete this row', separated: true, onSelect: () => chain().deleteRow().run() },
            s.table && { label: 'Delete this column', onSelect: () => chain().deleteColumn().run() },
            s.table && { label: 'Delete the table', tone: 'danger', icon: 'trash', onSelect: () => chain().deleteTable().run() },
          ]}
        />
        <Tool icon="image" label="Picture" onClick={onPicture} />
        <Tool icon="pageBreak" label="Page break (Ctrl+Enter)" onClick={() => chain().setPageBreak().run()} />
      </Group>

      <Group label="Page">
        <Picker label="Page size" value={page} className="w-[8.5rem]" onChange={(v) => onPage(v as PageSizeId)}>
          {(Object.keys(PAGE_SIZES) as PageSizeId[]).map((id) => (
            <option key={id} value={id}>
              {PAGE_SIZES[id].label}
            </option>
          ))}
        </Picker>
      </Group>
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 flex-col items-center border-r border-line px-1.5 last:border-r-0">
      <div className="flex flex-1 items-center gap-0.5">{children}</div>
      <span className="mt-0.5 hidden text-[10px] text-faint lg:block">{label}</span>
    </div>
  )
}

function Tool({
  icon,
  text,
  label,
  active = false,
  disabled = false,
  className = '',
  onClick,
}: {
  icon?: IconName
  text?: string
  label: string
  active?: boolean
  disabled?: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      // Keeps the selection in the document while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-[13px] text-ink transition-colors hover:bg-[var(--surface-sunken)] disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? 'bg-navy-600/15 text-navy-700 ring-1 ring-navy-600/30 dark:bg-navy-400/20 dark:text-navy-100' : ''
      } ${className}`}
    >
      {icon ? <Icon name={icon} size={16} /> : text}
    </button>
  )
}

function Picker({
  label,
  value,
  onChange,
  className = '',
  icon,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  icon?: IconName
  children: ReactNode
}) {
  return (
    <label className={`flex h-8 items-center gap-1 rounded-md border border-[var(--control-line)] surface px-1.5 ${className}`} title={label}>
      {icon && <Icon name={icon} size={15} className="shrink-0 text-muted" />}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 cursor-pointer bg-transparent text-[12.5px] text-ink outline-none"
      >
        {children}
      </select>
    </label>
  )
}

function Swatches({
  label,
  colors,
  current,
  trigger,
  onPick,
  custom = false,
  resetLabel,
}: {
  label: string
  colors: string[]
  current: string | null
  trigger: ReactNode
  onPick: (color: string | null) => void
  custom?: boolean
  resetLabel: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  function pick(color: string | null) {
    onPick(color)
    setOpen(false)
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 min-w-8 place-items-center rounded-md px-1.5 text-ink hover:bg-[var(--surface-sunken)]"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-30 mt-1 w-[11.5rem] rounded-lg border border-line surface-raised p-2 shadow-[var(--shadow-lift)]"
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(null)}
            className="mb-1.5 w-full rounded-md px-2 py-1 text-left text-[12px] text-ink hover:bg-[var(--surface-sunken)]"
          >
            {resetLabel}
          </button>
          <div className="grid grid-cols-5 gap-1.5">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                title={c}
                aria-pressed={current?.toLowerCase() === c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c)}
                className="h-6 w-6 rounded border border-[var(--paper-line)] aria-pressed:ring-2 aria-pressed:ring-[var(--ring)]"
                style={{ background: c }}
              />
            ))}
          </div>
          {custom && (
            <label className="mt-2 flex items-center justify-between gap-2 text-[12px] text-muted">
              More colours
              <input
                type="color"
                value={current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'}
                onChange={(e) => onPick(e.target.value)}
                className="h-6 w-10 cursor-pointer rounded border border-line bg-transparent"
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}
