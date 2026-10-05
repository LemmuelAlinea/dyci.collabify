import { Extension, mergeAttributes, Node } from '@tiptap/core'
import type { CommandProps } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TableCell, TableHeader } from '@tiptap/extension-table'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineHeight: (value: string | null) => ReturnType
      indent: () => ReturnType
      outdent: () => ReturnType
    }
    pageBreak: {
      setPageBreak: () => ReturnType
    }
  }
}

const BLOCKS = ['paragraph', 'heading']
/** Half an inch, Word's indent step. */
export const INDENT_STEP = 48
const MAX_INDENT = 8

const styleAttr = (css: string, value: string | null) => (value ? { style: `${css}: ${value}` } : {})

/**
 * What Word keeps on a paragraph rather than on its letters: line spacing,
 * indent, first-line indent and the space above and below. Each is a plain
 * inline style, so the stored HTML reads like any other.
 */
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => el.style.lineHeight || null,
            renderHTML: (a) => styleAttr('line-height', a.lineHeight),
          },
          indent: {
            default: 0,
            parseHTML: (el) => {
              const px = parseFloat(el.style.marginLeft)
              return px > 0 ? Math.min(MAX_INDENT, Math.max(1, Math.round(px / INDENT_STEP))) : 0
            },
            renderHTML: (a) => (a.indent ? { style: `margin-left: ${a.indent * INDENT_STEP}px` } : {}),
          },
          firstLine: {
            default: null,
            parseHTML: (el) => el.style.textIndent || null,
            renderHTML: (a) => styleAttr('text-indent', a.firstLine),
          },
          spaceBefore: {
            default: null,
            parseHTML: (el) => el.style.marginTop || null,
            renderHTML: (a) => styleAttr('margin-top', a.spaceBefore),
          },
          spaceAfter: {
            default: null,
            parseHTML: (el) => el.style.marginBottom || null,
            renderHTML: (a) => styleAttr('margin-bottom', a.spaceAfter),
          },
        },
      },
    ]
  },

  addCommands() {
    const shift =
      (delta: number) =>
      ({ state, tr, dispatch }: CommandProps) => {
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!BLOCKS.includes(node.type.name)) return true
          const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta))
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
            changed = true
          }
          return false
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    return {
      setLineHeight:
        (value) =>
        ({ commands }) =>
          BLOCKS.map((type) => commands.updateAttributes(type, { lineHeight: value })).some(Boolean),
      indent: () => shift(1),
      outdent: () => shift(-1),
    }
  },
})

/**
 * Starts a new page, like Ctrl+Enter in Word. On screen it is a block whose
 * height `WordEditor` sets to whatever is left of its page, so what follows
 * starts at the top of the next one; in a .docx it is a real page break.
 */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '' })]
  },

  addNodeView() {
    return () => {
      const dom = document.createElement('div')
      dom.className = 'word-page-break'
      dom.dataset.pageBreak = ''
      dom.contentEditable = 'false'
      const label = document.createElement('span')
      label.textContent = 'Page break'
      dom.append(label)
      return { dom }
    }
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain }) =>
          chain().insertContent([{ type: this.name }, { type: 'paragraph' }]).run(),
    }
  },

  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }
  },
})

/**
 * A picture stored in the project's files. The HTML keeps only its storage
 * path (`data-path`); the signed link that shows it is put in when the file
 * opens and left out when it saves, because those links expire.
 */
export const DocImage = Image.extend({
  parseHTML() {
    return [{ tag: 'img[data-path]' }, { tag: 'img[src]:not([src^="data:"])' }]
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        renderHTML: (a) => (a.path ? {} : { src: a.src }),
      },
      path: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-path'),
        renderHTML: (a) => (a.path ? { 'data-path': a.path } : {}),
      },
    }
  },
}).configure({
  inline: false,
  allowBase64: false,
  resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 40, minHeight: 20 },
})

/** A cell's fill, as Word's cell shading. */
const cellBackground = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
    renderHTML: (a: Record<string, unknown>) => (a.background ? { style: `background-color: ${a.background}` } : {}),
  },
}

export const ShadedCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground }
  },
})

export const ShadedHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground }
  },
})
