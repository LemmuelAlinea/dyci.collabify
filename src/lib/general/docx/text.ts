import { strFromU8, unzipSync } from 'fflate'

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/** The words of a .docx, one line per paragraph. A file that cannot be read gives ''. */
export function docxParagraphs(bytes: Uint8Array): string {
  try {
    const xml = strFromU8(unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml'])
    const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
    return paragraphs
      .map((p) =>
        decode(
          p
            .replace(/<w:tab\s*\/>/g, '\t')
            .replace(/<w:(?:br|cr)\s*\/>/g, ' ')
            .replace(/<[^>]+>/g, ''),
        ),
      )
      .join('\n')
  } catch {
    return ''
  }
}
