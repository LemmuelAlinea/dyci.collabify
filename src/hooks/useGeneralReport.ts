import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from './useLive'
import {
  reportActivity,
  reportCommits,
  reportHistorySince,
  reportPeople,
  reportReviews,
  reportScope,
  reportSeries,
  reportSummary,
  reportTasks,
  reportTimeLogs,
} from '../lib/api/generalReports'
import type {
  ActivityRow,
  CommitRow,
  PeopleRow,
  ReportArgs,
  ReviewRow,
  ScopeRow,
  SeriesRow,
  SummaryRow,
  TaskRow,
  TimeLogRow,
} from '../lib/api/generalReports'
import { authErrorMessage } from '../lib/authError'
import type { ReportConfig } from '../lib/general/reportConfig'
import { previousPeriod, resolveRange, toUtcBounds, viewerZone } from '../lib/general/reportRange'
import type { DayRange } from '../lib/general/reportRange'

export type ReportData = {
  summary?: SummaryRow[]
  prevSummary?: SummaryRow[]
  series?: SeriesRow[]
  prevSeries?: SeriesRow[]
  people?: PeopleRow[]
  prevPeople?: PeopleRow[]
  activity?: ActivityRow[]
  tasks?: TaskRow[]
  timeLogs?: TimeLogRow[]
  commits?: CommitRow[]
  reviews?: ReviewRow[]
}

export type ReportPart = keyof ReportData

/**
 * Everything one General report needs, fetched from the config in the URL.
 *
 * The space's projects come first, because they decide the date range (a
 * project's duration) and which projects are full reports or the caller's own
 * work. Then only the parts the enabled sections read are fetched, in parallel,
 * 300 ms after the last change — dragging a slider does not fire a request per
 * pixel — and a newer request cancels any still in flight.
 */
