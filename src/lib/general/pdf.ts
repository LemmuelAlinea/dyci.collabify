/**
 * A rich document's HTML as a PDF, built in the browser.
 *
 * Covers what `RichEditor` writes: headings, paragraphs, lists and line breaks.
 * Bold and italics come out as plain text, and tables as spaced-out lines. jsPDF is loaded on demand,
 * like the Word and Excel writers, so nobody downloads it until they ask for a
 * PDF.
 */
export async function htmlToPdf(html: string, title: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const margin = 56
  const width = pdf.internal.pageSize.getWidth() - margin * 2
  const bottom = pdf.internal.pageSize.getHeight() - margin
  let y = margin

  pdf.setProperties({ title })

  function write(text: string, size: number, bold: boolean, indent = 0, gapAfter = 6) {
    const clean = text.replace(/\s+\n/g, '\n').trim()
    if (!clean) return
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(clean, width - indent) as string[]
    const lineHeight = size * 1.35
    for (const line of lines) {
      if (y + lineHeight > bottom) {
        pdf.addPage()
        y = margin
      }
      pdf.text(line, margin + indent, y + size)
      y += lineHeight
    }
    y += gapAfter
  }

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const textOf = (el: Element) => {
    const copy = el.cloneNode(true) as Element
    copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
    return copy.textContent ?? ''
  }

  function walk(el: Element) {
    const tag = el.tagName.toLowerCase()
    if (tag === 'h1') return write(textOf(el), 18, true, 0, 10)
    if (tag === 'h2') return write(textOf(el), 14, true, 0, 8)
    if (tag === 'h3') return write(textOf(el), 12, true, 0, 6)
    if (tag === 'ul' || tag === 'ol') {
      Array.from(el.children).forEach((li, i) =>
        write(`${tag === 'ol' ? `${i + 1}.` : '•'} ${textOf(li)}`, 11, false, 14, 3),
      )
      y += 4
      return
    }
    if (tag === 'table') {
      el.querySelectorAll('tr').forEach((tr) =>
        write(Array.from(tr.children).map((c) => textOf(c).trim()).join('    '), 10, false, 0, 2),
      )
      y += 6
      return
    }
    if (tag === 'p' || tag === 'div' || tag === 'blockquote') return write(textOf(el), 11, false)
    Array.from(el.children).forEach(walk)
  }

  Array.from(doc.body.children).forEach(walk)
  if (doc.body.children.length === 0) write(doc.body.textContent ?? '', 11, false)

  return pdf.output('blob')
}
