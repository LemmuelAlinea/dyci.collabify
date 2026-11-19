import { describe, expect, it } from 'vitest'
import { alreadySetTitles, fileRows, fitLabel, retarget, type FileTask } from './classFileTasks'
import type { ProjectTask } from './types'

const r = (origin: string | null, board: string, title: string) => ({ origin_id: origin, board_id: board, title }) as ProjectTask
const t = (title: string, fit: FileTask['fit'] = 'fits'): FileTask => ({ title, details: '', weight: 1, due: '', fit, fit_reason: fit === 'off' ? 'Not in weeks 5–8.' : '' })

describe('alreadySetTitles', () => {
  const rows = [r('o1', 'b1', 'Write the proposal'), r('o2', 'b1', 'Build the model'), r('o2', 'b2', ' Build the MODEL '), r(null, 'b2', 'Own task')]
  it('counts a task for every group only when it reached every board', () => {
    expect(alreadySetTitles(rows, 2, '')).toEqual(new Set(['build the model']))
  })
  it('counts a task for one group when it reached that board', () => {
    expect(alreadySetTitles(rows, 2, 'b1')).toEqual(new Set(['write the proposal', 'build the model']))
  })
  it('ignores tasks a group made itself', () => {
    expect(alreadySetTitles(rows, 2, 'b2')).toEqual(new Set(['build the model']))
  })
})

describe('fileRows', () => {
  it('starts off and already-set rows unticked', () => {
    const rows = fileRows([t('Build the model'), t('Make a TikTok page', 'off'), t('Write the proposal')], new Set(['write the proposal']))
    expect(rows.map((x) => [x.keep, x.already])).toEqual([[true, false], [false, false], [false, true]])
  })
  it('keeps a task with no verdict ticked', () => {
    const [row] = fileRows([{ ...t('Build the model'), fit: undefined as never }], new Set())
    expect(row.keep).toBe(true)
  })
  it('starts every row unticked when no task fits', () => {
    expect(fileRows([t('a', 'off'), t('b', 'off')], new Set()).some((x) => x.keep)).toBe(false)
  })
})

describe('retarget', () => {
  it('unticks only rows that newly become already set', () => {
    const start = fileRows([t('Make a TikTok page', 'off'), t('Build the model')], new Set())
    start[0].keep = true // ticked back on by hand
    const next = retarget(start, new Set(['build the model']))
    expect(next.map((x) => [x.keep, x.already])).toEqual([[true, false], [false, true]])
  })
  it('leaves a row the person ticked while already set alone when it stays already set', () => {
    const start = fileRows([t('Build the model')], new Set(['build the model']))
    start[0].keep = true
    expect(retarget(start, new Set(['build the model']))[0].keep).toBe(true)
  })
  it('clears already when the new target lacks the task, without ticking it', () => {
    const start = fileRows([t('Build the model')], new Set(['build the model']))
    expect(retarget(start, new Set())[0]).toMatchObject({ already: false, keep: false })
  })
})

describe('fitLabel', () => {
  it('names a row both already set and off as Already set', () => {
    expect(fitLabel({ fit: 'off', already: true })).toBe('Already set')
  })
  it('names the verdict otherwise', () => {
    expect(fitLabel({ fit: 'off' })).toBe("Doesn't fit")
    expect(fitLabel({ fit: 'fits' })).toBe('Fits')
    expect(fitLabel({})).toBe('Fits')
  })
})
