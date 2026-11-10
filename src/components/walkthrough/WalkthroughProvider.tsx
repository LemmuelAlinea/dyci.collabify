import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { NO_WALKTHROUGH, WalkthroughContext } from '../../context/walkthrough'
import type { WalkthroughValue } from '../../context/walkthrough'
import { isStakeholderOnly, membershipOf } from '../../lib/access'
import type { ProgressKey } from '../../lib/api/walkthroughs'
import { listMyWalkthroughs, saveWalkthroughs } from '../../lib/api/walkthroughs'
import { ACCOUNT_STEPS, END_CARDS, flowsFor } from '../../lib/walkthrough/flows'
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
type AccountShown = { userId: string; flow: FlowId }

const closed = (map: ProgressMap, flow: ProgressKey) =>
  map[flow]?.status === 'done' || map[flow]?.status === 'skipped'

/** A failure in the walkthrough ends the walkthrough, and only that. */
class WalkthroughBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('The walkthrough stopped.', error)
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Holds the page and the walkthrough apart. `children` sits outside the boundary, so nothing
 * the walkthrough does can take the page down or remount it.
 */
export function WalkthroughProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<WalkthroughValue>(NO_WALKTHROUGH)
  const stop = useCallback(() => setValue(NO_WALKTHROUGH), [])

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      <WalkthroughBoundary onFail={stop}>
        <WalkthroughRun publish={setValue} />
      </WalkthroughBoundary>
    </WalkthroughContext.Provider>
  )
}

/**
 * Runs the first-run walkthroughs for the signed-in person: loads their progress, works
 * out the step to show, walks to its page and lights its target. It never blocks anyone:
 * if progress cannot load nothing shows, and a failed save only warns.
 */
function WalkthroughRun({ publish }: { publish: (value: WalkthroughValue) => void }) {
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
  const [accountShown, setAccountShown] = useState<AccountShown | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  const [closes, setCloses] = useState(0)
  const [settled, setSettled] = useState(0)
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

  // The account steps drop out of the flow once their row closes. The count keeps them for this visit.
  if (userId && run.kind === 'step' && run.step.owner === 'account' && (accountShown?.userId !== userId || accountShown.flow !== run.flow)) {
    setAccountShown({ userId, flow: run.flow })
  }

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
  const latest = useRef({ facts, pathname: location.pathname, step, navigate, reload: navigation.reload })
  useEffect(() => {
    latest.current = { facts, pathname: location.pathname, step, navigate, reload: navigation.reload }
  })
  useEffect(() => {
    const { facts: f, pathname, step: s, navigate: go } = latest.current
    const to = s && f ? s.route(f) : null
    if (to && to !== pathname) go(to)
    // useNavigate changes identity with the path, so it stays out of the keys.
  }, [stepKey])

  // A paused person has no card but can still join through a dialog, so dialogs stay watched.
  const { box, dialogOpen, missing } = useTargetBox(step?.targets ?? [], step !== null || run.kind === 'paused')

  // Counted during render so the card never paints between the dialog closing and the hold starting.
  if (wasOpen !== dialogOpen) {
    setWasOpen(dialogOpen)
    if (wasOpen) setCloses((n) => n + 1)
  }

  // A dialog closes only after its write, so the lists reload at once and data-finished steps advance.
  useEffect(() => {
    if (closes === 0) return
    Promise.resolve(latest.current.reload())
      .catch((error) => console.warn('Navigation did not reload.', error))
      .finally(() => setSettled((n) => Math.max(n, closes)))
  }, [closes])
  const reloading = closes !== settled

  const startReplay = useCallback(() => {
    if (!facts) return
    const steps = replaySteps(facts)
    if (steps.length > 0) setReplay({ steps, index: 0 })
  }, [facts])
  const canReplay = facts !== null && replaySteps(facts).length > 0
  const value = useMemo(() => ({ canReplay, startReplay }), [canReplay, startReplay])
  useEffect(() => publish(value), [publish, value])

  const leave = (make: (p: ProgressMap, flow: FlowId) => Change) => {
    if (!progress || run.kind !== 'step' || !facts || !opened) return
    const change = make(progress, run.flow)
    const another = flowsFor(facts).some(
      (id) => id !== run.flow && opened.flows.has(id) && !closed(change.progress, id),
    )
    if (another) setHeld(true)
    commit(change)
  }
  const skip = () => leave(markSkipped)
  const pause = () => leave(markPaused)

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
        stepId={replayStep.id}
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
  } else if (run.kind === 'step' && progress && facts && !dialogOpen && !reloading && (box || missing)) {
    const { step: s, flow } = run
    const to = s.route(facts)
    const actions: { label: string; onPress: () => void; primary?: boolean }[] = [
      { label: 'Skip', onPress: skip },
    ]
    // A step with a button can always finish with it, wherever the person has gone.
    if (missing && to && to !== location.pathname && !s.press) {
      actions.push({ label: 'Take me there', onPress: () => navigate(to) })
    }
    if (s.pauseLabel) actions.push({ label: s.pauseLabel, onPress: pause })
    if (s.press) {
      actions.push({
        label: s.press,
        primary: true,
        onPress: () => commit(markStep(progress, s)),
      })
    }
    const counted = accountShown?.userId === userId && accountShown.flow === flow && closed(progress, 'account')
    const dropped = counted ? ACCOUNT_STEPS.length : 0
    card = (
      <Spotlight
        title={s.title}
        body={s.body}
        eyebrow={`Step ${run.index + dropped} of ${run.total + dropped}`}
        box={box}
        blockTarget={false}
        stepId={s.id}
        actions={actions}
      />
    )
  }

  return card
}
