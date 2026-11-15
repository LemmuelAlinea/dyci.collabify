import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Spinner } from '../ui/Icon'
import { projectFileBlob } from '../../lib/api/general'
import { docxParagraphs } from '../../lib/general/docx/text'
import { DiffView } from './DiffView'

/** A storage path, null (nothing there), or a lookup that gives one. */
type Source = string | null | (() => Promise<string | null>)

async function wordsOf(source: Source) {
  const path = typeof source === 'function' ? await source() : source
  if (!path) return ''
  const blob = await projectFileBlob(path)
  return docxParagraphs(new Uint8Array(await blob.arrayBuffer()))
}

/** What changed between two Word files, by their words. Key it on the versions it compares. */
export function WordDiff({
  before,
  after,
  caption,
}: {
  before: Source
  after: Source
  caption: string
}) {
  const [text, setText] = useState<{ before: string; after: string } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setText(null)
    setFailed(false)
    void Promise.all([wordsOf(before), wordsOf(after)])
      .then(([b, a]) => alive && setText({ before: b, after: a }))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // Runs once per mount: give the component a key that changes with its versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failed) return <Alert tone="error">Could not read one of the versions. Download them to compare in Word.</Alert>
  if (!text) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Spinner size={14} />
        Reading the versions…
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <DiffView before={text.before} after={text.after} caption={caption} />
      <p className="text-[12px] text-muted">Compares the words only. Formatting changes do not show here.</p>
    </div>
  )
}
