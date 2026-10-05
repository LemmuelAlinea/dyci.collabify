/**
 * HTML back to a .docx.
 *
 * Walks the nodes rather than matching text, so nested markup keeps its
 * formatting and an unexpected tag degrades to its words instead of appearing
 * as angle brackets in somebody's thesis. Carries what the Word editor makes:
 * fonts, sizes, colours, highlight and shading; bold, italic, underline,
 * strike; alignment, line spacing, indents and paragraph spacing; headings;
 * bullet and numbered lists by level; tables with merged cells; pictures;
 * links; page breaks; and the page size.
 */
import { fontName, hexOf, HIGHLIGHTS, PAGE_SIZES, readPageSetting } from '../wordPage'

type Run = {
  text: string
  bold?: boolean
  italics?: boolean
  underline?: Record<string, never>
  strike?: boolean
  font?: string
  /** Half-points. */
  size?: number
  color?: string
  highlight?: string
  shade?: string
  link?: string
}

export type DocxWriteOptions = {
  /** Reads a stored picture by its storage path. Defaults to the project's files bucket. */
  loadPicture?: (path: string) => Promise<Blob>
}

const PX_TO_TWIPS = 15
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'div', 'blockquote', 'img', 'hr'])

export async function htmlToDocx(html: string, title: string, options: DocxWriteOptions = {}): Promise<Blob> {
  const d = await import('docx')
  const { page, body } = readPageSetting(html)
  const doc = new DOMParser().parseFromString(`<body>${body}</body>`, 'text/html')

  // Pictures are read before anything is built, so building stays synchronous.
  const pictures = new Map<HTMLImageElement, { data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null>()
  const load =
    options.loadPicture ??
    (async (path: string) => (await import('../../api/general')).projectFileBlob(path))
  await Promise.all(
    [...doc.querySelectorAll('img')].map(async (img) => {
      try {
        const path = img.getAttribute('data-path')
        const src = img.getAttribute('src')
        const blob = path ? await load(path) : src && /^https?:/.test(src) ? await (await fetch(src)).blob() : null
        if (!blob) return pictures.set(img, null)
        const type = blob.type.includes('png') ? 'png' : blob.type.includes('gif') ? 'gif' : blob.type.includes('bmp') ? 'bmp' : 'jpg'
        pictures.set(img, { data: await blob.arrayBuffer(), type })
      } catch {
        pictures.set(img, null)
      }
    }),
  )

  const HEADINGS: Record<string, (typeof d.HeadingLevel)[keyof typeof d.HeadingLevel]> = {
    h1: d.HeadingLevel.HEADING_1,
    h2: d.HeadingLevel.HEADING_2,
    h3: d.HeadingLevel.HEADING_3,
    h4: d.HeadingLevel.HEADING_4,
    h5: d.HeadingLevel.HEADING_5,
    h6: d.HeadingLevel.HEADING_6,
  }
  const ALIGN: Record<string, (typeof d.AlignmentType)[keyof typeof d.AlignmentType]> = {
    left: d.AlignmentType.LEFT,
    center: d.AlignmentType.CENTER,
    right: d.AlignmentType.RIGHT,
    justify: d.AlignmentType.JUSTIFIED,
  }

  const runStyle = (el: HTMLElement, style: Run): Run => {
    const next: Run = { ...style }
    const tag = el.tagName.toLowerCase()
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italics = true
    if (tag === 'u') next.underline = {}
    if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
    if (tag === 'a') next.link = el.getAttribute('href') ?? undefined
    const css = el.style
    if (css.fontWeight === 'bold' || Number(css.fontWeight) >= 600) next.bold = true
    if (css.fontStyle === 'italic') next.italics = true
    if (css.textDecoration.includes('underline')) next.underline = {}
    if (css.textDecoration.includes('line-through')) next.strike = true
    if (css.fontFamily) next.font = fontName(css.fontFamily)
    const size = css.fontSize.match(/^([\d.]+)(pt|px)$/)
    if (size) next.size = Math.round((size[2] === 'px' ? Number(size[1]) * 0.75 : Number(size[1])) * 2)
    const color = hexOf(css.color)
    if (color) next.color = color
    const bg = hexOf(tag === 'mark' ? el.getAttribute('data-color') || css.backgroundColor : css.backgroundColor)
    if (bg) {
      const named = HIGHLIGHTS.find((h) => h.hex === `#${bg}`)
      if (named) next.highlight = named.name
      else next.shade = bg
    } else if (tag === 'mark') next.highlight = 'yellow'
    return next
  }

  type Inline = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink> | InstanceType<typeof d.ImageRun>

  const textRun = (r: Run) =>
    new d.TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italics,
      underline: r.underline,
      strike: r.strike,
      font: r.font,
      size: r.size,
      color: r.color,
      highlight: r.highlight as (typeof d.HighlightColor)[keyof typeof d.HighlightColor] | undefined,
      shading: r.shade ? { type: d.ShadingType.CLEAR, fill: r.shade, color: 'auto' } : undefined,
      style: r.link ? 'Hyperlink' : undefined,
    })

  const picture = (img: HTMLImageElement) => {
    const pic = pictures.get(img)
    if (!pic) return null
    const width = Number(img.getAttribute('width')) || 300
    const height = Number(img.getAttribute('height')) || Math.round(width * 0.66)
    return new d.ImageRun({ type: pic.type, data: pic.data, transformation: { width, height } })
  }

  const inlines = (node: Node, style: Run = { text: '' }): Inline[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!text) return []
      const run = textRun({ ...style, text })
      return [style.link ? new d.ExternalHyperlink({ link: style.link, children: [run] }) : run]
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') return [new d.TextRun({ text: '', break: 1 })]
    if (tag === 'img') {
      const p = picture(el as HTMLImageElement)
      return p ? [p] : []
    }
    const next = runStyle(el, style)
    return [...el.childNodes].flatMap((child) => inlines(child, next))
  }

  type ParagraphOptions = {
    heading?: (typeof d.HeadingLevel)[keyof typeof d.HeadingLevel]
    bullet?: number
    numbered?: { level: number; instance: number }
  }

  const paragraph = (el: HTMLElement, options: ParagraphOptions = {}, children?: Inline[]) => {
    const runs = children ?? inlines(el)
    const css = el.style
    const line = parseFloat(css.lineHeight)
    const left = parseFloat(css.marginLeft)
    const textIndent = css.textIndent.match(/^(-?[\d.]+)(pt|px)$/)
    const indentTwips = textIndent ? Math.round(Number(textIndent[1]) * (textIndent[2] === 'px' ? PX_TO_TWIPS : 20)) : 0
    const before = css.marginTop.match(/^([\d.]+)pt$/)
    const after = css.marginBottom.match(/^([\d.]+)pt$/)
    return new d.Paragraph({
      children: runs.length ? runs : [new d.TextRun('')],
      heading: options.heading,
      alignment: ALIGN[css.textAlign] ?? undefined,
      bullet: options.bullet !== undefined ? { level: options.bullet } : undefined,
      numbering: options.numbered ? { reference: 'numbered', level: options.numbered.level, instance: options.numbered.instance } : undefined,
      spacing:
        line || before || after
          ? {
              line: line && line < 10 ? Math.round(line * 240) : undefined,
              lineRule: line && line < 10 ? d.LineRuleType.AUTO : undefined,
              before: before ? Math.round(Number(before[1]) * 20) : undefined,
              after: after ? Math.round(Number(after[1]) * 20) : undefined,
            }
          : undefined,
      indent:
        left > 0 || indentTwips
          ? {
              left: left > 0 ? Math.round(left * PX_TO_TWIPS) : undefined,
              firstLine: indentTwips > 0 ? indentTwips : undefined,
              hanging: indentTwips < 0 ? -indentTwips : undefined,
            }
          : undefined,
    })
  }

  let listInstance = 0
  type Block = InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>

  const blocksOf = (parent: Node, out: Block[], list?: { ordered: boolean; level: number; instance: number }) => {
    let loose: Inline[] = []
    const flush = () => {
      if (!loose.length) return
      out.push(
        new d.Paragraph({
          children: loose,
          bullet: list && !list.ordered ? { level: list.level } : undefined,
          numbering: list?.ordered ? { reference: 'numbered', level: list.level, instance: list.instance } : undefined,
        }),
      )
      loose = []
    }
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.textContent ?? '').trim()) loose.push(...inlines(node))
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (!BLOCK_TAGS.has(tag)) {
        loose.push(...inlines(el))
        continue
      }
      flush()
      const listOptions = (): ParagraphOptions =>
        list ? (list.ordered ? { numbered: { level: list.level, instance: list.instance } } : { bullet: list.level }) : {}

      if (HEADINGS[tag]) out.push(paragraph(el, { heading: HEADINGS[tag] }))
      else if (tag === 'p') out.push(paragraph(el, listOptions()))
      else if (tag === 'img') {
        const p = picture(el as HTMLImageElement)
        if (p) out.push(new d.Paragraph({ children: [p] }))
      } else if (tag === 'hr') out.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 } } }))
      else if (tag === 'div' && el.hasAttribute('data-page-break')) out.push(new d.Paragraph({ children: [new d.PageBreak()] }))
      else if (tag === 'ul' || tag === 'ol') {
        const ordered = tag === 'ol'
        const level = list ? Math.min(list.level + 1, 8) : 0
        // Each top-level numbered list counts from 1; nested ones carry on their parent's.
        const instance = ordered && !list?.ordered ? ++listInstance : (list?.instance ?? 0)
        for (const li of [...el.children]) {
          if (li.tagName.toLowerCase() === 'li') blocksOf(li, out, { ordered, level, instance })
        }
      } else if (tag === 'li') blocksOf(el, out, list)
      else if (tag === 'table') {
        const rows = [...el.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr')].map(
          (tr) =>
            new d.TableRow({
              children: [...tr.children].map((cell) => {
                const inner: Block[] = []
                blocksOf(cell, inner)
                const fill = hexOf((cell as HTMLElement).style.backgroundColor)
                return new d.TableCell({
                  children: inner.length ? inner : [new d.Paragraph('')],
                  shading: fill ? { type: d.ShadingType.CLEAR, fill, color: 'auto' } : undefined,
                  columnSpan: Number(cell.getAttribute('colspan')) || undefined,
                  rowSpan: Number(cell.getAttribute('rowspan')) || undefined,
                })
              }),
            }),
        )
        if (rows.length) out.push(new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }))
      } else if (tag === 'blockquote' || tag === 'div') blocksOf(el, out, list)
    }
    flush()
  }

  const blocks: Block[] = []
  blocksOf(doc.body, blocks)
  if (blocks.length === 0) blocks.push(new d.Paragraph({ children: [new d.TextRun('')] }))

  const size = PAGE_SIZES[page]
  const ROMAN = [d.LevelFormat.DECIMAL, d.LevelFormat.LOWER_LETTER, d.LevelFormat.LOWER_ROMAN]
  const out = new d.Document({
    title,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'numbered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: ROMAN[level % 3],
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: size.twipsW, height: size.twipsH },
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children: blocks,
      },
    ],
  })
  return d.Packer.toBlob(out)
}
