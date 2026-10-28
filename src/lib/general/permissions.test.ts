import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  PERMISSIONS,
  ROLE_BADGE,
  ROLE_LABEL,
  ROLE_MATRIX,
  assignableRoles,
  assignableTo,
  can,
  canAs,
  canCreateWorkTask,
  canAssignIncoming,
  canEditTask,
  canGive,
  canRemoveRole,
  canStepDown,
  canStepRank,
  canUnassign,
  inviteRoles,
  levelLabel,
  levelPermissions,
  permissionLabel,
  requestable,
  rolePermissions,
  shareRecipients,
} from './permissions'
import type { ProjectRole, TaskViewer } from './permissions'
import type { GeneralTask } from './types'

describe('work task handoff buttons', () => {
  it('reserves regular creation for planners and allows QA bugs', () => {
    for (const role of ['pm', 'coordinator', 'member', 'qa', 'stakeholder', null] as const) {
      expect(canCreateWorkTask(role, 'task')).toBe(role === 'pm' || role === 'coordinator')
      expect(canCreateWorkTask(role, 'bug')).toBe(role === 'pm' || role === 'coordinator' || role === 'qa')
    }
  })

  it('offers Incoming assignment only for released unassigned work in a led team', () => {
    const task = { routing_state: 'released', team_id: 'a', assignee_ids: [], archived_at: null, status: 'todo' } as unknown as GeneralTask
    expect(canAssignIncoming(['a'], task)).toBe(true)
    expect(canAssignIncoming(['b'], task)).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, routing_state: 'planning' })).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, routing_state: 'coordinator_review' })).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, assignee_ids: ['person'] })).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, archived_at: 'now' })).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, status: 'done' })).toBe(false)
    expect(canAssignIncoming(['a'], { ...task, team_id: null })).toBe(false)
  })
})

/**
 * These mirror `general_can()` in supabase/general.sql. When the two disagree a
 * member is shown a button the database refuses, so every rule here has a
 * matching assertion in supabase/tests/general.test.sql.
 */

describe('levelPermissions', () => {
  it('gives Owners and Managers every permission', () => {
    const all = PERMISSIONS.map((p) => p.value)
    expect(levelPermissions('owner')).toEqual(all)
    expect(levelPermissions('manager')).toEqual(all)
  })

  it('gives a Member none of them', () => {
    expect(levelPermissions('member')).toEqual([])
  })
})

describe('can', () => {
  it('lets a Manager manage tasks', () => {
    expect(can('manager', [], 'manage_tasks')).toBe(true)
  })

  it('refuses a Member without a grant', () => {
    expect(can('member', [], 'edit_files')).toBe(false)
  })

  it('lets a Member with a grant do exactly that', () => {
    expect(can('member', ['edit_files'], 'edit_files')).toBe(true)
    expect(can('member', ['edit_files'], 'manage_tasks')).toBe(false)
  })

  it('refuses somebody who is not a member at all', () => {
    expect(can(null, ['edit_files'], 'edit_files')).toBe(false)
  })

  it('refuses everybody on an archived project', () => {
    expect(can('owner', [], 'edit_project', true)).toBe(false)
  })
})

describe('requestable', () => {
  it('offers a Member everything not granted and not already asked for', () => {
    expect(requestable('member', ['edit_files'], ['manage_tasks'])).toEqual([
      'edit_project',
      'manage_members',
      'manage_structure',
    ])
  })

  it('still lets a class-board Member request Commit to Main', () => {
    expect(requestable('member', [], [], true)).toContain('commit_main')
  })

  it('offers a project manager or Coordinator nothing, because they hold it all', () => {
    expect(requestable('pm', [], [])).toEqual([])
    expect(requestable('coordinator', [], [])).toEqual([])
  })

  it('offers QA and Stakeholder nothing, because they cannot ask', () => {
    expect(requestable('qa', [], [])).toEqual([])
    expect(requestable('stakeholder', [], [])).toEqual([])
  })

  it('offers a non-member nothing', () => {
    expect(requestable(null, [], [])).toEqual([])
  })
})

