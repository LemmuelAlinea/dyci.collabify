import { docImageUrls, uploadDocImage } from '../../../lib/api/general'

/** The kinds a .docx can hold as they are; anything else is redrawn as a PNG first. */
const KEPT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

async function asStorable(file: Blob): Promise<{ blob: Blob; ext: string }> {
  const ext = KEPT[file.type]
  if (ext) return { blob: file, ext }
  if (!file.type.startsWith('image/')) throw new Error('That is not a picture. Add a PNG, JPEG or GIF.')
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  const png = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
  if (!png) throw new Error('Could not read that picture. Try a PNG or JPEG.')
  return { blob: png, ext: 'png' }
}

/** Natural size, so a picture lands no wider than the page's text column. */
async function sizeOf(blob: Blob) {
  try {
    const bitmap = await createImageBitmap(blob)
    return { width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

/** Uploads a picture for a document; answers what to insert. */
export async function uploadPicture(projectId: string, file: Blob, columnWidth: number) {
  const { blob, ext } = await asStorable(file)
  const path = await uploadDocImage(projectId, blob, ext)
  const [urls, size] = await Promise.all([docImageUrls([path]), sizeOf(blob)])
  const width = size ? Math.min(size.width, columnWidth) : undefined
  const height = size && width ? Math.round((size.height * width) / size.width) : undefined
  return { src: urls.get(path) ?? '', path, width, height }
}

/** Puts a showable link on every stored picture before the editor reads the HTML. */
export async function withPictureLinks(html: string) {
  if (!html.includes('data-path')) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const imgs = [...doc.querySelectorAll<HTMLImageElement>('img[data-path]')]
  const urls = await docImageUrls([...new Set(imgs.map((i) => i.getAttribute('data-path') as string))]).catch(
    () => new Map<string, string>(),
  )
  for (const img of imgs) {
    const url = urls.get(img.getAttribute('data-path') as string)
    if (url) img.setAttribute('src', url)
  }
  return doc.body.innerHTML
}
