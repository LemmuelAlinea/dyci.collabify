import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNow } from '../../hooks/useNow'
import { formatDue } from '../../lib/general/dates'
import type { GeneralMember, GeneralTask } from '../../lib/general/types'
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
  const [basis, setBasis] = useState<TeamBasis>('team_tasks')
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
  const memberRow = (member: GeneralMember, assigned: GeneralTask[], teams?: string[]) => {
    const completion = projectProgress(assigned)
    const name = member.profile ? fullName(member.profile) : 'Unknown member'
    return (
      <details key={member.user_id} className="min-w-0 border-t border-line py-3">
        <summary className="cursor-pointer break-words text-[13px]">
          <span className="font-medium">{name}</span>
          {teams && <span className="ml-2 text-muted">{teams.length ? teams.join(', ') : 'No team'}</span>}
          <span className="mt-2 grid items-center gap-2 sm:grid-cols-[8rem_1fr]">
            <span className="font-mono text-muted">{completion.done} of {completion.total}  /  {completion.pct}%</span>
            <ProgressBar pct={completion.pct} />
          </span>
        </summary>
        {assigned.length ? <ul className="mt-3 space-y-2" aria-label={`${name}'s tasks`}>
          {assigned.map(task => {
            const destination = new URLSearchParams(params)
            destination.set('tab', 'work')
            destination.set('work', 'tasks')
            destination.set('task', task.id)
            destination.delete('milestone')
            return <li key={task.id} className="grid min-w-0 gap-1 rounded-lg surface-sunken p-3 text-[13px] sm:grid-cols-[minmax(0,1fr)_7rem_10rem]">
              <Link to={{ search: destination.toString() }} className="min-w-0 break-words font-medium underline">{task.title}</Link>
              <span className="text-muted">{{ todo: 'To do', in_progress: 'In progress', done: 'Done' }[task.status]}</span>
              <span className="text-muted">{task.due_at ? `Due ${formatDue(task.due_at)}` : 'No due date'}</span>
            </li>
          })}
        </ul> : <p className="mt-3 text-[13px] text-muted">No assigned tasks in this view.</p>}
      </details>
    )
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
      <label className="grid min-w-0 gap-1 text-[13px] text-muted sm:max-w-sm">
        Team task basis
        <select aria-label="Team task basis" value={basis} onChange={event => setBasis(event.target.value as TeamBasis)} className="min-w-0 max-w-full rounded-lg border border-line surface px-3 py-2 text-ink">
          <option value="team_tasks">Team tasks</option>
          <option value="member_tasks">Tasks held by team members</option>
        </select>
      </label>
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
        <p className="text-[12px] text-muted">Weekly completions from currently live, Done tasks over the latest 12 weeks in Asia/Manila. Archived tasks and earlier completions of reopened tasks are absent. Team comparisons use {basis === 'team_tasks' ? 'Team tasks' : 'Tasks held by team members'}; members use all assigned tasks.</p>
      </section>
      <section className="min-w-0 space-y-3">
        <h2>Teams</h2>
        {basis === 'member_tasks' && <p className="text-[13px] text-muted">Tasks can appear in more than one team. Team totals need not add to the project total.</p>}
        {!state.teams.length && <p className="card p-5 text-[13px] text-muted">No teams yet. Members still appear below.</p>}
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          {state.teams.map(team => {
            const ids = state.teamMembers.filter(tm => tm.team_id === team.id).map(tm => tm.user_id)
            const members = state.members.filter(member => ids.includes(member.user_id))
            const matching = teamTasks(tasks, team.id, ids, basis)
            const completion = projectProgress(matching)
            return <article key={team.id} className="card min-w-0 space-y-3 p-5">
              <h3 className="break-words">{team.name}</h3>
              <p className="font-mono text-[13px] text-muted">{completion.done} of {completion.total} tasks done  /  {completion.pct}%</p>
              <ProgressBar pct={completion.pct} />
              {!matching.length && <p className="text-[13px] text-muted">No matching tasks for this team.</p>}
              {!members.length && <p className="text-[13px] text-muted">No team members yet.</p>}
              {members.map(member => memberRow(member, memberTasks(matching, member.user_id)))}
            </article>
          })}
        </div>
      </section>
      <section className="card min-w-0 space-y-3 p-5">
        <h2>All members</h2>
        <p className="text-[13px] text-muted">All live assigned tasks, regardless of the team filter. Expand a member to view tasks.</p>
        {!state.members.length && <p className="text-[13px] text-muted">No project members.</p>}
        {state.members.map(member => memberRow(member, memberTasks(tasks, member.user_id), state.teams.filter(team => state.teamMembers.some(tm => tm.team_id === team.id && tm.user_id === member.user_id)).map(team => team.name)))}
      </section>
    </div>
  )
}
