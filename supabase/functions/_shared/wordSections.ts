/**
 * Word lets a "continuous" section break change the header, footer or page
 * numbering, and applies the change from the next page. LibreOffice can only
 * change those at a page break, so after a continuous break it keeps the old
 * header for the rest of the file: a thesis that starts its bordered "Page N"
 * header at Chapter 1 came out with no header on any page.
 *
 * Where Word itself put the new section at the top of a page (its last layout
 * marked a page break there, or there is an explicit one), the break is turned
 * into a next-page break. Pagination is unchanged, and LibreOffice now switches
 * the header and restarts the numbering where Word does. Only the copy sent to
 * the converter changes; the stored Word file is never touched.
 */

/** What a section changes that only a page break can carry. */
const PAGE_LEVEL = /<w:(headerReference|footerReference|pgNumType|titlePg)\b/
/** A page starts here in Word: the paragraph begins with a rendered or explicit page break, or has page-break-before. */
function startsPage(paragraph: string) {
  if (/<w:pageBreakBefore(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(paragraph)) return true
  const firstText = paragraph.search(/<w:t[ >]/)
  const head = firstText === -1 ? paragraph : paragraph.slice(0, firstText)
  return /<w:lastRenderedPageBreak\s*\/>|<w:br\b[^>]*w:type="page"/.test(head)
}

/** Answers document.xml with those continuous breaks made next-page breaks, and how many changed. */
export function pageAlignedSections(xml: string): { xml: string; changed: number } {
  const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)]
  if (sects.length < 2) return { xml, changed: 0 }

  const edits: { at: number; from: string; to: string }[] = []
  for (let k = 1; k < sects.length; k++) {
    const sect = sects[k][0]
    // A section's sectPr, at its end, says how that section starts.
    if (!/<w:type\s+w:val="continuous"\s*\/>/.test(sect) || !PAGE_LEVEL.test(sect)) continue
    // The section starts after the paragraph holding the previous section's sectPr.
    const prev = sects[k - 1]
    const holderEnd = xml.indexOf('</w:p>', prev.index! + prev[0].length)
    if (holderEnd === -1) continue
    const holderStart = Math.max(xml.lastIndexOf('<w:p>', prev.index!), xml.lastIndexOf('<w:p ', prev.index!))
    const holder = xml.slice(holderStart, holderEnd)
    const after = xml.slice(holderEnd + '</w:p>'.length).match(/^\s*(<w:p\b[\s\S]*?<\/w:p>)/)
    const pageBreakInHolder = /<w:br\b[^>]*w:type="page"/.test(holder)
    if (!pageBreakInHolder && !(after && startsPage(after[1]))) continue
    edits.push({ at: sects[k].index!, from: sect, to: sect.replace(/<w:type\s+w:val="continuous"\s*\/>/, '<w:type w:val="nextPage"/>') })
  }

  let out = xml
  for (const edit of edits.reverse()) out = out.slice(0, edit.at) + edit.to + out.slice(edit.at + edit.from.length)
  return { xml: out, changed: edits.length }
}
