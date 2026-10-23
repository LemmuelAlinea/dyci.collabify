import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  PERMISSIONS,
  ROLE_BADGE,
  ROLE_LABEL,
  ROLE_MATRIX,
  assignableRoles,
  can,
  canAs,
  canStepDown,
  levelLabel,
  levelPermissions,
  permissionLabel,
  requestable,
  rolePermissions,
} from './permissions'

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
      'commit_main',
    ])
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

  it('gives a Member, QA and Stakeholder none', () => {
    expect(rolePermissions('member')).toEqual([])
    expect(rolePermissions('qa')).toEqual([])
    expect(rolePermissions('stakeholder')).toEqual([])
  })
})

describe('canAs', () => {
  it('lets a Member do what they were granted and nothing else', () => {
    expect(canAs('member', ['edit_files'], 'edit_files')).toBe(true)
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

describe('assignableRoles', () => {
  it('lets the project manager switch anyone else between Coordinator and Member', () => {
    expect(assignableRoles('pm', 'member')).toEqual(['coordinator', 'member'])
    expect(assignableRoles('pm', 'coordinator')).toEqual(['coordinator', 'member'])
  })

  it('gives nobody a role change for the project manager', () => {
    expect(assignableRoles('pm', 'pm')).toEqual([])
    expect(assignableRoles('coordinator', 'pm')).toEqual([])
  })

  it('lets a Coordinator only keep a Member a Member', () => {
    expect(assignableRoles('coordinator', 'member')).toEqual(['member'])
    expect(assignableRoles('coordinator', 'coordinator')).toEqual([])
  })

  it('gives Members, QA and Stakeholders nothing', () => {
    expect(assignableRoles('member', 'member')).toEqual([])
    expect(assignableRoles('qa', 'member')).toEqual([])
    expect(assignableRoles('stakeholder', 'member')).toEqual([])
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