export function useGeneralReport(spaceId: string | undefined, config: ReportConfig) {
  const tz = useMemo(() => viewerZone(), [])
  const [scope, setScope] = useState<ScopeRow[] | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [historySince, setHistorySince] = useState<string | null>(null)
  const [data, setData] = useState<ReportData>({})
  const [loading, setLoading] = useState<Set<ReportPart>>(new Set())
  const [errors, setErrors] = useState<Partial<Record<ReportPart, string>>>({})
  const [moreLoading, setMoreLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const [today, setToday] = useState(() => new Date())
  const controller = useRef<AbortController | null>(null)

  const loadScope = useCallback(async () => {
    if (!spaceId) return
    try {
      setScope(await reportScope(spaceId))
      setScopeError(null)
    } catch (err) {
      setScopeError(authErrorMessage(err, 'Could not load the projects in this space.'))
    }
  }, [spaceId])

  useEffect(() => {
    void loadScope()
    reportHistorySince().then(setHistorySince, () => setHistorySince(null))
  }, [loadScope])

  // The projects this report covers, as the database is asked for them.
  const chosen = useMemo(() => {
    if (!scope) return null
    const live = scope.filter((p) => config.includeArchived || !p.archived)
    if (config.projectIds === 'all') return live
    const want = new Set(config.projectIds)
    return live.filter((p) => want.has(p.project_id))
  }, [scope, config.projectIds, config.includeArchived])

  const range: DayRange = useMemo(() => {
    const single = chosen && chosen.length === 1 ? chosen[0] : null
    return resolveRange(config.range.preset, today, single, config.range)
  }, [config.range, chosen, today])
  const prevRange = useMemo(() => previousPeriod(range), [range])

  const args = useMemo<ReportArgs | null>(() => {
    if (!spaceId || !chosen) return null
    const bounds = toUtcBounds(range, tz)
    return {
      spaceId,
      projectIds: config.projectIds === 'all' ? null : chosen.map((p) => p.project_id),
      from: bounds.from,
      to: bounds.to,
      people: config.people,
      teams: config.teams,
      includeArchived: config.includeArchived,
      tz,
    }
  }, [spaceId, chosen, range, tz, config.projectIds, config.people, config.teams, config.includeArchived])

  const prevArgs = useMemo<ReportArgs | null>(() => {
    if (!args) return null
    const b = toUtcBounds(prevRange, tz)
    return { ...args, from: b.from, to: b.to }
  }, [args, prevRange, tz])

  const s = config.sections
  const needs = useMemo(() => {
    const want = new Set<ReportPart>()
    if (s.summary || s.narrative || s.status || s.projectComparison) want.add('summary')
    if (s.progress || s.forecast) want.add('series')
    if (s.people || s.score || s.narrative || s.projectComparison) want.add('people')
    if (s.activity) want.add('activity')
    if (s.tasks) want.add('tasks')
    if (s.timeLogs) want.add('timeLogs')
    if (s.commits) want.add('commits')
    if (s.reviews || s.narrative) want.add('reviews')
    if (config.compare) {
      if (want.has('summary')) want.add('prevSummary')
      if (want.has('series')) want.add('prevSeries')
      if (want.has('people')) want.add('prevPeople')
    }
    return want
  }, [s, config.compare])

  const kindsKey = config.activityKinds.join(',')

  useEffect(() => {
    if (!args || !prevArgs) return
    const handle = window.setTimeout(() => {
      controller.current?.abort()
      const ctrl = new AbortController()
      controller.current = ctrl
      const { signal } = ctrl
      const kinds = kindsKey ? kindsKey.split(',') : []

      const jobs: [ReportPart, () => Promise<unknown>][] = []
      for (const part of needs) {
        switch (part) {
          case 'summary': jobs.push([part, () => reportSummary(args, signal)]); break
          case 'prevSummary': jobs.push([part, () => reportSummary(prevArgs, signal)]); break
          case 'series': jobs.push([part, () => reportSeries(args, signal)]); break
          case 'prevSeries': jobs.push([part, () => reportSeries(prevArgs, signal)]); break
          case 'people': jobs.push([part, () => reportPeople(args, signal)]); break
          case 'prevPeople': jobs.push([part, () => reportPeople(prevArgs, signal)]); break
          case 'activity': jobs.push([part, () => reportActivity(args, { kinds }, signal)]); break
          case 'tasks': jobs.push([part, () => reportTasks(args, signal)]); break
          case 'timeLogs': jobs.push([part, () => reportTimeLogs(args, signal)]); break
          case 'commits': jobs.push([part, () => reportCommits(args, signal)]); break
          case 'reviews': jobs.push([part, () => reportReviews(args, signal)]); break
        }
      }

      setLoading(new Set(jobs.map(([p]) => p)))
      for (const [part, run] of jobs) {
        run().then(
          (rows) => {
            if (signal.aborted) return
            setData((d) => ({ ...d, [part]: rows }))
            setErrors((e) => ({ ...e, [part]: undefined }))
            setLoading((l) => {
              const next = new Set(l)
              next.delete(part)
              return next
            })
          },
          (err) => {
            if (signal.aborted) return
            setErrors((e) => ({ ...e, [part]: authErrorMessage(err, 'Try again.') }))
            setLoading((l) => {
              const next = new Set(l)
              next.delete(part)
              return next
            })
          },
        )
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [args, prevArgs, needs, kindsKey, tick])

  useEffect(() => () => controller.current?.abort(), [])

  const refresh = useCallback(async () => {
    setToday(new Date())
    await loadScope()
    setTick((t) => t + 1)
  }, [loadScope])

  useLive(refresh, ['general_tasks', 'general_task_events', 'general_commits', 'general_repo_changes'], {
    every: 120_000,
  })

  const loadMoreActivity = useCallback(async () => {
    const rows = data.activity
    if (!args || !rows || rows.length === 0) return
    const last = rows[rows.length - 1]
    setMoreLoading(true)
    try {
      const more = await reportActivity(args, {
        kinds: kindsKey ? kindsKey.split(',') : [],
        before: { at: last.at, id: last.id },
      })
      setData((d) => ({ ...d, activity: [...(d.activity ?? []), ...more] }))
    } catch (err) {
      setErrors((e) => ({ ...e, activity: authErrorMessage(err, 'Try again.') }))
    } finally {
      setMoreLoading(false)
    }
  }, [args, data.activity, kindsKey])

  return {
    scope,
    scopeError,
    chosen,
    range,
    prevRange,
    tz,
    today,
    historySince,
    data,
    loading,
    errors,
    moreLoading,
    loadMoreActivity,
    reload: refresh,
  }
}
