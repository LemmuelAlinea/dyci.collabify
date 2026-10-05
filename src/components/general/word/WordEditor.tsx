import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { TableKit } from '@tiptap/extension-table'
import { PaginationPlus } from 'tiptap-pagination-plus'
import '@fontsource/carlito/400.css'
import '@fontsource/carlito/700.css'
import '@fontsource/carlito/400-italic.css'
import '@fontsource/caladea/400.css'
import '@fontsource/caladea/700.css'
import '@fontsource/arimo/400.css'
import '@fontsource/arimo/700.css'
import '@fontsource/tinos/400.css'
import '@fontsource/tinos/700.css'
import '@fontsource/tinos/400-italic.css'
import '@fontsource/cousine/400.css'
import { Spinner } from '../../ui/Icon'
import { useToast } from '../../ui/Toast'
import { authErrorMessage } from '../../../lib/authError'
import { PAGE_MARGIN, PAGE_SIZES, readPageSetting, writePageSetting } from '../../../lib/general/wordPage'
import type { PageSizeId } from '../../../lib/general/wordPage'
import { DocImage, PageBreak, ParagraphFormat, ShadedCell, ShadedHeader } from './extensions'
import { uploadPicture, withPictureLinks } from './images'
import { WordRibbon } from './WordRibbon'
import './word.css'

/**
 * A Word file, edited on a page that looks like Word's.
 *
 * Tiptap holds the document; its schema keeps only what the extensions here
 * know, so whatever HTML a file carries — a paste from Word or Google Docs, an
 * old upload — comes out as headings, paragraphs, lists, tables, pictures and
 * styled text, never as markup somebody slipped in. The page is real: white
 * paper at the chosen size, one-inch margins, and text that flows on to the
 * next page (`tiptap-pagination-plus`).
 *
 * `value` is read when the file opens; after that the editor owns the text
 * and sends every change out through `onChange`, page size included.
 */
export default function WordEditor({
  value,
  onChange,
  readOnly = false,
  fill = false,
  projectId,
}: {
  value: string
  onChange: (html: string) => void
  readOnly?: boolean
  fill?: boolean
  /** Where pictures are uploaded. Without it, pictures cannot be added. */
  projectId?: string
}) {
  const [initial] = useState(() => readPageSetting(value))
  const [ready, setReady] = useState<string | null>(null)

  // Stored pictures need fresh links before the editor reads the HTML.
  useEffect(() => {
    let live = true
    withPictureLinks(initial.body)
      .then((html) => live && setReady(html))
      .catch(() => live && setReady(initial.body))
    return () => {
      live = false
    }
  }, [initial.body])

  if (ready === null) {
    return (
      <div className={`flex items-center justify-center gap-2 rounded-xl border border-line surface-sunken text-[13px] text-muted ${fill ? 'h-[calc(100dvh-15rem)]' : 'h-[60vh]'}`}>
        <Spinner size={14} />
        Opening the document…
      </div>
    )
  }
  return (
    <Document
      html={ready}
      startPage={initial.page}
      onChange={onChange}
      readOnly={readOnly}
      fill={fill}
      projectId={projectId}
    />
  )
}

