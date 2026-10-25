import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNow } from '../../hooks/useNow'
import { milestoneParams } from '../../lib/general/navigation'
import { projectProgress } from '../../lib/general/progress'
import { liveTasks, memberTasks, statusCounts, teamTasks, weeklyCompletions } from '../../lib/general/projectProgress'
import type { TeamBasis } from '../../lib/general/projectProgress'
import { fullName } from '../../lib/types'
import { milestoneProgress, milestoneStatus, sortMilestones } from '../../lib/work/milestones'
import { CompletionLineChart } from '../charts/CompletionLineChart'
import { DonutChart } from '../charts/DonutChart'
import { ProgressBar } from '../work/MilestoneBits'
import { MilestoneChart } from '../work/MilestoneChart'
import type { GeneralProjectState } from './useGeneralProject'

export function ProgressTab({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const now = useNow()
  const [basis] = useState<TeamBasis>('team_tasks')
  const options = [
    ...state.teams.map(team => ({ value: `team:${team.id}`, label: `Team: ${team.name}`, tasks: teamTasks(state.tasks, team.id, state.teamMembers.filter(tm => tm.team_id === team.id).map(tm => tm.user_id), basis) })),
    ...state.members.map(member => ({ value: `member:${member.user_id}`, label: `Member: ${member.profile ? fullName(member.profile) : 'Unknown member'}`, tasks: memberTasks(state.tasks, member.user_id) })),
  ]
  const [selection, setSelection] = useState(options[0]?.value ?? '')
  const selected = options.find(option => option.value === selection) ?? options[0]
  const tasks = liveTasks(state.tasks)
  const progress = projectProgress(tasks)
  const milestones = sortMilestones(state.milestones)
  const workParams = new URLSearchParams(params)
  workParams.set('tab', 'work')
  workParams.set('work', 'milestones')
  workParams.delete('task')
  workParams.delete('milestone')
  const slices = (items: typeof tasks) => {
    const counts = statusCounts(items)
    return [
      { label: 'To do', value: counts.todo, className: 'stroke-[var(--ink-faint)]', dot: 'bg-pending-ink' },
      { label: 'In progress', value: counts.in_progress, className: 'stroke-warning-500', dot: 'bg-warning-500' },
      { label: 'Done', value: counts.done, className: 'stroke-success-500', dot: 'bg-success-500' },
    ]
  }
  return (
    <div className="min-w-0 space-y-6">
      <section className="space-y-3">
        <h2>Milestones</h2>
        {milestones.length ? <MilestoneChart milestones={milestones} isReached={m => milestoneStatus(m, milestoneProgress(tasks, m.id), now) === 'reached'} onPick={id => setParams(milestoneParams(params, id))} /> : (
          <p className="card p-6 text-[13px] text-muted">No milestones yet. <Link className="font-medium text-ink underline" to={{ search: workParams.toString() }}>View Work milestones</Link></p>
        )}
      </section>
      <section className="card space-y-4 p-5">
        <h2>Project completion</h2>
        <p className="text-[14px] text-muted"><span className="font-mono text-ink">{progress.done} of {progress.total}</span> tasks done · {progress.pct}%</p>
        <ProgressBar pct={progress.pct} />
      </section>
      <section className="card space-y-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2>Completed tasks over time</h2>
          <label className="grid min-w-0 max-w-full gap-1 text-[13px] text-muted">
            Compare with
            <select value={selected?.value ?? ''} onChange={event => setSelection(event.target.value)} className="max-w-full rounded-lg border border-line surface px-3 py-2 text-ink" disabled={!options.length}>
              {!options.length && <option value="">No teams or members</option>}
              {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-3"><h3>Project task status</h3><DonutChart title="Project task status" slices={slices(tasks)} /></div>
          <div className="min-w-0 space-y-3"><h3 className="break-words">{selected?.label ?? 'No selection'}</h3><DonutChart title={`${selected?.label ?? 'No selection'} task status`} slices={slices(selected?.tasks ?? [])} /></div>
        </div>
        <CompletionLineChart weeks={weeklyCompletions(tasks, selected?.tasks ?? [], new Date(now))} selectedLabel={selected?.label ?? 'No selection'} />
        <p className="text-[12px] text-muted">Weekly completions from currently live, Done tasks over the latest 12 weeks in Asia/Manila. Archived tasks and earlier completions of reopened tasks are absent. Team comparisons use Team tasks; members use all assigned tasks.</p>
      </section>
    </div>
  )
}
