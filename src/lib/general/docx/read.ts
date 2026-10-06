/**
 * A .docx as styled HTML for the Word editor.
 *
 * Reads WordprocessingML directly (fflate unzips; the browser's XML parser
 * reads) instead of going through mammoth, because mammoth deliberately
 * drops what this editor now shows: fonts, sizes, colours, highlight,
 * alignment, line spacing, indents, page breaks and page size. What comes
 * across: paragraphs and headings, runs with bold/italic/underline/strike,
 * font, size, colour, highlight and shading; bullet and numbered lists by
 * level; tables with merged cells; pictures; hyperlinks; page breaks.
 * What does not: headers and footers, footnotes, comments, tracked changes
 * (insertions are kept, deletions dropped), text boxes, charts, equations.
 *
 * Pictures come back as `<img data-docx-image="word/media/…">`; the caller
 * uploads each one and swaps in its storage path.
 */
import { strFromU8, unzipSync } from 'fflate'
import { fontName, fontStack, HIGHLIGHTS, pageSizeFromTwips, writePageSetting } from '../wordPage'
import type { PageSizeId } from '../wordPage'

export type DocxPicture = { target: string; data: Uint8Array; mime: string }
export type DocxRead = { html: string; page: PageSizeId; pictures: DocxPicture[] }

type RunProps = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: string
  /** Points. */
  size?: number
  color?: string
  highlight?: string
  shade?: string
}

type ParaProps = {
  align?: string
  /** Multiple of single spacing. */
  line?: number
  /** Points. */
  before?: number
  after?: number
  /** Twips. */
  left?: number
  firstLine?: number
  hanging?: number
  num?: { id: string; level: number }
  pageBreakBefore?: boolean
}

type Style = { name: string; basedOn?: string; run: RunProps; para: ParaProps }

/** The editor's own defaults: Calibri 11, so a run in them needs no style. */
const EDITOR_FONT = 'Calibri'
const EDITOR_SIZE = 11

const kids = (el: Element | null | undefined, name?: string) =>
  el ? [...el.children].filter((c) => !name || c.localName === name) : []
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0]
const val = (el: Element | null | undefined, name = 'val') => el?.getAttribute(`w:${name}`) ?? null
const on = (el: Element | undefined) => {
  if (!el) return undefined
  const v = val(el)
  return v === null || !['false', '0', 'off', 'none'].includes(v)
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function readRunProps(rPr: Element | undefined): RunProps {
  if (!rPr) return {}
  const out: RunProps = {}
  const b = on(kid(rPr, 'b'))
  if (b !== undefined) out.bold = b
  const i = on(kid(rPr, 'i'))
  if (i !== undefined) out.italic = i
  const u = kid(rPr, 'u')
  if (u) out.underline = val(u) !== 'none'
  const strike = on(kid(rPr, 'strike')) ?? on(kid(rPr, 'dstrike'))
  if (strike !== undefined) out.strike = strike
  const fonts = kid(rPr, 'rFonts')
  const font = val(fonts, 'ascii') ?? val(fonts, 'hAnsi') ?? val(fonts, 'cs')
  if (font) out.font = font
  const sz = val(kid(rPr, 'sz'))
  if (sz && !Number.isNaN(Number(sz))) out.size = Number(sz) / 2
  const color = val(kid(rPr, 'color'))
  if (color && color !== 'auto' && /^[0-9a-f]{6}$/i.test(color)) out.color = color.toLowerCase()
  const hl = val(kid(rPr, 'highlight'))
  const hlHex = HIGHLIGHTS.find((h) => h.name.toLowerCase() === hl?.toLowerCase())?.hex
  if (hlHex) out.highlight = hlHex
  const fill = val(kid(rPr, 'shd'), 'fill')
  if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill)) out.shade = `#${fill.toLowerCase()}`
  return out
}