function Document({
  html,
  startPage,
  onChange,
  readOnly,
  fill,
  projectId,
}: {
  html: string
  startPage: PageSizeId
  onChange: (html: string) => void
  readOnly: boolean
  fill: boolean
  projectId?: string
}) {
  const { show } = useToast()
  const [page, setPage] = useState<PageSizeId>(startPage)
  const [stats, setStats] = useState({ pages: 1, words: 0 })
  const canvas = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [scale, setScale] = useState(1)
  // Phones get Word's mobile view: the text reflows to the screen instead of a shrunken page.
  const [reflow, setReflow] = useState(false)

  const latest = useRef({ onChange, page, projectId })
  useEffect(() => {
    latest.current = { onChange, page, projectId }
  })

  const size = PAGE_SIZES[startPage]
  const columnWidth = () => PAGE_SIZES[latest.current.page].width - PAGE_MARGIN * 2

  async function insertPictures(editor: Editor, files: File[], at?: number) {
    const id = latest.current.projectId
    if (!id) return show('Pictures can be added once the file is in a project.', 'error')
    for (const file of files) {
      try {
        const pic = await uploadPicture(id, file, columnWidth())
        const content = { type: 'image', attrs: pic }
        if (at !== undefined) editor.chain().focus().insertContentAt(at, content).run()
        else editor.chain().focus().insertContent(content).run()
      } catch (err) {
        show(authErrorMessage(err, `Could not add ${file.name || 'that picture'}. Try again.`), 'error')
      }
    }
  }

  const editor = useEditor({
    editable: !readOnly,
    content: html,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false, link: { openOnClick: false } }),
      TextStyleKit.configure({ lineHeight: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      Highlight.configure({ multicolor: true }),
      TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
      ShadedCell,
      ShadedHeader,
      ParagraphFormat,
      PageBreak,
      DocImage,
      PaginationPlus.configure({
        pageHeight: size.height,
        pageWidth: size.width,
        pageGap: 24,
        pageGapBorderSize: 1,
        pageGapBorderColor: 'var(--paper-line)',
        pageBreakBackground: 'var(--surface-sunken)',
        marginTop: PAGE_MARGIN,
        marginBottom: PAGE_MARGIN,
        marginLeft: PAGE_MARGIN,
        marginRight: PAGE_MARGIN,
        contentMarginTop: 0,
        contentMarginBottom: 0,
        headerLeft: '',
        headerRight: '',
        footerLeft: '',
        footerRight: '',
      }),
    ],
    editorProps: {
      attributes: { class: 'word-paper', 'aria-label': 'The document', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (files.length === 0 || !editorRef.current) return false
        void insertPictures(editorRef.current, files)
        return true
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (files.length === 0 || !editorRef.current) return false
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertPictures(editorRef.current, files, at)
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      latest.current.onChange(writePageSetting(latest.current.page, e.getHTML()))
    },
  })
  const editorRef = useRef<Editor | null>(null)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // A page break fills whatever is left of its page, so what follows starts a new one.
  useEffect(() => {
    if (!editor) return
    let frame = 0
    const fit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const root = editor.view.dom as HTMLElement
        const ratio = root.getBoundingClientRect().height / (root.offsetHeight || 1) || 1
        for (const pb of root.querySelectorAll<HTMLElement>('.word-page-break')) {
          const top = pb.getBoundingClientRect().top
          const bottomOfPage = [...root.querySelectorAll<HTMLElement>('.rm-page-break .breaker')]
            .map((b) => b.getBoundingClientRect().top)
            .find((t) => t > top + 1)
          if (bottomOfPage === undefined) continue
          const want = Math.max(20, Math.floor((bottomOfPage - top) / ratio) - 1)
          if (Math.abs(pb.offsetHeight - want) > 1) pb.style.height = `${want}px`
        }
        const pages = root.querySelectorAll('.rm-page-break').length
        const words = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ').split(/\s+/).filter(Boolean).length
        setStats((s) => (s.pages === pages && s.words === words ? s : { pages: Math.max(1, pages), words }))
      })
    }
    fit()
    editor.on('update', fit)
    const observer = new ResizeObserver(fit)
    observer.observe(editor.view.dom)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('update', fit)
      observer.disconnect()
    }
  }, [editor])

  // On a screen narrower than the paper, the whole page shrinks to fit, as in Word's "fit to width".
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const measure = () => {
      setReflow(el.clientWidth < 560)
      setScale(Math.min(1, (el.clientWidth - 24) / PAGE_SIZES[page].width))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [page])

  useEffect(() => {
    if (!editor) return
    if (reflow) editor.commands.disablePagination()
    else editor.commands.enablePagination()
  }, [editor, reflow])

  function changePage(next: PageSizeId) {
    if (!editor) return
    setPage(next)
    latest.current.page = next
    const s = PAGE_SIZES[next]
    editor.chain().updatePageSize({ pageHeight: s.height, pageWidth: s.width, marginTop: PAGE_MARGIN, marginBottom: PAGE_MARGIN, marginLeft: PAGE_MARGIN, marginRight: PAGE_MARGIN }).run()
    onChange(writePageSetting(next, editor.getHTML()))
  }

  if (!editor) return null

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line">
      {!readOnly && (
        <WordRibbon editor={editor} page={page} onPage={changePage} onPicture={() => pick.current?.click()} />
      )}
      <input
        ref={pick}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void insertPictures(editor, files)
        }}
      />
      <div
        ref={canvas}
        className={`word-canvas overflow-auto surface-sunken ${reflow ? 'word-reflow' : ''} ${fill ? 'h-[calc(100dvh-19rem)] min-h-[16rem]' : 'h-[62vh] min-h-[22rem]'}`}
      >
        <div className={reflow ? 'p-2' : 'word-zoom mx-auto w-fit py-4'} style={reflow ? undefined : { zoom: scale }}>
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-line surface px-3 py-1 text-[11px] text-muted">
        {!reflow && <span>{stats.pages === 1 ? '1 page' : `${stats.pages} pages`}</span>}
        <span>{stats.words === 1 ? '1 word' : `${stats.words.toLocaleString()} words`}</span>
        <span className="ml-auto">{PAGE_SIZES[page].label}</span>
        {reflow ? <span>Mobile view</span> : scale < 1 && <span>{Math.round(scale * 100)}%</span>}
      </div>
    </div>
  )
}
