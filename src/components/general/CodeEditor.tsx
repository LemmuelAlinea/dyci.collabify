import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { codeLanguage } from '../../lib/general/codeLanguage'
import { monaco } from '../../lib/general/monacoSetup'
import { findSyntaxErrors } from '../../lib/general/syntaxErrors'
import { Icon } from '../ui/Icon'

type Problem = { line: number; column: number; message: string; error: boolean }

/**
 * A code file, in VS Code's own editor.
 *
 * Colours, the minimap, find (Ctrl+F), multiple cursors and bracket matching
 * are Monaco's. Errors come from Monaco's checkers for TypeScript, JavaScript,
 * JSON, CSS and HTML, and from a Lezer grammar for Python, Java, C and C++,
 * PHP, Rust and Go (`syntaxErrors.ts`). The status bar counts them; clicking
 * the count lists them, and each one jumps to its line.
 *
 * The editor owns the text once it opens: `value` is read once, and every
 * change goes out through `onChange`.
 */
export default function CodeEditor({
  path,
  value,
  onChange,
  onSave,
  readOnly = false,
  fill = false,
}: {
  path: string
  value: string
  onChange: (text: string) => void
  /** Ctrl+S / Cmd+S. */
  onSave?: () => void
  readOnly?: boolean
  fill?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { resolved } = useTheme()
  const language = codeLanguage(path)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [problems, setProblems] = useState<Problem[]>([])
  const [listOpen, setListOpen] = useState(false)

  // The latest callbacks, read by listeners made once.
  const latest = useRef({ onChange, onSave })
  useEffect(() => {
    latest.current = { onChange, onSave }
  })

  useEffect(() => {
    const el = host.current
    if (!el) return
    const uri = monaco.Uri.file(path.startsWith('/') ? path : `/${path}`)
    monaco.editor.getModel(uri)?.dispose()
    const model = monaco.editor.createModel(value, language.monaco, uri)
    const editor = monaco.editor.create(el, {
      model,
      readOnly,
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 20,
      tabSize: 2,
      // On a phone the minimap takes a quarter of the width for little use.
      minimap: { enabled: window.innerWidth >= 640 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      stickyScroll: { enabled: true },
      // Hovers and suggestions escape the dialog's clipping instead of being cut off.
      fixedOverflowWidgets: true,
      padding: { top: 8 },
    })
    editorRef.current = editor

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave?.())

    const readMarkers = () =>
      setProblems(
        monaco.editor
          .getModelMarkers({ resource: uri })
          .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
          .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
          .map((m) => ({
            line: m.startLineNumber,
            column: m.startColumn,
            message: m.message,
            error: m.severity === monaco.MarkerSeverity.Error,
          })),
      )

    // Languages Monaco only colours get their syntax checked here, a moment after typing stops.
    let timer: ReturnType<typeof setTimeout> | undefined
    let run = 0
    const check = () => {
      const grammar = language.grammar
      if (!grammar) return
      const mine = ++run
      void findSyntaxErrors(model.getValue(), grammar)
        .then((found) => {
          if (mine !== run || model.isDisposed()) return
          monaco.editor.setModelMarkers(
            model,
            'syntax',
            found.map((p) => {
              const start = model.getPositionAt(p.from)
              const end = model.getPositionAt(Math.max(p.to, p.from + 1))
              const sameSpot = end.lineNumber === start.lineNumber && end.column <= start.column
              return {
                severity: monaco.MarkerSeverity.Error,
                message: p.message,
                startLineNumber: start.lineNumber,
                startColumn: start.column,
                endLineNumber: end.lineNumber,
                endColumn: sameSpot ? start.column + 1 : end.column,
              }
            }),
          )
        })
        .catch(() => {})
    }
    check()

    const subs = [
      model.onDidChangeContent(() => {
        latest.current.onChange(model.getValue())
        clearTimeout(timer)
        timer = setTimeout(check, 300)
      }),
      editor.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, column: e.position.column })),
      monaco.editor.onDidChangeMarkers((uris) => {
        if (uris.some((u) => u.toString() === uri.toString())) readMarkers()
      }),
    ]

    return () => {
      clearTimeout(timer)
      subs.forEach((s) => s.dispose())
      editor.dispose()
      model.dispose()
      editorRef.current = null
    }
    // The editor is made once per file; `value` is only its starting text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    monaco.editor.setTheme(resolved === 'dark' ? 'vs-dark' : 'vs')
  }, [resolved])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  function jump(p: Problem) {
    const editor = editorRef.current
    if (!editor) return
    editor.revealLineInCenter(p.line)
    editor.setPosition({ lineNumber: p.line, column: p.column })
    editor.focus()
  }

  const errors = problems.filter((p) => p.error).length
  const warnings = problems.length - errors

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line">
      <div
        ref={host}
        role="group"
        aria-label={`${language.label} code`}
        className={fill ? 'h-[calc(100dvh-17rem)] min-h-[16rem]' : 'h-[60vh] min-h-[22rem]'}
      />

      {listOpen && problems.length > 0 && (
        <ul aria-label="Problems" className="max-h-36 overflow-y-auto border-t border-line surface-sunken py-1 text-[12px]">
          {problems.map((p, i) => (
            <li key={`${p.line}:${p.column}:${i}`}>
              <button
                type="button"
                onClick={() => jump(p)}
                className="flex w-full items-start gap-2 px-3 py-1 text-left text-ink hover:bg-[var(--surface)]"
              >
                <Icon
                  name={p.error ? 'x' : 'alert'}
                  size={13}
                  className={`mt-0.5 shrink-0 ${p.error ? 'text-danger-600 dark:text-danger-400' : 'text-warning-600 dark:text-warning-400'}`}
                />
                <span className="min-w-0 flex-1 break-words">{p.message}</span>
                <span className="shrink-0 font-mono text-[11px] text-faint">
                  Ln {p.line}, Col {p.column}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 bg-navy-600 px-3 py-1 font-mono text-[11px] text-white dark:bg-navy-700">
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          disabled={problems.length === 0}
          aria-expanded={listOpen}
          aria-label={`${errors} errors, ${warnings} warnings. Show the list.`}
          className="flex items-center gap-2 rounded px-1 hover:bg-white/15 disabled:hover:bg-transparent"
        >
          <span className="flex items-center gap-1">
            <Icon name="x" size={11} />
            {errors}
          </span>
          <span className="flex items-center gap-1">
            <Icon name="alert" size={11} />
            {warnings}
          </span>
        </button>
        {readOnly && <span>Read only</span>}
        <span className="ml-auto">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span>{language.label}</span>
      </div>
    </div>
  )
}
