import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import Submissions from '../submissions/Submissions'
import Reassignments from '../reassignments/Reassignments'

/**
 * One place for what a teacher has to answer: hand-ins first, then requests to
 * move stalled work. `?section=reassignments` scrolls to the second once both
 * lists have loaded.
 */
export default function WaitingOnYou() {
  const [params] = useSearchParams()
  const section = params.get('section')

  useEffect(() => {
    document.title = 'Waiting on you · Collabify'
  }, [])

  // Each list loads on its own, and the hand-ins above can grow after the
  // requests have; scroll once both have landed, a frame later so they are laid out.
  const [handInsReady, setHandInsReady] = useState(false)
  const [requestsReady, setRequestsReady] = useState(false)
  const onHandInsReady = useCallback(() => setHandInsReady(true), [])
  const onRequestsReady = useCallback(() => setRequestsReady(true), [])
  const scrolled = useRef(false)

  useEffect(() => {
    if (section !== 'reassignments' || scrolled.current || !handInsReady || !requestsReady) return
    const frame = requestAnimationFrame(() => {
      scrolled.current = true
      document.getElementById('reassignments')?.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [section, handInsReady, requestsReady])

  return (
    <div className="w-full">
      <DirectoryHero
        compact
        title="Waiting"
        accent="on you."
        description="Hand-ins to answer and requests to move stalled work, across your classes."
      />
      <div className="mt-8 space-y-10">
        <section id="hand-ins" aria-labelledby="hand-ins-title" className="scroll-mt-24">
          <h2 id="hand-ins-title" className="mb-4">Hand-ins</h2>
          <Submissions embedded onReady={onHandInsReady} />
        </section>
        <section id="reassignments" aria-labelledby="reassignments-title" className="scroll-mt-24">
          <h2 id="reassignments-title" className="mb-4">Reassignment requests</h2>
          <Reassignments embedded onReady={onRequestsReady} />
        </section>
      </div>
    </div>
  )
}