function readParaProps(pPr: Element | undefined): ParaProps {
  if (!pPr) return {}
  const out: ParaProps = {}
  const jc = val(kid(pPr, 'jc'))
  if (jc) out.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc
  const spacing = kid(pPr, 'spacing')
  if (spacing) {
    const line = val(spacing, 'line')
    const rule = val(spacing, 'lineRule')
    if (line && (!rule || rule === 'auto')) out.line = Math.round((Number(line) / 240) * 100) / 100
    const before = val(spacing, 'before')
    if (before) out.before = Number(before) / 20
    const after = val(spacing, 'after')
    if (after) out.after = Number(after) / 20
  }
  const ind = kid(pPr, 'ind')
  if (ind) {
    const left = val(ind, 'left') ?? val(ind, 'start')
    if (left) out.left = Number(left)
    const first = val(ind, 'firstLine')
    if (first) out.firstLine = Number(first)
    const hanging = val(ind, 'hanging')
    if (hanging) out.hanging = Number(hanging)
  }
  const numPr = kid(pPr, 'numPr')
  if (numPr) {
    const id = val(kid(numPr, 'numId'))
    if (id && id !== '0') out.num = { id, level: Number(val(kid(numPr, 'ilvl')) ?? 0) }
  }
  const pbb = on(kid(pPr, 'pageBreakBefore'))
  if (pbb) out.pageBreakBefore = true
  return out
}

function parseXml(files: Record<string, Uint8Array>, path: string) {
  const bytes = files[path]
  if (!bytes) return null
  return new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
}

