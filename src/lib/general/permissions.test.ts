import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  PERMISSIONS,
  can,
  canStepDown,
  levelLabel,
  levelPermissions,
  permissionLabel,
  requestable,
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
    ])
  })

  it('offers an Owner or Manager nothing, because they hold it all', () => {
    expect(requestable('owner', [], [])).toEqual([])
    expect(requestable('manager', [], [])).toEqual([])
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