describe('canStepDown', () => {
  it('stops the last Owner leaving', () => {
    expect(canStepDown('owner', 1)).toBe(false)
    expect(canStepDown('owner', 2)).toBe(true)
  })

  it('never stops a Manager or Member', () => {
    expect(canStepDown('manager', 1)).toBe(true)
    expect(canStepDown('member', 1)).toBe(true)
  })
})

describe('labels', () => {
  it('names every level and permission', () => {
    for (const l of LEVELS) expect(levelLabel(l.value)).toBe(l.label)
    for (const p of PERMISSIONS) expect(permissionLabel(p.value)).toBe(p.label)
  })
})

describe('rolePermissions', () => {
  it('gives the project manager every permission', () => {
    expect(rolePermissions('pm')).toEqual(PERMISSIONS.map((p) => p.value))
  })

  it('gives a Coordinator everything but edit_project', () => {
    const held = rolePermissions('coordinator')
    expect(held).toContain('manage_tasks')
    expect(held).not.toContain('edit_project')
    expect(held).toEqual([
      'manage_members',
      'manage_structure',
      'manage_tasks',
      'edit_files',
      'commit_main',
    ])
  })

  it('lets a work-project Member commit while QA and Stakeholder hold none', () => {
    expect(rolePermissions('member')).toEqual(['commit_main'])
    expect(rolePermissions('qa')).toEqual([])
    expect(rolePermissions('stakeholder')).toEqual([])
  })
})

describe('canAs', () => {
  it('lets a Member do what they were granted and nothing else', () => {
    expect(canAs('member', ['edit_files'], 'edit_files')).toBe(true)
    expect(canAs('member', [], 'commit_main')).toBe(true)
    expect(canAs('member', [], 'manage_tasks')).toBe(false)
  })

  it('refuses somebody with no role', () => {
    expect(canAs(null, ['edit_files'], 'edit_files')).toBe(false)
  })

  it('lets a Coordinator manage tasks but not edit the project', () => {
    expect(canAs('coordinator', [], 'manage_tasks')).toBe(true)
    expect(canAs('coordinator', [], 'edit_project')).toBe(false)
  })

  it('lets the project manager do everything', () => {
    for (const p of PERMISSIONS) expect(canAs('pm', [], p.value)).toBe(true)
  })

  it('holds nothing for QA and Stakeholder, grants or not', () => {
    // general_has() in the database ignores their grants, so the UI must too.
    for (const role of ['qa', 'stakeholder'] as const)
      for (const p of PERMISSIONS) expect(canAs(role, [p.value], p.value)).toBe(false)
  })
})

describe('canGive', () => {
  it('lets the project manager give every permission', () => {
    for (const p of PERMISSIONS) expect(canGive('pm', p.value)).toBe(true)
  })

  it('lets a Coordinator give what it holds, so not Edit project details', () => {
    for (const p of PERMISSIONS)
      expect(canGive('coordinator', p.value)).toBe(p.value !== 'edit_project')
  })

  it('gives everybody else nothing to give, grants or not', () => {
    for (const role of [null, 'member', 'qa', 'stakeholder'] as const)
      for (const p of PERMISSIONS) expect(canGive(role, p.value)).toBe(false)
  })
})

describe('canRemoveRole', () => {
  it('never offers to remove the project manager', () => {
    for (const actor of ['pm', 'coordinator', 'member'] as const)
      expect(canRemoveRole(actor, 'pm')).toBe(false)
  })

  it('leaves Coordinators to the project manager, even for a Member with a grant', () => {
    expect(canRemoveRole('pm', 'coordinator')).toBe(true)
    expect(canRemoveRole('coordinator', 'coordinator')).toBe(false)
    expect(canRemoveRole('member', 'coordinator')).toBe(false)
  })

  it('lets anyone who may manage members remove a Member', () => {
    for (const actor of ['pm', 'coordinator', 'member'] as const)
      expect(canRemoveRole(actor, 'member')).toBe(true)
  })

  it('offers nothing to somebody with no role', () => {
    expect(canRemoveRole(null, 'member')).toBe(false)
  })
})

