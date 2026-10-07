/**
 * The text of a file someone uploads to "Tasks from notes": a task list, a
 * sprint plan, minutes. Read in the browser, so only the text goes to the
 * drafting function. Each reader loads the moment a file of its kind is picked.
 */

export const NOTES_FILE_ACCEPT = '.pdf,.docx,.xlsx,.csv,.txt,.md'
/** Megabytes. */
export const NOTES_FILE_MAX = 10
/** What the drafting function reads of the text; the rest is cut. */
export const NOTES_TEXT_MAX = 60000

const ext = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()

/** Lines as the PDF lays them out, page by page. */
async function pdfText(file: File) {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const pages: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
          .join('')
          .trim(),
      )
    }
    return pages.join('\n\n')
  } finally {
    void doc.destroy()
  }
}

async function docxText(file: File) {
  const mammoth = await import('mammoth')
  return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value
}

/** Every sheet as tab-separated rows. */
async function sheetText(file: File) {
  const { xlsxToWorkbook } = await import('./office')
  const book = await xlsxToWorkbook(file)
  return book.sheets.map((s) => `[Sheet: ${s.name}]\n${s.rows.map((r) => r.join('\t')).join('\n')}`).join('\n\n')
}

export class NotesFileError extends Error {}

/** The file's text, or a NotesFileError that says what to do instead. */
export async function readNotesFile(file: File): Promise<{ text: string; cut: boolean }> {
  const kind = ext(file.name)
  if (!NOTES_FILE_ACCEPT.split(',').includes(`.${kind}`)) {
    throw new NotesFileError('That kind of file cannot be read here. Upload a PDF, Word, Excel, CSV or text file.')
  }
  if (file.size > NOTES_FILE_MAX * 1024 * 1024) {
    throw new NotesFileError(`That file is over ${NOTES_FILE_MAX} MB. Upload a smaller one, or paste the tasks instead.`)
  }
  let text: string
  try {
    text =
      kind === 'pdf' ? await pdfText(file) : kind === 'docx' ? await docxText(file) : kind === 'xlsx' ? await sheetText(file) : await file.text()
  } catch {
    throw new NotesFileError('That file could not be opened. It may be damaged or locked; try another copy, or paste the tasks.')
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length < 20) {
    throw new NotesFileError(
      kind === 'pdf'
        ? 'That PDF has no text to read. It may be a scan; paste the tasks instead.'
        : 'That file is empty or nearly so. Upload the one with the tasks in it.',
    )
  }
  return { text: text.slice(0, NOTES_TEXT_MAX), cut: text.length > NOTES_TEXT_MAX }
}
