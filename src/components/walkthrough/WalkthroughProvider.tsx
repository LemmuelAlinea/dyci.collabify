import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { WalkthroughContext } from '../../context/walkthrough'
import { isStakeholderOnly, membershipOf } from '../../lib/access'
import { listMyWalkthroughs, saveWalkthroughs } from '../../lib/api/walkthroughs'
import { END_CARDS, flowsFor } from '../../lib/walkthrough/flows'
import type { FlowId, StepDef, WalkthroughFacts } from '../../lib/walkthrough/flows'
import {
  markFinished,
  markPaused,
  markSkipped,
  markStep,
  replaySteps,
  resolveRun,
  toMap,
} from '../../lib/walkthrough/progress'
import type { Change, ProgressMap } from '../../lib/walkthrough/progress'
import { Spotlight } from './Spotlight'
import { useTargetBox } from './useTargetBox'

type Loaded = { userId: string; map: ProgressMap }
type Opened = { userId: string; flows: ReadonlySet<FlowId> }
type Replay = { steps: readonly StepDef[]; index: number }
type EndCard = { title: string; body: string }

const closed = (map: ProgressMap, flow: FlowId) =>
  map[flow]?.status === 'done' || map[flow]?.status === 'skipped'

/**
 * Runs the first-run walkthroughs for the signed-in person: loads their progress, works
 * out the step to show, walks to its page and lights its target. It never blocks anyone:
 * if progress cannot load nothing shows, and a failed save only warns.
 */