describe('assignableRoles', () => {
  it('lets the project manager switch anyone else between Coordinator, Member, QA and Stakeholder', () => {
    const all = ['coordinator', 'member', 'qa', 'stakeholder']
    expect(assignableRoles('pm', 'member')).toEqual(all)
    expect(assignableRoles('pm', 'coordinator')).toEqual(all)
    expect(assignableRoles('pm', 'qa')).toEqual(all)
    expect(assignableRoles('pm', 'stakeholder')).toEqual(all)
  })

  it('gives nobody a role change for the project manager', () => {
    expect(assignableRoles('pm', 'pm')).toEqual([])
    expect(assignableRoles('coordinator', 'pm')).toEqual([])
  })

  it('lets a Coordinator move a Member, QA or Stakeholder among those three, and nobody else', () => {
    const three = ['member', 'qa', 'stakeholder']
    expect(assignableRoles('coordinator', 'member')).toEqual(three)
    expect(assignableRoles('coordinator', 'qa')).toEqual(three)
    expect(assignableRoles('coordinator', 'stakeholder')).toEqual(three)
    expect(assignableRoles('coordinator', 'coordinator')).toEqual([])
  })

  it('gives Members, QA and Stakeholders nothing', () => {
    expect(assignableRoles('member', 'member')).toEqual([])
    expect(assignableRoles('qa', 'member')).toEqual([])
    expect(assignableRoles('stakeholder', 'member')).toEqual([])
  })
})

describe('shareRecipients', () => {
  const m = (user_id: string, status = 'active') => ({ user_id, profile: { status } })
  const roles: Record<string, ProjectRole> = { me: 'member', a: 'member', s: 'stakeholder', r: 'member', c: 'coordinator' }
  it('leaves out the sharer, rejected people and Stakeholders', () => {
    const out = shareRecipients([m('me'), m('a'), m('s'), m('r', 'rejected'), m('c')], 'me', (id) => roles[id] ?? null)
    expect(out.map((x) => x.user_id)).toEqual(['a', 'c'])
  })
})

describe('inviteRoles', () => {
  it('lets the project manager invite a Member, Coordinator, QA or Stakeholder', () => {
    expect(inviteRoles('pm')).toEqual(['member', 'coordinator', 'qa', 'stakeholder'])
  })

  it('lets a Coordinator invite a Member, QA or Stakeholder', () => {
    expect(inviteRoles('coordinator')).toEqual(['member', 'qa', 'stakeholder'])
  })

  it('gives everybody else nothing', () => {
    expect(inviteRoles('member')).toEqual([])
    expect(inviteRoles('qa')).toEqual([])
    expect(inviteRoles('stakeholder')).toEqual([])
  })
})

describe('role labels', () => {
  it('names every role, and gives a plain Member no badge', () => {
    expect(ROLE_LABEL).toEqual({
      pm: 'Project manager',
      coordinator: 'Coordinator',
      member: 'Member',
      qa: 'QA',
      stakeholder: 'Stakeholder',
    })
    expect(ROLE_BADGE.member).toBeNull()
    expect(ROLE_BADGE.pm).toBe('PM')
  })
})

describe('ROLE_MATRIX', () => {
  it('lets only the project manager hand over', () => {
    const row = ROLE_MATRIX.find((r) => r.action.includes('Hand over'))
    expect(row?.roles).toEqual({ pm: 'yes' })
  })

  it('agrees with rolePermissions on what a Coordinator may not do', () => {
    const edit = ROLE_MATRIX.find((r) => r.action.startsWith('Edit project details'))
    expect(edit?.roles.coordinator).toBeUndefined()
    expect(canAs('coordinator', [], 'edit_project')).toBe(false)
  })

  it('shows Stakeholders reading and posting in Feedback', () => {
    const see = ROLE_MATRIX[0]
    expect(see.roles.stakeholder).toBe('read')
    expect(ROLE_MATRIX.find((r) => r.action === 'Post in Feedback')?.roles.stakeholder).toBe('yes')
  })
})

