import { BugBadge } from '../general/BugBadge'
import { PersonBadge } from '../general/RoleBadge'
import type { GeneralProjectState } from '../general/useGeneralProject'
import { QaActions } from './QaActions'
import { useNow } from '../../hooks/useNow'
import { plural } from '../../lib/plural'
import { stagesOf } from '../../lib/stages'
import { inQa, qaStageIndex, queueOrder, waitedFor } from '../../lib/work/qa'

/**
 * The tasks waiting in the project's QA stage, longest-waiting first. QA and
 * the project manager pass or send back from here; everyone else reads it.
 */
export function QaQueue({ state, onOpenTask }: { state: GeneralProjectState; onOpenTask: (id: string) => void }) {
  const now = useNow()
  const stages = stagesOf(state.project?.stages)
  const stageLabel = stages[qaStageIndex(stages, state.project?.qa_stage)] ?? 'QA'
  const waiting = queueOrder(state.tasks.filter((t) => inQa(t, stages, state.project?.qa_stage)))
  const decides = !state.readOnly && (state.myRole === 'qa' || state.myRole === 'pm')

  return (
    <section className="space-y-3">
      <div>
        <h3>
          QA queue <span className="font-mono text-[13px] font-normal text-faint">{waiting.length}</span>
        </h3>
        <p className="mt-0.5 text-[13px] text-muted">
          {waiting.length} {plural(waiting.length, 'task', 'tasks')} in {stageLabel}, the longest-waiting first.
          {decides ? ' Pass a task to finish it, or send it back with a note.' : ''}
        </p>
      </div>

      {waiting.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
          Nothing is waiting for QA.
        </p>
      ) : (
        <ul className="card divide-y divide-[var(--line)] overflow-hidden shadow-card">
          {waiting.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenTask(t.id)}
                    className="min-w-0 truncate text-left text-[14px] font-medium text-ink hover:underline"
                  >
                    {t.title}
                  </button>
                  <BugBadge kind={t.kind} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                  {t.assignee_ids.length === 0 ? (
                    <span className="text-warning-700 dark:text-warning-300">Nobody holds it</span>
                  ) : (
                    t.assignee_ids.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1.5 text-muted">
                        {state.nameOf(id)}
                        <PersonBadge userId={id} roles={state} />
                      </span>
                    ))
                  )}
                  <span className="font-mono">{waitedFor(t.qa_entered_at, now)}</span>
                </p>
              </div>
              {decides && <QaActions taskId={t.id} title={t.title} onDone={state.reload} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
