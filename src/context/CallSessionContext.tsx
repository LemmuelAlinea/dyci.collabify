import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { CallChoices } from '../components/meetings/CallPrejoin'
import { Button } from '../components/ui/Button'
import { callAction } from '../lib/api/meetingCall'
import type { CallSession } from '../lib/api/meetingCall'
import { paths } from '../lib/paths'

type ActiveCall = { meetingId: string; title: string; choices: CallChoices; session: CallSession }
type CallContext = {
  active: ActiveCall | null
  restoring: boolean
  issue: string | null
  clearIssue: () => void
  begin: (call: ActiveCall) => void
  leave: () => void
  updateChoices: (choices: CallChoices) => void
  updateMedia: (kind: 'camera' | 'microphone', enabled: boolean) => void
}
const STORAGE_KEY = 'collabify.active-call'
const Context = createContext<CallContext | null>(null)
const CallConnection = lazy(() => import('../components/meetings/CallConnection'))

export function useCallSession() {
  const context = useContext(Context)
  if (!context) throw new Error('CallSessionProvider is missing.')
  return context
}

export function CallSessionProvider({ profileId, children }: { profileId: string | null; children: ReactNode }) {
  const [active, setActive] = useState<ActiveCall | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [issue, setIssue] = useState<string | null>(null)
  const clearIssue = useCallback(() => setIssue(null), [])
  const activeOwner = useRef<string | null>(null)
  const leaving = useRef(false)
  const route = useLocation()

  useEffect(() => {
    if (!profileId) { activeOwner.current = null; setActive(null); setRestoring(false); return }
    let saved: { meetingId: string; title: string; profileId: string; choices: CallChoices } | null = null
    try { saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') }
    catch { try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ } }
    if (!saved?.meetingId || !saved.choices || saved.profileId !== profileId) {
      if (saved) try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
      activeOwner.current = null
      setActive(null)
      setRestoring(false)
      return
    }
    setRestoring(true)
    let cancelled = false
    void callAction('join', saved.meetingId).then((session) => {
      if (!('token' in session)) throw new Error('The call did not return a connection.')
      if (!cancelled && saved) {
        activeOwner.current = profileId
        leaving.current = false
        setActive({ meetingId: saved.meetingId, title: saved.title,
          choices: saved.choices.background === 'photo' && saved.choices.photoUrl?.startsWith('blob:')
            ? { ...saved.choices, photoUrl: '/video/call-background.png' } : saved.choices, session })
      }
    }).catch(() => { if (!cancelled) try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ } })
      .finally(() => { if (!cancelled) setRestoring(false) })
    return () => { cancelled = true }
  }, [profileId])

  useEffect(() => {
    if (!active || !profileId || activeOwner.current !== profileId) return
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ meetingId: active.meetingId, title: active.title, profileId, choices: active.choices })) }
    catch { /* The call still works without session restoration. */ }
  }, [active, profileId])

  useEffect(() => {
    const url = active?.choices.photoUrl
    return () => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url) }
  }, [active?.choices.photoUrl])

  function begin(call: ActiveCall) {
    activeOwner.current = profileId
    leaving.current = false
    setIssue(null)
    if (profileId) try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ meetingId: call.meetingId, title: call.title, profileId, choices: call.choices })) }
    catch { /* The call still works without session restoration. */ }
    setActive(call)
  }
  const leave = useCallback(() => {
    leaving.current = true
    activeOwner.current = null
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* Storage may be disabled. */ }
    setActive(null)
  }, [])
  const handleRoomError = useCallback((error: Error) => { leave(); setIssue(error.message) }, [leave])
  const handleDisconnected = useCallback(() => {
    if (!leaving.current) { leave(); setIssue('The call disconnected. You can try joining again.') }
  }, [leave])
  const handleMediaDeviceFailure = useCallback(() => {
    setIssue('A camera or microphone is unavailable. You can continue without it.')
  }, [])
  function updateChoices(choices: CallChoices) {
    setActive((current) => current ? { ...current, choices } : current)
  }
  function updateMedia(kind: 'camera' | 'microphone', enabled: boolean) {
    setActive((current) => current ? { ...current, choices: { ...current.choices, [kind]: enabled } } : current)
  }

  const content = <>
    {children}
    {active && route.pathname !== paths.meetingCall(active.meetingId) &&
      <div role="status" className="fixed bottom-3 right-3 z-40 flex items-center gap-3 rounded-xl border border-line surface p-3 shadow-lift">
        <span className="max-w-36 truncate text-sm text-ink">In call · {active.title}</span>
        <Link to={paths.meetingCall(active.meetingId)} className="text-sm font-semibold text-ink underline">Return to call</Link>
        <Button variant="danger" size="sm" onClick={leave}>Leave</Button>
      </div>}
  </>
  return <Context.Provider value={{ active, restoring, issue, clearIssue, begin, leave, updateChoices, updateMedia }}>
    {active ? <Suspense fallback={<p className="p-4 text-sm text-muted">Connecting call…</p>}>
      <CallConnection session={active.session} choices={active.choices}
        onError={handleRoomError} onDisconnected={handleDisconnected}
        onMediaDeviceFailure={handleMediaDeviceFailure}
        onIssue={setIssue}>
        {content}
      </CallConnection>
    </Suspense> : content}
  </Context.Provider>
}
