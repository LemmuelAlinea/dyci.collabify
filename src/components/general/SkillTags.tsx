// src/components/general/SkillTags.tsx
import { useState } from 'react'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import { useToast } from '../ui/Toast'
import { addMemberSkill, removeMemberSkill } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { mayEditSkills, normalizeTag, skillProblem } from '../../lib/general/skills'
import type { GeneralMember } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A work project member's skill tags, which Assign by position reads beside
 * positions. Everyone on the project sees them; the person, and whoever manages
 * tasks or structure, add and remove them. QA and stakeholders take no tasks,
 * so they carry none and the row shows nothing.
 */
export function SkillTags({ state, member }: { state: GeneralProjectState; member: GeneralMember }) {
  const { show } = useToast()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const project = state.project
  if (!project || member.role === 'qa' || member.role === 'stakeholder') return null

  const tags = state.skillsOf(member.user_id)
  const name = state.nameOf(member.user_id)
  const editable = mayEditSkills(
    { id: state.viewerId, role: state.myRole, readOnly: state.readOnly, can: state.can },
    { userId: member.user_id, role: member.role },
  )

  async function add() {
    if (!project || busy) return
    const found = skillProblem(tags, draft)
    if (found) return setProblem(found)
    const tag = normalizeTag(draft)
    if (!tag) return
    setBusy(true)
    try {
      await addMemberSkill(project.id, member.user_id, tag)
      setDraft('')
      setProblem(null)
      show('Skill added')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not add that skill. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(tag: string) {
    if (!project || busy) return
    setBusy(true)
    try {
      await removeMemberSkill(project.id, member.user_id, tag)
      setProblem(null)
      show('Skill removed')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not remove that skill. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Its own line in the member row (a flex-wrap item): under the name and
  // indented past the 36px avatar and its gap from sm up, full width on a phone.
  return (
    <div className="basis-full space-y-1.5 sm:pl-[3.25rem]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1 text-faint">Skills</span>
        {tags.length === 0 && <span className="mr-1 text-[12px] text-faint">No skills yet</span>}
        {tags.map((tag) => (
          <span
            key={tag}
            className={`flex max-w-full items-center gap-1 rounded-lg surface-sunken py-1 text-[12px] text-ink ${
              editable ? 'pr-1 pl-2' : 'px-2'
            }`}
          >
            <span className="truncate">{tag}</span>
            {editable && (
              <button
                type="button"
                onClick={() => void remove(tag)}
                disabled={busy}
                aria-label={`Remove skill ${tag}`}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-faint hover:text-ink disabled:opacity-60"
              >
                <Icon name="x" size={11} />
              </button>
            )}
          </span>
        ))}
        {editable && (
          <div className="w-full sm:w-[11rem]">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                if (problem) setProblem(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                }
              }}
              maxLength={60}
              placeholder="Add a skill"
              aria-label={`Add a skill for ${name}`}
              aria-invalid={problem ? true : undefined}
              className="!h-8 !rounded-lg !px-2.5 !text-[12px]"
            />
          </div>
        )}
      </div>
      {problem && (
        <p role="alert" className="flex items-center gap-1.5 text-[12px] text-danger-600 dark:text-danger-400">
          <Icon name="alert" size={13} />
          {problem}
        </p>
      )}
    </div>
  )
}
