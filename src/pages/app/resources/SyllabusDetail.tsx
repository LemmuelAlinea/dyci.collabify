import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { useToast } from '../../../components/ui/Toast'
import { WeekEditor } from '../../../components/syllabus/WeekEditor'
import {
  getResource,
  listWeeks,
  parseSyllabus,
  setParseStatus,
} from '../../../lib/api/syllabus'
import { authErrorMessage } from '../../../lib/authError'
import { PARSE_STATUS_LABEL } from '../../../lib/types'
import type { SyllabusWeek, TeachingResource } from '../../../lib/types'

const TONE = {
  unparsed: 'info',
  parsing: 'info',
  draft: 'info',
  verified: 'success',
  failed: 'error',
} as const

export default function SyllabusDetail() {
  const { resourceId = '' } = useParams()
  const { show } = useToast()

  const [resource, setResource] = useState<TeachingResource | null>(null)
  const [weeks, setWeeks] = useState<SyllabusWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [reparse, setReparse] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([getResource(resourceId), listWeeks(resourceId)])
      setResource(r)
      setWeeks(w)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that syllabus.'))
    } finally {
      setLoading(false)
    }
  }, [resourceId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['teaching_resources', 'syllabus_weeks'])

  useEffect(() => {
    if (resource) document.title = `${resource.title} · Collabify`
  }, [resource])

  async function runParse() {
    setParsing(true)
    try {
      const res = await parseSyllabus(resourceId)
      if (res.result === 'ok') {
        show(`Read ${res.weeks ?? 0} weeks — check them over`)
      } else {
        show(res.message ?? 'The file could not be read. Add the weeks by hand.', 'error')
      }
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'The file could not be read. Add the weeks by hand.'), 'error')
      await load()
    } finally {
      setParsing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
        <Spinner size={16} />
        Loading syllabus…
      </div>
    )
  }

  if (!resource) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error">{error ?? 'That syllabus could not be found.'}</Alert>
      </div>
    )
  }

  const status = resource.parse_status ?? 'unparsed'

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <Link
        to="/professor/syllabi"
        className="inline-flex items-center gap-1.5 text-[13.5px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All syllabi
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-amber-500 dark:text-amber-300">Syllabus</p>
          <h1 className="mt-2 text-[clamp(1.6rem,3vw,2.2rem)] leading-tight">{resource.title}</h1>
          <p className="mt-1.5 text-[13.5px] text-muted">{resource.file_name}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="!rounded-xl"
            loading={parsing}
            onClick={() => (weeks.length > 0 ? setReparse(true) : runParse())}
          >
            <Icon name="spark" size={16} />
            {weeks.length > 0 ? 'Read again' : 'Read with AI'}
          </Button>

          {status !== 'verified' && weeks.length > 0 && (
            <Button
              className="!rounded-xl"
              onClick={async () => {
                await setParseStatus(resourceId, 'verified')
                show('Syllabus marked verified')
                await load()
              }}
            >
              <Icon name="checkCircle" size={16} />
              Mark verified
            </Button>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <Alert tone={TONE[status]}>
          <strong>{PARSE_STATUS_LABEL[status]}.</strong>{' '}
          {status === 'verified'
            ? 'Classes using this syllabus read these weeks. You can still edit them at any time.'
            : status === 'draft'
              ? 'These weeks came from reading the file. Check every one, fix what is wrong, then mark it verified.'
              : status === 'failed'
                ? resource.parse_error ||
                  'The file could not be read. Add the weeks by hand — nothing else depends on the parse.'
                : 'Read the file with AI to draft the weeks, or add them by hand.'}
        </Alert>

        <WeekEditor resourceId={resourceId} weeks={weeks} onChanged={load} />
      </div>

      <ConfirmDialog
        open={reparse}
        onClose={() => setReparse(false)}
        onConfirm={runParse}
        title="Read the file again?"
        tone="primary"
        confirmLabel="Read again"
        body={`This replaces all ${weeks.length} weeks with a fresh draft. Anything you have corrected by hand will be lost.`}
      />
    </div>
  )
}
