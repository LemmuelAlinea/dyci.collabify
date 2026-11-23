import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { handBackCover, keepCover, taskCover, type TaskCoverRow } from '../../lib/api/workload'
import { authErrorMessage } from '../../lib/authError'
import { formatDayLabel } from '../../lib/work/hours'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A task's open cover: who holds it for whom and until when. The cover and the
 * project's planners hand it back or keep it with the cover.
 */
export function TaskCover({ taskId, state }: { taskId: string; state: GeneralProjectState }) {
  const { show } = useToast()
  const [cover, setCover] = useState<TaskCoverRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setCover(await taskCover(taskId))
    } catch {
      setCover(null)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  if (!cover) return null
  const away = state.nameOf(cover.away_id)
  const by = state.nameOf(cover.cover_id)
  const acts = !state.readOnly
    && (state.viewerId === cover.cover_id || state.myRole === 'pm' || state.myRole === 'coordinator')

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      show(done)
      await Promise.all([load(), state.reload()])
    } catch (err) {
      setError(authErrorMessage(err, 'That change could not be saved. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 text-[13px] dark:border-warning-400/40 dark:bg-warning-500/10">
      <p className="flex items-center gap-2 text-ink">
        <Icon name="users" size={15} className="shrink-0 text-warning-700 dark:text-warning-300" />
        {by} is covering for {away} until {formatDayLabel(cover.until)}
      </p>
      {acts && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => handBackCover(cover.id), `Handed back to ${away}`)}>
            Hand back to {away}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => keepCover(cover.id), `Kept with ${by}`)}>
            Keep with {by}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-[12px] text-danger-600 dark:text-danger-400">{error}</p>}
    </div>
  )
}