export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const navigation = useGeneralNavigation()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = profile?.id ?? null

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [held, setHeld] = useState(false)
  const [replay, setReplay] = useState<Replay | null>(null)
  const [endCard, setEndCard] = useState<EndCard | null>(null)
  const shown = useRef(new Set<FlowId>())
  const finishing = useRef(new Set<FlowId>())

  const progress = loaded && loaded.userId === userId ? loaded.map : null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    listMyWalkthroughs()
      .then((rows) => {
        if (!cancelled) setLoaded({ userId, map: toMap(rows) })
      })
      .catch((error) => console.warn('Walkthrough progress did not load.', error))
    return () => {
      cancelled = true
    }
  }, [userId])

  const { spaces, myProjects } = navigation
  const facts = useMemo<WalkthroughFacts | null>(() => {
    if (!profile || !spaces || !myProjects) return null
    const membership = membershipOf(spaces, myProjects)
    return {
      profile,
      stakeholderOnly: isStakeholderOnly(profile, membership),
      inClass: Boolean(membership?.inClass),
      hasWork: Boolean(membership?.hasWork),
      spaces,
    }
  }, [profile, spaces, myProjects])

  // The walkthroughs the person had when the visit began. A switch turned on later waits for the next open.
  if (userId && facts && progress && (!opened || opened.userId !== userId)) {
    setOpened({ userId, flows: new Set(flowsFor(facts)) })
  }

  const run = useMemo(
    () =>
      facts && progress && opened && opened.userId === userId
        ? resolveRun(facts, progress, { openedWith: opened.flows, held })
        : ({ kind: 'none' } as const),
    [facts, progress, opened, userId, held],
  )

  const commit = useCallback(
    (change: Change) => {
      setLoaded((l) => (l && userId ? { userId, map: change.progress } : l))
      if (userId) {
        saveWalkthroughs(userId, change.writes).catch((error) =>
          console.warn('Walkthrough progress did not save.', error),
        )
      }
    },
    [userId],
  )

  const liveStep = run.kind === 'step' ? run.step : null
  const replayStep = replay ? (replay.steps[replay.index] ?? null) : null
  const step = replayStep ?? (endCard ? null : liveStep)

  useEffect(() => {
    if (run.kind === 'step') shown.current.add(run.flow)
  }, [run])

  // A flow whose steps are all done finishes once, whether the person walked it or the data did.
  useEffect(() => {
    if (run.kind !== 'finished' || !progress || replay) return
    if (finishing.current.has(run.flow)) return
    finishing.current.add(run.flow)
    const card = END_CARDS[run.flow]
    if (card && shown.current.has(run.flow)) setEndCard(card)
    commit(markFinished(progress, run.flow))
  }, [run, progress, replay, commit])

  // Walk to the step's page once per step. Never keyed on the path: a create dialog navigates
  // on success before the lists refresh, and a path-keyed effect would pull the person back.
  const stepKey = step ? `${replay ? 'replay' : 'live'}:${step.id}` : null
  const latest = useRef({ facts, pathname: location.pathname, step, navigate })
  useEffect(() => {
    latest.current = { facts, pathname: location.pathname, step, navigate }
  })
  useEffect(() => {
    const { facts: f, pathname, step: s, navigate: go } = latest.current
    const to = s && f ? s.route(f) : null
    if (to && to !== pathname) go(to)
    // useNavigate changes identity with the path, so it stays out of the keys.
  }, [stepKey])

  const showsStep = step !== null
  const { box, dialogOpen, missing } = useTargetBox(step?.targets ?? [], showsStep)

  // A dialog closes only after its write, so the lists reload at once and data-finished steps advance.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !dialogOpen) {
      Promise.resolve(navigation.reload()).catch((error) => console.warn('Navigation did not reload.', error))
    }
    wasOpen.current = dialogOpen
  }, [dialogOpen, navigation])

  const startReplay = useCallback(() => {
    if (!facts) return
    const steps = replaySteps(facts)
    if (steps.length > 0) setReplay({ steps, index: 0 })
  }, [facts])
  const canReplay = facts !== null && replaySteps(facts).length > 0
  const value = useMemo(() => ({ canReplay, startReplay }), [canReplay, startReplay])

  const skip = () => {
    if (!progress || run.kind !== 'step' || !facts || !opened) return
    const change = markSkipped(progress, run.flow)
    const another = flowsFor(facts).some(
      (id) => id !== run.flow && opened.flows.has(id) && !closed(change.progress, id),
    )
    if (another) setHeld(true)
    commit(change)
  }

  let card: ReactNode = null
  if (replay && replayStep) {
    const last = replay.index === replay.steps.length - 1
    card = (
      <Spotlight
        title={replayStep.title}
        body={replayStep.body}
        eyebrow={`Step ${replay.index + 1} of ${replay.steps.length}`}
        box={box}
        blockTarget
        actions={[
          { label: 'Skip', onPress: () => setReplay(null) },
          {
            label: 'Next',
            primary: true,
            onPress: () => setReplay(last ? null : { ...replay, index: replay.index + 1 }),
          },
        ]}
      />
    )
    if (dialogOpen || (!box && !missing)) card = null
  } else if (endCard) {
    card = (
      <Spotlight
        title={endCard.title}
        body={endCard.body}
        eyebrow="All set"
        box={null}
        blockTarget={false}
        actions={[{ label: 'Done', primary: true, onPress: () => setEndCard(null) }]}
      />
    )
  } else if (run.kind === 'step' && progress && facts && !dialogOpen && (box || missing)) {
    const { step: s, flow } = run
    const to = s.route(facts)
    const actions: { label: string; onPress: () => void; primary?: boolean }[] = [
      { label: 'Skip', onPress: skip },
    ]
    if (missing && to && to !== location.pathname) {
      actions.push({ label: 'Take me there', onPress: () => navigate(to) })
    }
    if (s.pauseLabel) actions.push({ label: s.pauseLabel, onPress: () => commit(markPaused(progress, flow)) })
    if (s.press) {
      actions.push({
        label: s.press,
        primary: true,
        onPress: () => commit(markStep(progress, s)),
      })
    }
    card = (
      <Spotlight
        title={s.title}
        body={s.body}
        eyebrow={`Step ${run.index} of ${run.total}`}
        box={box}
        blockTarget={false}
        actions={actions}
      />
    )
  }

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      {card}
    </WalkthroughContext.Provider>
  )
}
