import { describe, expect, it } from 'vitest'
import { projectOwnerLock } from './projectOwner'

describe('projectOwnerLock', () => {
  it('leaves the teacher who set the project free to change it', () => {
    expect(projectOwnerLock({ created_by: 'setter' }, 'setter', 'Elena Villareal')).toBeNull()
  })

  it('names the setter for a co-teacher', () => {
    expect(projectOwnerLock({ created_by: 'setter' }, 'co-teacher', 'Elena Villareal')).toBe(
      'Elena Villareal set this project, so only they can edit, publish, close or archive it.',
    )
  })

  it('says another teacher while the name is unknown', () => {
    expect(projectOwnerLock({ created_by: 'setter' }, 'co-teacher')).toBe(
      'Another teacher set this project, so only they can edit, publish, close or archive it.',
    )
    expect(projectOwnerLock({ created_by: 'setter' }, 'co-teacher', '  ')).toMatch(/^Another teacher/)
  })

  it('locks nothing before the viewer is known', () => {
    expect(projectOwnerLock({ created_by: 'setter' }, undefined, 'Elena Villareal')).toBeNull()
  })
})