describe('ROLE_MATRIX grants and requests', () => {
  it('shows the project manager and Coordinator giving grants, and nobody else', () => {
    const give = ROLE_MATRIX.find((r) => r.action === 'Give grants and answer access requests')
    expect(give?.roles).toEqual({ pm: 'yes', coordinator: 'yes' })
  })

  it('shows Members and Team leads asking for more access', () => {
    const ask = ROLE_MATRIX.find((r) => r.action === 'Ask for more access')
    expect(ask?.roles).toEqual({ lead: 'yes', member: 'yes' })
  })

  it('has no row left marked as coming later, and Feedback is built', () => {
    expect(ROLE_MATRIX.filter((r) => r.later)).toEqual([])
    const feedback = ROLE_MATRIX.filter((r) => r.action.includes('Feedback'))
    expect(feedback).toHaveLength(3)
    expect(feedback.every((r) => r.later === undefined)).toBe(true)
  })
})

describe('task powers', () => {
  const leads = (ids: string[]) => (id: string) => ids.includes(id)
  const viewer = (over: Partial<TaskViewer> = {}): TaskViewer => ({
    viewerId: 'me',
    manageTasks: false,
    archived: false,
    leadsUser: leads([]),
    ...over,
  })
  const task = (assignee_ids: string[], created_by: string | null = 'someone') => ({ assignee_ids, created_by })

  describe('canEditTask', () => {
    it('lets someone who manages tasks edit anything', () => {
      expect(canEditTask(viewer({ manageTasks: true }), task(['x']))).toBe(true)
    })

    it('lets a holder edit, and the creator while nobody holds it', () => {
      expect(canEditTask(viewer(), task(['me']))).toBe(true)
      expect(canEditTask(viewer(), task([], 'me'))).toBe(true)
      expect(canEditTask(viewer(), task(['x'], 'me'))).toBe(false)
    })

    it('lets a team leader edit a task somebody they lead holds', () => {
      expect(canEditTask(viewer({ leadsUser: leads(['mate']) }), task(['other', 'mate']))).toBe(true)
    })

    it('refuses a leader for tasks held only by people they do not lead, or held by nobody', () => {
      expect(canEditTask(viewer({ leadsUser: leads(['mate']) }), task(['other']))).toBe(false)
      expect(canEditTask(viewer({ leadsUser: leads(['mate']) }), task([]))).toBe(false)
    })

    it('refuses everybody on an archived project', () => {
      expect(canEditTask(viewer({ manageTasks: true, archived: true }), task(['me']))).toBe(false)
    })
  })

  describe('canUnassign', () => {
    it('lets a holder release themselves and a manager take anyone off', () => {
      expect(canUnassign(viewer(), 'me')).toBe(true)
      expect(canUnassign(viewer({ manageTasks: true }), 'x')).toBe(true)
    })

    it('lets a leader take off only people they lead', () => {
      const lead = viewer({ leadsUser: leads(['mate']) })
      expect(canUnassign(lead, 'mate')).toBe(true)
      expect(canUnassign(lead, 'other')).toBe(false)
    })

    it('refuses everybody on an archived project', () => {
      expect(canUnassign(viewer({ archived: true }), 'me')).toBe(false)
    })
  })

  describe('assignableTo', () => {
    const people = ['me', 'mate', 'mate2', 'other']
    const member = (): ProjectRole => 'member'

    it('offers a manager everyone not already on the task', () => {
      expect(assignableTo(viewer({ manageTasks: true }), task(['other']), people, member)).toEqual(['me', 'mate', 'mate2'])
    })

    it('offers a leader only the people they lead, and not themselves, while nobody holds it', () => {
      const lead = viewer({ leadsUser: leads(['me', 'mate', 'mate2']) })
      expect(assignableTo(lead, task([]), people, member)).toEqual(['mate', 'mate2'])
    })

    it('offers a leader nobody once the task is held, since a second holder is refused', () => {
      const lead = viewer({ leadsUser: leads(['mate', 'mate2']) })
      expect(assignableTo(lead, task(['mate']), people, member)).toEqual([])
    })

    it('offers a plain member nobody', () => {
      expect(assignableTo(viewer(), task([]), people, member)).toEqual([])
    })

    it('offers nobody on an archived project', () => {
      expect(assignableTo(viewer({ manageTasks: true, archived: true }), task([]), people, member)).toEqual([])
    })

    it('never offers a stakeholder, to a manager or a leader', () => {
      const roleOf = (id: string): ProjectRole => (id === 'mate2' ? 'stakeholder' : 'member')
      expect(assignableTo(viewer({ manageTasks: true }), task([]), people, roleOf)).toEqual(['me', 'mate', 'other'])
      const lead = viewer({ leadsUser: leads(['mate', 'mate2']) })
      expect(assignableTo(lead, task([]), people, roleOf)).toEqual(['mate'])
    })

    it('never offers QA, who holds no tasks', () => {
      const roleOf = (id: string): ProjectRole => (id === 'mate2' ? 'qa' : 'member')
      expect(assignableTo(viewer({ manageTasks: true }), task([]), people, roleOf)).toEqual(['me', 'mate', 'other'])
      const lead = viewer({ leadsUser: leads(['mate', 'mate2']) })
      expect(assignableTo(lead, task([]), people, roleOf)).toEqual(['mate'])
    })
  })

  describe('canStepRank', () => {
    it('lets planners reorder anything', () => {
      expect(canStepRank(true, [], leads([]))).toBe(true)
    })

    it('lets a leader reorder tasks somebody they lead holds, and nothing else', () => {
      expect(canStepRank(false, ['mate'], leads(['mate']))).toBe(true)
      expect(canStepRank(false, ['other'], leads(['mate']))).toBe(false)
      expect(canStepRank(false, undefined, leads(['mate']))).toBe(false)
    })
  })
})

