import { SHEET_LIMIT } from './sheet'

const IMAGE_ROSTER_ERROR = 'That Word or Excel roster contains images. Export it as a PDF and upload it again so every member can be read.'

export type RosterRow = {
  name: string
  source: string
  teams: string[]
  positions: { team: string; name: string; scope: 'team' | 'project' | 'unknown' }[]
  skills: string[]
  present: { teams: boolean; positions: boolean; skills: boolean }
}

export async function readMemberImportFile(file: File): Promise<{ fileName: string; text: string } | { fileName: string; pdfBase64: string }> {
  const kind = file.name.split('.').pop()?.toLowerCase()
  if (!['docx', 'xlsx', 'pdf'].includes(kind ?? '')) throw new Error('Upload a .docx, .xlsx or PDF roster.')
  if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB. Upload a smaller roster.')
  const blocks: string[] = []
  let pdfBase64: string | undefined
  try {
    if (kind !== 'pdf') {
      const { unzipSync } = await import('fflate')
      let hasImages = false
      unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
        if (/^(word|xl)\/media\/.+/i.test(entry.name)) hasImages = true
        return false
      } })
      if (hasImages) throw new Error(IMAGE_ROSTER_ERROR)
    }
    if (kind === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
      if (result.messages.some(m => m.type === 'error')) throw new Error('Damaged document')
      result.value.trim().split(/\n\s*\n/).forEach((p, i) => {
        if (p.trim()) blocks.push(`[Paragraph ${i + 1}]\n${p.trim()}`)
      })
    } else if (kind === 'xlsx') {
      // The editor's reader caps sheet dimensions; refuse before it can cut a roster.
      const ExcelJS = await import('exceljs')
      const raw = new ExcelJS.Workbook()
      await raw.xlsx.load(await file.arrayBuffer())
      if (raw.worksheets.length > SHEET_LIMIT.sheets || raw.worksheets.some(s => s.rowCount > SHEET_LIMIT.rows || s.columnCount > SHEET_LIMIT.columns)) {
        throw new Error('This roster has too many sheets, rows or columns. Split it into smaller files.')
      }
      const { xlsxToWorkbook } = await import('./office')
      const book = await xlsxToWorkbook(file)
      for (const sheet of book.sheets) sheet.rows.forEach((row, i) => {
        if (row.some(cell => cell.trim())) blocks.push(`[Sheet: ${sheet.name}, row ${i + 1}]\n${row.join('\t')}`)
      })
    } else {
      const pdfjs = await import('pdfjs-dist')
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
      const bytes = new Uint8Array(await file.arrayBuffer())
      const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
      let needsDocument = false
      const imageOps = new Set(Object.entries(pdfjs.OPS).filter(([name]) => name.startsWith('paint') && name.includes('Image')).map(([, op]) => op))
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i)
          const content = await page.getTextContent()
          if ((await page.getOperatorList()).fnArray.some(op => imageOps.has(op))) needsDocument = true
          const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim()
          if (text) blocks.push(`[Page ${i}]\n${text}`)
          else needsDocument = true
        }
      } finally {
        await doc.destroy()
      }
      if (needsDocument) {
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        pdfBase64 = btoa(binary)
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.message.includes('too many') || err.message === IMAGE_ROSTER_ERROR)) throw err
    throw new Error('That file could not be opened. It may be damaged or locked; upload another copy.', { cause: err })
  }
  const text = blocks.join('\n\n')
  if (text.length > 60000) throw new Error('That roster is over 60,000 characters. Split it into smaller files.')
  if (pdfBase64) return { fileName: file.name, pdfBase64 }
  if (!text.trim()) throw new Error('That roster has no text. Upload a file containing the member names.')
  return { fileName: file.name, text }
}