/** Reads a .docx's bytes. Throws on anything that is not one. */
export function readDocxBytes(bytes: Uint8Array): DocxRead {
  const files = unzipSync(bytes)
  const doc = parseXml(files, 'word/document.xml')
  const body = doc?.getElementsByTagName('w:body')[0]
  if (!doc || !body) throw new Error('This is not a Word document.')

  // ------------------------------------------------------------ styles
  const stylesXml = parseXml(files, 'word/styles.xml')
  const styles = new Map<string, Style>()
  let defaultRun: RunProps = {}
  let defaultPara: ParaProps = {}
  let defaultParaStyle: string | undefined
  if (stylesXml) {
    const defaults = stylesXml.getElementsByTagName('w:docDefaults')[0]
    defaultRun = readRunProps(kid(kid(defaults, 'rPrDefault'), 'rPr'))
    defaultPara = readParaProps(kid(kid(defaults, 'pPrDefault'), 'pPr'))
    for (const s of [...stylesXml.getElementsByTagName('w:style')]) {
      const id = val(s, 'styleId')
      if (!id) continue
      styles.set(id, {
        name: val(kid(s, 'name')) ?? id,
        basedOn: val(kid(s, 'basedOn')) ?? undefined,
        run: readRunProps(kid(s, 'rPr')),
        para: readParaProps(kid(s, 'pPr')),
      })
      if (val(s, 'type') === 'paragraph' && val(s, 'default') === '1') defaultParaStyle = id
    }
  }
  const chain = (id: string | undefined): Style[] => {
    const out: Style[] = []
    const seen = new Set<string>()
    let at = id
    while (at && styles.has(at) && !seen.has(at)) {
      seen.add(at)
      const s = styles.get(at) as Style
      out.unshift(s)
      at = s.basedOn
    }
    return out
  }
  const headingLevel = (id: string | undefined) => {
    for (const s of chain(id).reverse()) {
      const n = s.name.toLowerCase()
      if (n === 'title') return 1
      const m = n.match(/^heading\s*(\d)$/)
      if (m) return Math.min(3, Number(m[1]))
    }
    return 0
  }

  // ------------------------------------------------------------ numbering
  const numberingXml = parseXml(files, 'word/numbering.xml')
  const abstractFormats = new Map<string, Map<number, string>>()
  const numToAbstract = new Map<string, string>()
  if (numberingXml) {
    for (const a of [...numberingXml.getElementsByTagName('w:abstractNum')]) {
      const levels = new Map<number, string>()
      for (const l of kids(a, 'lvl')) levels.set(Number(val(l, 'ilvl') ?? 0), val(kid(l, 'numFmt')) ?? 'bullet')
      abstractFormats.set(val(a, 'abstractNumId') ?? '', levels)
    }
    for (const n of [...numberingXml.getElementsByTagName('w:num')]) {
      numToAbstract.set(val(n, 'numId') ?? '', val(kid(n, 'abstractNumId')) ?? '')
    }
  }
  const listTag = (num: { id: string; level: number }) => {
    const fmt = abstractFormats.get(numToAbstract.get(num.id) ?? '')?.get(num.level) ?? 'bullet'
    return fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol'
  }

  // ------------------------------------------------------------ relationships
  const relsXml = parseXml(files, 'word/_rels/document.xml.rels')
  const rels = new Map<string, { target: string; external: boolean }>()
  for (const r of relsXml ? [...relsXml.getElementsByTagName('Relationship')] : []) {
    rels.set(r.getAttribute('Id') ?? '', {
      target: r.getAttribute('Target') ?? '',
      external: r.getAttribute('TargetMode') === 'External',
    })
  }
  const pictures = new Map<string, DocxPicture>()
  const pictureFor = (rid: string) => {
    const rel = rels.get(rid)
    if (!rel || rel.external) return null
    const target = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target.replace(/^\.\//, '')}`
    const data = files[target]
    if (!data) return null
    const ext = target.slice(target.lastIndexOf('.') + 1).toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ''
    if (!mime) return null
    if (!pictures.has(target)) pictures.set(target, { target, data, mime })
    return target
  }

  // ------------------------------------------------------------ runs
  const runHtml = (text: string, p: RunProps, heading: boolean) => {
    if (!text) return ''
    let html = esc(text)
    const css: string[] = []
    if (p.font && !heading && fontName(fontStack(p.font)) !== EDITOR_FONT) css.push(`font-family: ${fontStack(p.font)}`)
    if (p.size && !heading && p.size !== EDITOR_SIZE) css.push(`font-size: ${p.size}pt`)
    if (p.color && p.color !== '000000') css.push(`color: #${p.color}`)
    if (p.shade && !p.highlight) css.push(`background-color: ${p.shade}`)
    if (css.length) html = `<span style="${css.join('; ')}">${html}</span>`
    if (p.highlight) html = `<mark data-color="${p.highlight}" style="background-color: ${p.highlight}">${html}</mark>`
    if (p.strike) html = `<s>${html}</s>`
    if (p.underline) html = `<u>${html}</u>`
    if (p.italic) html = `<em>${html}</em>`
    if (p.bold) html = `<strong>${html}</strong>`
    return html
  }

  type Segment = { kind: 'text' | 'picture' | 'break'; html: string }

  /** A paragraph's content, in order: text, pictures, and page breaks inside it. */
  const inline = (p: Element, base: RunProps, heading: boolean): Segment[] => {
    const segs: Segment[] = []
    const text = (html: string) => {
      const last = segs[segs.length - 1]
      if (last?.kind === 'text') last.html += html
      else segs.push({ kind: 'text', html })
    }
    const walk = (node: Element, link: string | null) => {
      for (const c of kids(node)) {
        switch (c.localName) {
          case 'r': {
            const own = readRunProps(kid(c, 'rPr'))
            const styleId = val(kid(kid(c, 'rPr'), 'rStyle'))
            const fromStyle = styleId ? chain(styleId).reduce((a, s) => ({ ...a, ...s.run }), {} as RunProps) : {}
            // A heading looks like the page's heading style; only what was set on the text itself comes along.
            const props = heading ? { ...fromStyle, ...own } : { ...base, ...fromStyle, ...own }
            for (const piece of kids(c)) {
              let html = ''
              if (piece.localName === 't') html = runHtml(piece.textContent ?? '', props, heading)
              else if (piece.localName === 'tab') html = '	'
              else if (piece.localName === 'br' || piece.localName === 'cr') {
                if (val(piece, 'type') === 'page') {
                  segs.push({ kind: 'break', html: '' })
                  continue
                }
                html = '<br>'
              } else if (piece.localName === 'drawing' || piece.localName === 'pict') {
                const blip = piece.getElementsByTagName('a:blip')[0] ?? piece.getElementsByTagName('v:imagedata')[0]
                const rid = blip?.getAttribute('r:embed') ?? blip?.getAttribute('r:id')
                const target = rid ? pictureFor(rid) : null
                if (target) {
                  const extent = piece.getElementsByTagName('wp:extent')[0]
                  const w = Math.round(Number(extent?.getAttribute('cx') ?? 0) / 9525)
                  const h = Math.round(Number(extent?.getAttribute('cy') ?? 0) / 9525)
                  segs.push({
                    kind: 'picture',
                    html: `<img data-docx-image="${esc(target)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`,
                  })
                }
                continue
              }
              if (html) text(link ? `<a href="${esc(link)}">${html}</a>` : html)
            }
            break
          }
          case 'hyperlink': {
            const rel = rels.get(c.getAttribute('r:id') ?? '')
            const href = rel?.external && /^(https?:|mailto:)/i.test(rel.target) ? rel.target : null
            walk(c, href)
            break
          }
          // Insertions, smart tags, fields and content controls all wrap ordinary runs.
          case 'ins':
          case 'smartTag':
          case 'fldSimple':
          case 'customXml':
            walk(c, link)
            break
          case 'sdt':
            walk(kid(c, 'sdtContent') ?? c, link)
            break
          default:
            break
        }
      }
    }
    walk(p, null)
    return segs
  }

  // ------------------------------------------------------------ blocks
  const DEFAULT_LINE = 1.15
  const DEFAULT_AFTER = 8
  const paraCss = (pp: ParaProps, inList: boolean) => {
    const css: string[] = []
    if (pp.align && pp.align !== 'left') css.push(`text-align: ${pp.align}`)
    if (pp.line && Math.abs(pp.line - DEFAULT_LINE) > 0.02) css.push(`line-height: ${pp.line}`)
    if (!inList && pp.left && pp.left >= 360) css.push(`margin-left: ${Math.min(8, Math.round(pp.left / 720)) * 48}px`)
    if (pp.firstLine) css.push(`text-indent: ${pp.firstLine / 20}pt`)
    else if (pp.hanging && !inList) css.push(`text-indent: -${pp.hanging / 20}pt`)
    if (pp.before) css.push(`margin-top: ${pp.before}pt`)
    if (pp.after !== undefined && pp.after !== DEFAULT_AFTER) css.push(`margin-bottom: ${pp.after}pt`)
    return css.length ? ` style="${css.join('; ')}"` : ''
  }

  const out: string[] = []
  // Open lists, innermost last.
  const lists: { tag: string; level: number }[] = []
  const closeOne = () => out.push(`</li></${(lists.pop() as { tag: string }).tag}>`)
  const closeLists = () => {
    while (lists.length) closeOne()
  }
  /** Starts a list item at `level`, opening, closing or switching lists to get there. */
  const listItem = (tag: string, level: number) => {
    while (lists.length && lists[lists.length - 1].level > level) closeOne()
    const top = lists[lists.length - 1]
    if (top && top.level === level) {
      if (top.tag === tag) return void out.push('</li><li>')
      closeOne()
    }
    while (!lists.length || lists[lists.length - 1].level < level) {
      const next = lists.length ? lists[lists.length - 1].level + 1 : level
      lists.push({ tag, level: next })
      out.push(`<${tag}><li>`)
    }
  }

  const paragraph = (p: Element, target: string[], inCell: boolean) => {
    const pPr = kid(p, 'pPr')
    const styleId = val(kid(pPr, 'pStyle')) ?? defaultParaStyle
    const level = headingLevel(styleId)
    const styleChain = chain(styleId)
    const pp: ParaProps = { ...defaultPara, ...styleChain.reduce((a, s) => ({ ...a, ...s.para }), {} as ParaProps), ...readParaProps(pPr) }
    const base: RunProps = { ...defaultRun, ...styleChain.reduce((a, s) => ({ ...a, ...s.run }), {} as RunProps) }
    const tag = level ? `h${level}` : 'p'
    const num = !inCell && !level ? pp.num : undefined
    const block = (html: string) => `<${tag}${paraCss(pp, Boolean(num))}>${html}</${tag}>`

    if (pp.pageBreakBefore && !inCell) {
      closeLists()
      out.push('<div data-page-break=""></div>')
    }

    const segs = inline(p, base, level > 0)
    let first = true
    const emit = (html: string) => {
      if (num && first) {
        listItem(listTag(num), Math.min(num.level, 4))
        out.push(block(html))
      } else {
        if (!inCell && !num) closeLists()
        target.push(block(html))
      }
      first = false
    }
    if (segs.length === 0) return emit('')
    for (const seg of segs) {
      if (seg.kind === 'text') emit(seg.html)
      else if (seg.kind === 'picture') {
        if (!inCell && !num) closeLists()
        ;(num ? out : target).push(seg.html)
      } else if (!inCell) {
        closeLists()
        out.push('<div data-page-break=""></div>')
      }
    }
  }

  const table = (tbl: Element, target: string[]) => {
    const rows = kids(tbl, 'tr')
    // Rows a vertically merged cell still covers, by column, from the row that started it.
    const grid = rows.map((tr) => {
      let col = 0
      return kids(tr, 'tc').map((tc) => {
        const tcPr = kid(tc, 'tcPr')
        const span = Number(val(kid(tcPr, 'gridSpan')) ?? 1)
        const vMerge = kid(tcPr, 'vMerge')
        const cell = { tc, col, span, merge: vMerge ? (val(vMerge) === 'restart' ? 'start' : 'continue') : null, rows: 1 }
        col += span
        return cell
      })
    })
    grid.forEach((row, r) => {
      for (const cell of row) {
        if (cell.merge !== 'start') continue
        for (let below = r + 1; below < grid.length; below++) {
          const next = grid[below].find((c) => c.col === cell.col)
          if (next?.merge !== 'continue') break
          cell.rows++
        }
      }
    })
    const header = on(kid(kid(rows[0], 'trPr'), 'tblHeader')) ?? false
    target.push('<table><tbody>')
    grid.forEach((row, r) => {
      target.push('<tr>')
      for (const cell of row) {
        if (cell.merge === 'continue') continue
        const tag = header && r === 0 ? 'th' : 'td'
        const inner: string[] = []
        blocks(cell.tc, inner, true)
        const fill = val(kid(kid(cell.tc, 'tcPr'), 'shd'), 'fill')
        const shade = fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill) ? ` style="background-color: #${fill.toLowerCase()}"` : ''
        const attrs = `${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${cell.rows > 1 ? ` rowspan="${cell.rows}"` : ''}${shade}`
        target.push(`<${tag}${attrs}>${inner.join('') || '<p></p>'}</${tag}>`)
      }
      target.push('</tr>')
    })
    target.push('</tbody></table>')
  }

  const blocks = (parent: Element, target: string[], inCell: boolean) => {
    for (const c of kids(parent)) {
      if (c.localName === 'p') paragraph(c, target, inCell)
      else if (c.localName === 'tbl') {
        if (!inCell) closeLists()
        table(c, target)
      } else if (c.localName === 'sdt') blocks(kid(c, 'sdtContent') ?? c, target, inCell)
      else if (c.localName === 'customXml') blocks(c, target, inCell)
    }
  }

  blocks(body, out, false)
  closeLists()

  const pgSz = kid(kid(body, 'sectPr'), 'pgSz')
  const w = Number(val(pgSz, 'w') ?? 0)
  const h = Number(val(pgSz, 'h') ?? 0)
  const page = w && h ? pageSizeFromTwips(w, h) : 'letter'

  return { html: writePageSetting(page, out.join('') || '<p></p>'), page, pictures: [...pictures.values()] }
}