describe('work receiving-team assignments', () => {
  const viewer: TaskViewer = { viewerId: 'lead', manageTasks: false, archived: false, leadsUser: () => true,
    workAssignment: { ledTeamIds: ['a', 'b'], members: [
      { team_id: 'a', user_id: 'lead' }, { team_id: 'a', user_id: 'a1' }, { team_id: 'a', user_id: 'a2' },
      { team_id: 'b', user_id: 'lead' }, { team_id: 'b', user_id: 'b1' },
    ] } }
  const task = { assignee_ids: ['a1'], created_by: 'pm', routing_state: 'released', team_id: 'a' }
  const people = ['lead', 'a1', 'a2', 'b1', 'outsider', 'qa', 'stakeholder']
  const roleOf = (id: string): ProjectRole => id === 'qa' || id === 'stakeholder' ? id : 'member'
  it('allows another holder only from the exact receiving team, including the lead', () => {
    expect(assignableTo(viewer, task, people, roleOf)).toEqual(['lead', 'a2'])
  })
  it('refuses unsent work, stale leadership and leads outside their own team roster', () => {
    expect(assignableTo(viewer, { ...task, routing_state: 'planning' }, people, roleOf)).toEqual([])
    expect(assignableTo({ ...viewer, workAssignment: { ...viewer.workAssignment!, ledTeamIds: ['b'] } }, task, people, roleOf)).toEqual([])
    expect(assignableTo({ ...viewer, workAssignment: { ...viewer.workAssignment!, members: [{ team_id: 'a', user_id: 'a2' }] } }, task, people, roleOf)).toEqual([])
  })
})
