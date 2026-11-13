import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { FilterPills } from '../../../components/app/PageHeader'
import { useAuth } from '../../../context/AuthContext'
import { useLive } from '../../../hooks/useLive'
import { teachingWaitingCounts } from '../../../lib/api/waiting'
import Submissions from '../submissions/Submissions'
import Reassignments from '../reassignments/Reassignments'

type View = 'handins' | 'requests'

/**
 * What a teacher has to answer, one list at a time: hand-ins, or requests to
 * move stalled work. The switch carries what waits in each. The choice lives in
 * `?section=reassignments`, which old Reassignments links already use.
 */
export default function WaitingOnYou() {
  const { profile } = useAuth()
  const userId = profile?.id
  const [params, setParams] = useSearchParams()
  const view: View = params.get('section') === 'reassignments' ? 'requests' : 'handins'
  const [counts, setCounts] = useState<{ handIns: number; requests: number } | null>(null)

  useEffect(() => {
    document.title = 'Waiting on you · Collabify'
  }, [])

  const loadCounts = useCallback(async () => {
    if (!userId) return
    try {
      setCounts(await teachingWaitingCounts(userId))
    } catch {
      // The switch keeps its last counts; each list reports its own errors.
    }
  }, [userId])
  useEffect(() => {
    void loadCounts()
  }, [loadCounts])
  useLive(loadCounts, ['project_boards', 'board_results', 'task_reassignments'], { enabled: Boolean(userId) })

  const pick = (next: View) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === 'requests') out.set('section', 'reassignments')
        else out.delete('section')
        return out
      },
      { replace: true },
    )

  return (
    <div className="w-full">
      <DirectoryHero
        compact
        title="Waiting"
        accent="on you."
        description="Hand-ins to answer and requests to move stalled work, across your classes."
      />
      <div className="mt-6">
        <FilterPills<View>
          label="Show"
          options={[
            { value: 'handins', label: 'Hand-ins', count: counts?.handIns },
            { value: 'requests', label: 'Reassignment requests', count: counts?.requests },
          ]}
          value={view}
          onChange={pick}
        />
      </div>
      <div className="mt-6">
        {view === 'handins' ? (
          <section aria-label="Hand-ins">
            <Submissions embedded />
          </section>
        ) : (
          <section aria-label="Reassignment requests">
            <Reassignments embedded />
          </section>
        )}
      </div>
    </div>
  )
}
