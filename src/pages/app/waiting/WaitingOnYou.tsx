import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../../components/app/PageHeader'
import Submissions from '../submissions/Submissions'
import Reassignments from '../reassignments/Reassignments'

/**
 * One place for what a teacher has to answer: hand-ins first, then requests to
 * move stalled work. `?section=reassignments` scrolls to the second.
 */
export default function WaitingOnYou() {
  const [params] = useSearchParams()
  const section = params.get('section')

  useEffect(() => {
    document.title = 'Waiting on you · Collabify'
  }, [])

  useEffect(() => {
    if (section !== 'reassignments') return
    // The lists load after the page does; wait a frame so the anchor is laid out.
    const frame = requestAnimationFrame(() =>
      document.getElementById('reassignments')?.scrollIntoView({ block: 'start' }),
    )
    return () => cancelAnimationFrame(frame)
  }, [section])

  return (
    <div className="w-full">
      <PageHeader
        title="Waiting on you"
        description="Hand-ins to answer and requests to move stalled work, across your classes."
      />
      <div className="space-y-10">
        <section id="hand-ins" aria-labelledby="hand-ins-title" className="scroll-mt-24">
          <h2 id="hand-ins-title" className="mb-4">Hand-ins</h2>
          <Submissions embedded />
        </section>
        <section id="reassignments" aria-labelledby="reassignments-title" className="scroll-mt-24">
          <h2 id="reassignments-title" className="mb-4">Reassignment requests</h2>
          <Reassignments embedded />
        </section>
      </div>
    </div>
  )
}
