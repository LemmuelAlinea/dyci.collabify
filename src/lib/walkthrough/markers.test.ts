import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_STEPS, FLOWS } from './flows'

const FILES = [
  'src/pages/Settings.tsx',
  'src/pages/general/SpacePicker.tsx',
  'src/pages/general/SpaceLayout.tsx',
  'src/pages/app/classes/ProfessorClasses.tsx',
  'src/components/classes/ClassHeader.tsx',
  'src/pages/app/StudentHome.tsx',
  'src/components/app/WaitingHome.tsx',
  'src/components/app/SideNav.tsx',
]

const source = FILES.map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n')

const markers = [
  ...new Set(
    [...ACCOUNT_STEPS, ...Object.values(FLOWS).flat()].flatMap((s) => [...s.targets]),
  ),
]

describe('walkthrough markers', () => {
  it('names at least one marker', () => {
    expect(markers.length).toBeGreaterThan(0)
  })

  it.each(markers)('%s is marked in the source', (marker) => {
    const literal = `data-walkthrough="${marker}"`
    if (marker === 'nav-tasks' || marker === 'nav-groups') {
      expect(source).toContain('data-walkthrough')
      expect(source).toContain(`'${marker}'`)
    } else if (marker === 'account-look') {
      // Section takes the marker as a prop and writes the attribute itself.
      expect(source).toContain('data-walkthrough={marker}')
      expect(source).toContain(`marker="${marker}"`)
    } else {
      expect(source).toContain(literal)
    }
  })
})
